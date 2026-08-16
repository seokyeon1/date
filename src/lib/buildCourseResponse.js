import "server-only";
import { randomUUID } from "crypto";
import { estimateMove } from "./distance";
import { checkOpenStatus, isGooglePlacesConfigured } from "./googlePlaces";

// 같은 activity_type의 미사용 후보 중, 대안(alt)까지 실패했을 때 추가로 시도해볼 최대 개수.
// 너무 크면 Google Places 호출이 늘어나므로 적당히 제한한다.
const MAX_REPLACEMENT_ATTEMPTS = 3;

// 특정 스팟이 실제로는 그 시간에 영업하지 않는 것으로 확인되면, alt 후보 -> 같은 유형의
// 다른 미사용 후보 순서로 영업 중인 곳을 찾아 교체한다. 대체할 곳을 못 찾으면 경고만 남긴다
// (빈 시간을 만들지 않는다는 기존 원칙 유지 — 장소를 통째로 빼버리지 않음).
async function resolveOpenPlace({ stop, candidateMap, usedIds, input, allWarnings }) {
  const place = candidateMap.get(String(stop.kakao_place_id));
  if (!place) return;

  const window = { date: input.date, startTime: stop.start_time, endTime: stop.end_time };
  const status = await checkOpenStatus(place, window);
  if (status !== false) return; // true(영업 확인) 또는 null(판단 불가)이면 그대로 둔다

  const triedIds = new Set([String(place.kakao_place_id)]);
  const candidateIds = [];
  if (stop.alt_kakao_place_id) candidateIds.push(String(stop.alt_kakao_place_id));
  for (const [id, candidate] of candidateMap) {
    if (candidateIds.length >= MAX_REPLACEMENT_ATTEMPTS) break;
    if (triedIds.has(id) || candidateIds.includes(id)) continue;
    if (candidate.activity_type !== place.activity_type) continue;
    if (usedIds.has(id)) continue;
    candidateIds.push(id);
  }

  for (const id of candidateIds) {
    if (triedIds.has(id)) continue;
    triedIds.add(id);
    const candidatePlace = candidateMap.get(id);
    if (!candidatePlace) continue;

    const candidateStatus = await checkOpenStatus(candidatePlace, window);
    if (candidateStatus !== false) {
      usedIds.delete(String(stop.kakao_place_id));
      usedIds.add(id);
      stop.kakao_place_id = id;
      allWarnings.push(
        `"${place.name}"은(는) 이 시간대(${stop.start_time})에 영업하지 않는 것으로 확인되어 "${candidatePlace.name}"(으)로 교체했습니다.`
      );
      return;
    }
  }

  allWarnings.push(
    `"${place.name}"은(는) ${stop.start_time} 기준 영업하지 않는 것으로 확인되었지만 대체할 후보를 찾지 못했습니다. 방문 전 실제 영업 여부를 확인해 주세요.`
  );
}

// LLM은 순서/시간/activity_type만 결정하고, 장소의 사실 정보(이름/주소/전화 등)는
// 항상 카카오 후보 데이터에서 채운다 (LLM이 장소 정보를 지어내는 것을 원천 차단).
export async function buildCourseResponse({ input, stops, warnings, candidateMap }) {
  const allWarnings = [...(warnings || [])];

  // 구글 플레이스 API가 설정된 경우에만 실제 영업시간을 검증한다 (미설정 시 완전히 스킵).
  if (isGooglePlacesConfigured()) {
    const usedIds = new Set(stops.map((s) => String(s.kakao_place_id)));
    for (const stop of stops) {
      await resolveOpenPlace({ stop, candidateMap, usedIds, input, allWarnings });
    }
  }

  const enrichedStops = [];

  for (const stop of stops) {
    const place = candidateMap.get(String(stop.kakao_place_id));
    if (!place) continue;

    const altPlace = stop.alt_kakao_place_id
      ? candidateMap.get(String(stop.alt_kakao_place_id))
      : null;

    enrichedStops.push({
      order: stop.order,
      start_time: stop.start_time,
      end_time: stop.end_time,
      activity_type: stop.activity_type,
      place: {
        kakao_place_id: place.kakao_place_id,
        name: place.name,
        category: place.category,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        phone: place.phone || "확인 필요",
        kakao_map_url: place.kakao_map_url,
        price_range: "확인 필요",
        reservation_required: "확인 필요",
      },
      notes: stop.notes || "",
      alt_option: altPlace
        ? { name: altPlace.name, kakao_place_id: altPlace.kakao_place_id }
        : null,
    });
  }

  enrichedStops.sort((a, b) => a.order - b.order);

  const legCount = Math.max(0, enrichedStops.length - 1);
  const moves = await Promise.all(
    Array.from({ length: legCount }, (_, i) =>
      estimateMove(enrichedStops[i].place, enrichedStops[i + 1].place, input.transportModes)
    )
  );

  let totalMovingTime = 0;
  moves.forEach((move, i) => {
    enrichedStops[i].move_to_next = move;
    totalMovingTime += move.duration_min;
  });
  if (enrichedStops.length > 0) {
    enrichedStops[enrichedStops.length - 1].move_to_next = null;
  }

  const lastStop = enrichedStops[enrichedStops.length - 1];
  if (lastStop && lastStop.end_time > input.endTime) {
    allWarnings.push(
      `예상 종료 시각(${lastStop.end_time})이 입력하신 종료 시간(${input.endTime})을 초과합니다.`
    );
  }

  return {
    course_id: randomUUID(),
    meta: {
      date: input.date,
      start_time: input.startTime,
      end_time: input.endTime,
      region: {
        sido: input.region.sido,
        gu: input.region.gu || null,
        station: input.region.mode === "station" ? input.region.station?.name || null : null,
      },
      radius_km: input.radiusKm,
      transport_modes: input.transportModes,
      mood_tags: input.moodTags,
      free_request: input.freeRequest || "",
    },
    stops: enrichedStops,
    summary: {
      total_estimated_cost_per_person: "확인 필요 (카카오 로컬 API는 가격 정보를 제공하지 않음)",
      total_moving_time_min: totalMovingTime,
      warnings: allWarnings,
    },
  };
}
