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
const PRIORITY_TYPES = ["식사", "카페", "산책", "문화/액티비티", "영화관", "술집/야경", "숙소"];

const FIXED_DURATION_MIN = { 식사: 60, 카페: 60 };
const TYPE_DURATION_MIN = {
  식사: 60,
  카페: 60,
  산책: 40,
  "문화/액티비티": 90,
  영화관: 130,
  "술집/야경": 90,
  숙소: 120,
};
// 남는 시간이 애매하게 짧을 때 축소 배치할 수 있는 유형 (최소 20분까지)
const FLEXIBLE_TYPES = new Set(["산책"]);
const MIN_FLEXIBLE_DURATION = 20;
const MAX_STOPS = 10;
const MAX_MEALS_PER_DAY = 3;
// 유형별 하루 최대 배치 횟수 (지정 없으면 후보 소진까지 무제한)
const MAX_USES_PER_TYPE = { 카페: 1 };

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

function durationFor(type) {
  return TYPE_DURATION_MIN[type] ?? 90;
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
// 후보가 남아있는 한 종료 시각까지 빈 시간 없이 채운다.
// 같은 유형을 반복해야 채워지는 경우, 아직 안 쓴 유형을 우선하되
// 필요하면(빈 시간 방지가 우선) 같은 유형이라도 남은 후보로 다시 채운다.
function buildPlan(candidatesByType, meta) {
  const { start_time: startTime, end_time: endTime } = meta;
  const totalMinutes = diffMinutes(startTime, endTime);
  const available = PRIORITY_TYPES.filter((t) => (candidatesByType[t] || []).length > 0);
  if (available.length === 0 || totalMinutes <= 0) return [];

  const hasMeal = available.includes("식사");
  const cyclable = available.filter((t) => t !== "식사");
  const mealWindows = hasMeal ? detectMealWindows(startTime, endTime) : [];

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

  function fillGap(gapEnd) {
    while (plan.length < MAX_STOPS) {
      const remaining = diffMinutes(cursor, gapEnd);
      if (remaining < MIN_FLEXIBLE_DURATION) break;

      const cursorHour = Number(cursor.split(":")[0]);
      const lastType = plan.length > 0 ? plan[plan.length - 1].type : null;
      // 아직 안 쓴 유형(또는 덜 쓴 유형)을 우선 시도 - 다양성을 위해 사용 횟수 기준으로 정렬
      const ordered = [...cyclable].sort((a, b) => usedCountByType[a] - usedCountByType[b]);
      const isEligible = (t) => {
        if (usedCountByType[t] >= availableCounts[t]) return false;
        const maxUses = MAX_USES_PER_TYPE[t] ?? Infinity;
        if (usedCountByType[t] >= maxUses) return false;
        if (!isTimeAppropriate(t, cursorHour)) return false;
        if (FLEXIBLE_TYPES.has(t)) return remaining >= MIN_FLEXIBLE_DURATION;
        return durationFor(t) <= remaining;
      };
      // 같은 유형이 바로 이어 붙지 않도록, 직전 스팟과 다른 유형을 우선 시도한다.
      // 정말 다른 선택지가 없을 때만(빈 시간 방지가 최우선) 같은 유형을 다시 쓴다.
      const candidate = ordered.find((t) => t !== lastType && isEligible(t)) ?? ordered.find(isEligible);
      if (!candidate) break;

      usedCountByType[candidate]++;
      const duration = FLEXIBLE_TYPES.has(candidate)
        ? Math.min(durationFor(candidate), remaining)
        : durationFor(candidate);
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

    const mealStart = cursor > window.overlapStart ? cursor : window.overlapStart;
    const mealEnd = addMinutes(mealStart, durationFor("식사"));
    if (diffMinutes(startTime, mealEnd) > totalMinutes) break;

    plan.push({ type: "식사", start: mealStart, end: mealEnd });
    cursor = mealEnd;
  }

  if (plan.length < MAX_STOPS && diffMinutes(cursor, endTime) > 0) {
    fillGap(endTime);
  }

  return plan;
}

// 근접도를 고려할 때, 후보 풀 중 몇 곳까지를 "충분히 가깝다"고 보고 무작위로 고를지.
// 이 값이 1이면 항상 최단거리 후보만 골라 동일 조건 재요청 시 매번 같은 코스가 나오는 문제가 있었다.
const NEARBY_RANDOM_POOL_SIZE = 3;

// "자차"가 선택되지 않았다면(도보/대중교통/자전거) 직전 스팟에서 너무 멀지 않은 후보 중에서
// 고르되, 가장 가까운 한 곳으로 고정하지 않고 가까운 상위 몇 곳 중 무작위로 선택해
// 동일 조건으로 여러 번 생성해도 다른 코스가 나오도록 한다. 첫 스팟은 검색 기준 좌표(center) 기준.
function pickPlace(pool, refPoint, optimizeProximity) {
  if (!optimizeProximity || !refPoint || pool.length <= 1) {
    const idx = pool.length <= 1 ? 0 : Math.floor(Math.random() * pool.length);
    const chosen = pool[idx];
    const alt = pool.find((p) => p !== chosen);
    return { chosen, alt };
  }
  const sorted = [...pool].sort(
    (a, b) =>
      haversineDistanceM(refPoint, { lat: a.lat, lng: a.lng }) -
      haversineDistanceM(refPoint, { lat: b.lat, lng: b.lng })
  );
  const nearbyPool = sorted.slice(0, Math.min(NEARBY_RANDOM_POOL_SIZE, sorted.length));
  const chosen = nearbyPool[Math.floor(Math.random() * nearbyPool.length)];
  const alt = sorted.find((p) => p !== chosen);
  return { chosen, alt };
}

export async function assembleCourseRuleBased({ meta, candidatesByType, center, candidateMap }) {
  const plan = buildPlan(candidatesByType, meta);
  if (plan.length === 0) return null;

  const optimizeProximity = !(meta.transport_modes || []).includes("자차");
  const threshold = tooFarThreshold(meta.transport_modes);
  const usedIds = new Set();
  const stops = [];
  let prevPoint = center || null;

  for (const item of plan) {
    const basePool = (candidatesByType[item.type] || []).filter(
      (p) => !usedIds.has(String(p.kakao_place_id))
    );
    if (basePool.length === 0) continue;

    let { chosen, alt } = pickPlace(basePool, prevPoint, optimizeProximity);

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
          const reSelected = pickPlace(merged, prevPoint, true);
          if (reSelected.chosen) {
            chosen = reSelected.chosen;
            alt = reSelected.alt;
          }
        }
      }
    }

    usedIds.add(String(chosen.kakao_place_id));
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
  // 고정 시간(식사/카페)이 아니라면 종료 시각까지 자연스럽게 늘린다.
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
