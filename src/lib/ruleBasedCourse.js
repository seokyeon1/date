import "server-only";
import { haversineDistanceM } from "./distance";
import { searchNearby } from "./candidateSearch";

// Claude API 키가 없거나 호출에 실패했을 때 사용하는 규칙 기반 코스 조립기.
// LLM 없이도 앱이 항상 정상 동작하도록 하는 폴백 로직이며,
// 자유 요청사항 문구의 의미까지는 반영하지 못한다는 한계를 warnings로 알린다.
//
// 목표: 입력한 시간대를 빈 시간 없이 꽉 채우는 것. 대한민국 커플 데이트 코스의
// 일반적인 흐름(식사 -> 카페 -> 산책/문화·액티비티 -> 영화 -> 술집/야경 -> 숙소)을
// 참고해 순서를 유지하면서, 후보가 남아있는 한 최대한 종료 시각까지 채워 넣는다.
// 다만 실제로 검색되지 않은 장소를 지어내지는 않으므로, 후보 자체가 바닥나면
// 그 이상은 채울 수 없다(환각 방지 원칙 우선).
//
// 이 파일은 LLM 없이도 "그럴듯한 나만의 코스"를 만들기 위해 세 가지 축으로 정교화되어 있다.
// 1) 어떤 유형을 배치할지 -> 무드 태그 가중치 + 다양성 페널티 + 시간대 적합성을 합산한 점수
// 2) 어떤 장소를 고를지 -> 직전 스팟과의 거리뿐 아니라 "다음 유형 후보군의 무게중심"까지
//    내다보는 1-스텝 룩어헤드 그리디 최적화 + 같은 브랜드 반복 페널티
// 3) 얼마나 머물지 -> 무드에 따른 페이스(빠르게 여러 곳 vs 느긋하게 오래) 반영한 유연한 체류시간
const PRIORITY_TYPES = ["식사", "카페", "산책", "문화/액티비티", "영화관", "술집/야경", "숙소"];

// [최소, 최대] 체류시간(분). 최소==최대면 사실상 고정 길이(식사/영화/숙소).
const TYPE_DURATION_RANGE_MIN = {
  식사: [60, 60],
  카페: [40, 90],
  산책: [20, 60],
  "문화/액티비티": [60, 120],
  영화관: [130, 130],
  "술집/야경": [45, 120],
  숙소: [120, 120],
};
const FIXED_DURATION_MIN = { 식사: 60, 영화관: 130, 숙소: 120 };
const FLEXIBLE_TYPES = new Set(["카페", "산책", "문화/액티비티", "술집/야경"]);
const MIN_FLEXIBLE_DURATION = Math.min(
  ...Array.from(FLEXIBLE_TYPES, (t) => TYPE_DURATION_RANGE_MIN[t][0])
);
const MAX_STOPS = 10;
const MAX_MEALS_PER_DAY = 3;

// 유형별 하루 최대 배치 횟수(기본값). 같은 유형이 무한정 반복 배치되는 것을 막는다.
const BASE_MAX_USES_PER_TYPE = {
  카페: 1,
  산책: 2,
  "문화/액티비티": 2,
  영화관: 1,
  "술집/야경": 1,
  숙소: 1,
};

// 목적/분위기 태그별로 각 활동 유형을 얼마나 선호하는지 나타내는 가중치.
// 1.0이 중립이고, 클수록 그 유형이 더 우선적으로/자주 배치된다.
// 여러 태그를 함께 고르면 평균을 취해 어느 한쪽으로만 쏠리지 않게 한다.
const MOOD_TYPE_WEIGHT = {
  "설레는 첫만남": { 카페: 1.15, 산책: 1.4, "문화/액티비티": 1.05, 영화관: 0.7, "술집/야경": 1.15, 숙소: 0.5 },
  "편안한 데이트": { 카페: 1.3, 산책: 1.15, "문화/액티비티": 0.9, 영화관: 1.05, "술집/야경": 0.8, 숙소: 1.0 },
  "기념일/특별한 날": { 카페: 1.1, 산책: 1.0, "문화/액티비티": 1.3, 영화관: 0.8, "술집/야경": 1.35, 숙소: 1.25 },
  "액티브한 데이트": { 카페: 0.75, 산책: 1.25, "문화/액티비티": 1.5, 영화관: 0.55, "술집/야경": 0.95, 숙소: 0.8 },
  "조용한 힐링": { 카페: 1.4, 산책: 1.3, "문화/액티비티": 0.75, 영화관: 0.95, "술집/야경": 0.55, 숙소: 1.05 },
  "맛집 위주": { 카페: 1.2, 산책: 0.7, "문화/액티비티": 0.75, 영화관: 0.55, "술집/야경": 1.05, 숙소: 0.85 },
};
// 유형별 반복 상한을 완화해주는 무드 보너스 (예: "맛집 위주"면 카페를 한 곳 더 허용)
const MOOD_MAX_USE_BONUS = [
  { mood: "맛집 위주", type: "카페", bonus: 1 },
  { mood: "액티브한 데이트", type: "문화/액티비티", bonus: 1 },
  { mood: "조용한 힐링", type: "산책", bonus: 1 },
];

function moodWeightFor(type, moodTags) {
  if (!moodTags || moodTags.length === 0) return 1;
  const weights = moodTags
    .map((tag) => MOOD_TYPE_WEIGHT[tag]?.[type])
    .filter((w) => typeof w === "number");
  if (weights.length === 0) return 1;
  return weights.reduce((sum, w) => sum + w, 0) / weights.length;
}

function maxUsesFor(type, moodTags) {
  let max = BASE_MAX_USES_PER_TYPE[type] ?? Infinity;
  for (const rule of MOOD_MAX_USE_BONUS) {
    if (rule.type === type && moodTags?.includes(rule.mood)) max += rule.bonus;
  }
  return max;
}

// 0(빠르게 여러 곳) ~ 1(느긋하게 오래 머묾) 사이의 페이스 지수.
// 유연한 체류시간을 [최소,최대] 범위 중 어디쯤에서 잡을지 결정한다.
function paceFactor(moodTags) {
  let score = 0.5;
  if (moodTags?.includes("액티브한 데이트")) score -= 0.2;
  if (moodTags?.includes("맛집 위주")) score -= 0.15;
  if (moodTags?.includes("조용한 힐링")) score += 0.2;
  if (moodTags?.includes("편안한 데이트")) score += 0.15;
  return Math.max(0, Math.min(1, score));
}

// 이 거리(m)를 넘으면 "너무 멀다"고 보고 직전 스팟 근처를 다시 검색한다.
const TOO_FAR_THRESHOLD_M = { 도보: 1200, "자전거/따릉이": 2500, 대중교통: 2000 };
const DEFAULT_TOO_FAR_THRESHOLD_M = 1500;
const NEARBY_SEARCH_RADIUS_M = 1500;

function tooFarThreshold(transportModes) {
  const knownModes = (transportModes || []).filter((m) => m in TOO_FAR_THRESHOLD_M);
  if (knownModes.length === 0) return DEFAULT_TOO_FAR_THRESHOLD_M;
  return Math.min(...knownModes.map((m) => TOO_FAR_THRESHOLD_M[m]));
}

const MEAL_WINDOWS = [
  { name: "아침", start: "06:00", end: "10:00" },
  { name: "점심", start: "11:00", end: "14:00" },
  { name: "저녁", start: "17:00", end: "21:00" },
];

function diffMinutes(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

function addMinutes(time, minutes) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// 유연한 유형의 체류시간을 [최소,최대] 범위와 남은 시간, 페이스 지수를 종합해 정한다.
function flexibleDuration(type, remaining, pace) {
  const [min, max] = TYPE_DURATION_RANGE_MIN[type];
  const ideal = Math.round(min + pace * (max - min));
  return Math.max(min, Math.min(ideal, remaining));
}

function mealLabelFor(time) {
  const hour = Number(time.split(":")[0]);
  if (hour < 11) return "아침";
  if (hour < 16) return "점심";
  return "저녁";
}

// 술집/야경, 숙소는 저녁 이후에만 자연스럽다.
function isTimeAppropriate(type, cursorHour) {
  if (type === "술집/야경") return cursorHour >= 18;
  if (type === "숙소") return cursorHour >= 19;
  return true;
}

function detectMealWindows(startTime, endTime) {
  return MEAL_WINDOWS.map((w) => ({
    name: w.name,
    overlapStart: startTime > w.start ? startTime : w.start,
    overlapEnd: endTime < w.end ? endTime : w.end,
  }))
    .filter((w) => diffMinutes(w.overlapStart, w.overlapEnd) >= 30)
    .slice(0, MAX_MEALS_PER_DAY);
}

// 식사 -> 카페 -> 산책/문화/영화 -> 술집/야경 -> 숙소 순서를 유지하면서,
// 후보가 남아있는 한 종료 시각까지 빈 시간 없이 채운다. 각 빈 구간을 채울 유형은
// (무드 가중치 - 사용 횟수 페널티 - 직전유형 반복 페널티 + 약간의 무작위성) 점수로 고른다.
function buildPlan(candidatesByType, meta) {
  const { start_time: startTime, end_time: endTime, mood_tags: moodTags } = meta;
  const totalMinutes = diffMinutes(startTime, endTime);
  const available = PRIORITY_TYPES.filter((t) => (candidatesByType[t] || []).length > 0);
  if (available.length === 0 || totalMinutes <= 0) return [];

  const hasMeal = available.includes("식사");
  const cyclable = available.filter((t) => t !== "식사");
  const mealWindows = hasMeal ? detectMealWindows(startTime, endTime) : [];
  const pace = paceFactor(moodTags);

  const availableCounts = {};
  cyclable.forEach((t) => {
    availableCounts[t] = (candidatesByType[t] || []).length;
  });
  const usedCountByType = {};
  cyclable.forEach((t) => {
    usedCountByType[t] = 0;
  });

  const plan = [];
  let cursor = startTime;

  // 유형별 반복 상한(maxUsesFor)은 "하드 제약"이 아니라 점수 페널티다. 상한을 넘겨서라도
  // 배치할 실제 후보가 남아있다면 빈 시간을 만드는 것보다 그 유형을 다시 쓰는 쪽을 택한다
  // (빈 시간 없이 채우는 것이 다양성보다 우선).
  function scoreType(t, lastType) {
    const overCap = Math.max(0, usedCountByType[t] + 1 - maxUsesFor(t, moodTags));
    const diversityPenalty = usedCountByType[t] * 0.35;
    const overCapPenalty = overCap * 1.5;
    const repeatPenalty = t === lastType ? 0.5 : 0;
    const jitter = (Math.random() - 0.5) * 0.15;
    return moodWeightFor(t, moodTags) - diversityPenalty - overCapPenalty - repeatPenalty + jitter;
  }

  function fillGap(gapEnd) {
    while (plan.length < MAX_STOPS) {
      const remaining = diffMinutes(cursor, gapEnd);
      if (remaining < MIN_FLEXIBLE_DURATION) break;

      const cursorHour = Number(cursor.split(":")[0]);
      const lastType = plan.length > 0 ? plan[plan.length - 1].type : null;
      // 하드 제약은 "실제로 아직 안 쓴 후보가 있는지"와 "시간대/체류시간이 맞는지" 뿐이다.
      // 유형별 반복 상한은 scoreType의 페널티로만 반영해, 상한을 넘겨야만 빈 시간을
      // 피할 수 있는 상황에서도 항상 채울 수 있게 한다.
      const isEligible = (t) => {
        if (usedCountByType[t] >= availableCounts[t]) return false;
        if (!isTimeAppropriate(t, cursorHour)) return false;
        if (FLEXIBLE_TYPES.has(t)) return remaining >= TYPE_DURATION_RANGE_MIN[t][0];
        return (FIXED_DURATION_MIN[t] ?? 90) <= remaining;
      };

      const eligible = cyclable.filter(isEligible);
      if (eligible.length === 0) break;

      const candidate = eligible.reduce((best, t) =>
        scoreType(t, lastType) > scoreType(best, lastType) ? t : best
      );

      usedCountByType[candidate]++;
      const duration = FLEXIBLE_TYPES.has(candidate)
        ? flexibleDuration(candidate, remaining, pace)
        : FIXED_DURATION_MIN[candidate] ?? 90;
      const stopEnd = addMinutes(cursor, duration);
      plan.push({ type: candidate, start: cursor, end: stopEnd });
      cursor = stopEnd;
    }
  }

  for (const window of mealWindows) {
    if (plan.length >= MAX_STOPS) break;

    if (diffMinutes(cursor, window.overlapStart) > 0) {
      fillGap(window.overlapStart);
    }
    if (plan.length >= MAX_STOPS) break;

    // fillGap이 실제 후보 소진 등으로 window.overlapStart까지 다 채우지 못했다면
    // cursor가 그보다 이르다 — 이때 식사를 "이상적인" 시간(overlapStart)에 맞춰 시작하면
    // 그 사이가 빈 시간으로 남는다. 빈 시간을 만들지 않는 것이 우선이므로 커서 시각
    // 그대로 식사를 시작한다(살짝 이른 식사가 되더라도, 라벨은 mealLabelFor가 실제
    // 시각 기준으로 다시 계산하므로 "이른 점심"이 "늦은 아침"으로 자연스럽게 표시된다).
    const mealStart = cursor;
    const mealEnd = addMinutes(mealStart, FIXED_DURATION_MIN["식사"]);
    if (diffMinutes(startTime, mealEnd) > totalMinutes) break;

    plan.push({ type: "식사", start: mealStart, end: mealEnd });
    cursor = mealEnd;
  }

  if (plan.length < MAX_STOPS && diffMinutes(cursor, endTime) > 0) {
    fillGap(endTime);
  }

  return plan;
}

// 같은 브랜드(프랜차이즈)가 하루에 여러 번 겹치지 않도록 이름 앞 토큰으로 근사 판별한다.
// (카카오 API가 브랜드 ID를 별도로 제공하지 않으므로 이름 텍스트 기반 근사치)
function brandToken(name) {
  const first = (name || "").trim().split(/\s+/)[0];
  return first && first.length >= 2 ? first : null;
}

function centroidOf(places) {
  if (!places || places.length === 0) return null;
  const lat = places.reduce((sum, p) => sum + p.lat, 0) / places.length;
  const lng = places.reduce((sum, p) => sum + p.lng, 0) / places.length;
  return { lat, lng };
}

// 후보 풀 중 몇 곳까지를 "가까운 편"으로 보고 가중 무작위 선택을 할지.
// 거리(및 다음 유형 후보군까지의 예상 이동) 기준 상위 K개 중에서, 가까울수록 더 높은
// 확률로 뽑히는 가중치 추첨을 한다 — 매번 최단거리 1곳만 고정되지 않으면서도
// 진짜 먼 곳이 뽑히는 일은 거의 없게 한다.
const TOP_K_CANDIDATES = 5;
const LOOKAHEAD_WEIGHT = 0.6; // 다음 유형 후보군 무게중심까지의 거리를 얼마나 반영할지
const DISTANCE_SCORE_POWER = 1.5;
const BRAND_REPEAT_PENALTY = 0.4;

function weightedPick(scored) {
  const total = scored.reduce((sum, x) => sum + x.weight, 0);
  if (total <= 0) return scored[0]?.place;
  let r = Math.random() * total;
  for (const x of scored) {
    r -= x.weight;
    if (r <= 0) return x.place;
  }
  return scored[scored.length - 1].place;
}

// 직전 스팟(prevPoint)과의 거리뿐 아니라, 다음 순서에 배치될 유형의 후보군이 대체로
// 어디쯤 몰려 있는지(nextCentroid)까지 내다봐서 "지금은 가깝지만 다음 이동이 크게 늘어나는"
// 선택을 피한다. 같은 브랜드가 이미 쓰였다면 가중치를 낮춰(완전 배제는 아님) 다양성을 준다.
function pickPlace(pool, prevPoint, optimizeProximity, nextCentroid, usedBrands) {
  if (pool.length <= 1) {
    return { chosen: pool[0], alt: undefined };
  }

  if (!optimizeProximity || !prevPoint) {
    const scored = pool.map((p) => {
      const brand = brandToken(p.name);
      const weight = brand && usedBrands?.has(brand) ? BRAND_REPEAT_PENALTY : 1;
      return { place: p, cost: 0, weight };
    });
    const chosen = weightedPick(scored);
    const alt = pool.find((p) => p !== chosen);
    return { chosen, alt };
  }

  const scored = pool
    .map((p) => {
      let cost = haversineDistanceM(prevPoint, { lat: p.lat, lng: p.lng });
      if (nextCentroid) {
        cost += LOOKAHEAD_WEIGHT * haversineDistanceM({ lat: p.lat, lng: p.lng }, nextCentroid);
      }
      const brand = brandToken(p.name);
      let weight = 1 / Math.pow(cost + 50, DISTANCE_SCORE_POWER);
      if (brand && usedBrands?.has(brand)) weight *= BRAND_REPEAT_PENALTY;
      return { place: p, cost, weight };
    })
    .sort((a, b) => a.cost - b.cost)
    .slice(0, Math.min(TOP_K_CANDIDATES, pool.length));

  const chosen = weightedPick(scored);
  const altPool = scored.filter((x) => x.place !== chosen);
  const alt = altPool.length > 0 ? weightedPick(altPool) : pool.find((p) => p !== chosen);
  return { chosen, alt };
}

export async function assembleCourseRuleBased({ meta, candidatesByType, center, candidateMap }) {
  const plan = buildPlan(candidatesByType, meta);
  if (plan.length === 0) return null;

  const optimizeProximity = !(meta.transport_modes || []).includes("자차");
  const threshold = tooFarThreshold(meta.transport_modes);
  const usedIds = new Set();
  const usedBrands = new Set();
  const stops = [];
  let prevPoint = center || null;

  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    const basePool = (candidatesByType[item.type] || []).filter(
      (p) => !usedIds.has(String(p.kakao_place_id))
    );
    if (basePool.length === 0) {
      // buildPlan은 계획 단계의 후보 수 기준으로 이 스팟을 배정했지만, 실제 조립 시점에
      // (이론상으로만 가능한 경우) 후보가 없다면 그냥 건너뛰지 않는다 — 건너뛰면 다음
      // 스팟의 start_time과 직전 스팟의 end_time 사이에 빈 시간이 생기기 때문에,
      // 직전 스팟이 있다면 이 구간만큼 늘려서 흡수한다.
      const prevStop = stops[stops.length - 1];
      if (prevStop) prevStop.end_time = item.end;
      continue;
    }

    const nextType = plan[i + 1]?.type;
    const nextPool = nextType
      ? (candidatesByType[nextType] || []).filter((p) => !usedIds.has(String(p.kakao_place_id)))
      : null;
    const nextCentroid = nextPool ? centroidOf(nextPool) : null;

    let { chosen, alt } = pickPlace(basePool, prevPoint, optimizeProximity, nextCentroid, usedBrands);

    // 가장 가까운 후보조차 너무 멀다면, 직전 스팟 주변을 실시간으로 다시 검색해
    // 더 가까운 실제 장소가 있는지 확인한다 (환각 방지를 위해 항상 실제 검색 결과만 사용).
    if (optimizeProximity && prevPoint && chosen) {
      const dist = haversineDistanceM(prevPoint, { lat: chosen.lat, lng: chosen.lng });
      if (dist > threshold) {
        const nearby = await searchNearby({
          activityType: item.type,
          point: prevPoint,
          radiusM: NEARBY_SEARCH_RADIUS_M,
          moodTags: meta.mood_tags,
          freeRequest: meta.free_request,
        }).catch(() => []);

        if (nearby.length > 0) {
          // 보강 검색으로 새로 찾은 장소는 candidateMap에도 등록해야
          // 이후 결과 조립 단계(buildCourseResponse)에서 사실 정보를 찾을 수 있다.
          if (candidateMap) {
            nearby.forEach((p) => candidateMap.set(String(p.kakao_place_id), p));
          }

          const seenIds = new Set(basePool.map((p) => String(p.kakao_place_id)));
          const merged = [...basePool];
          for (const p of nearby) {
            const id = String(p.kakao_place_id);
            if (!usedIds.has(id) && !seenIds.has(id)) {
              merged.push(p);
              seenIds.add(id);
            }
          }
          const reSelected = pickPlace(merged, prevPoint, true, nextCentroid, usedBrands);
          if (reSelected.chosen) {
            chosen = reSelected.chosen;
            alt = reSelected.alt;
          }
        }
      }
    }

    usedIds.add(String(chosen.kakao_place_id));
    const brand = brandToken(chosen.name);
    if (brand) usedBrands.add(brand);
    prevPoint = { lat: chosen.lat, lng: chosen.lng };

    stops.push({
      order: stops.length + 1,
      start_time: item.start,
      end_time: item.end,
      activity_type: item.type,
      kakao_place_id: chosen.kakao_place_id,
      notes: item.type === "식사" ? `${mealLabelFor(item.start)} 시간대` : "",
      alt_kakao_place_id: alt ? alt.kakao_place_id : undefined,
    });
  }

  if (stops.length === 0) return null;

  // 마지막 안전장치: 실제 후보가 바닥나 빈 시간이 남았는데 마지막 스팟이
  // 고정 시간(식사/영화관/숙소)이 아니라면 종료 시각까지 자연스럽게 늘린다.
  const last = stops[stops.length - 1];
  if (!(last.activity_type in FIXED_DURATION_MIN)) {
    last.end_time = meta.end_time;
  }

  const warnings = [
    "AI(Claude) 연동 없이 규칙 기반 로직으로 생성된 코스입니다. 요청사항 문구가 세밀하게 반영되지 않을 수 있어요.",
  ];

  if (stops[stops.length - 1].end_time < meta.end_time) {
    warnings.push(
      `주변에서 실제로 검색되는 장소가 부족해 ${stops[stops.length - 1].end_time}까지만 채웠어요(가짜 장소를 넣지 않기 위함). 반경을 넓혀보시면 더 꽉 찬 코스를 받아보실 수 있어요.`
    );
  }

  return { stops, warnings };
}
