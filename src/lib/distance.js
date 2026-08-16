import "server-only";
import { fetchWalkingRoute, isTmapConfigured } from "./tmapDirections";

// 도보 구간은 Tmap 보행자 경로 API로 실제 거리/시간을 조회한다(TMAP_APP_KEY 설정 시).
// 키가 없거나 API 호출이 실패하면, 직선거리에 도로 굴곡 보정계수를 곱한 근사치로 폴백한다.
// 대중교통/자차/자전거는 아직 실제 경로 API가 연동되어 있지 않아 계속 보정 추정치를 사용한다
// (카카오모빌리티는 자동차 경로만 제공하며 별도 승인이 필요함).

const AVG_SPEED_KMH = {
  도보: 4.5,
  "자전거/따릉이": 14,
  대중교통: 20,
  자차: 25,
};

// 도로/보행로 굴곡 보정계수 (직선거리 대비 실제 이동거리 배율의 경험적 근사치)
const ROAD_CURVATURE_FACTOR = {
  도보: 1.35,
  "자전거/따릉이": 1.3,
  대중교통: 1.4,
  자차: 1.3,
};

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function haversineDistanceM(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function estimateByCorrectionFactor(straightDistanceM, mode) {
  const factor = ROAD_CURVATURE_FACTOR[mode] || 1.3;
  const distanceM = Math.round(straightDistanceM * factor);
  const speedKmh = AVG_SPEED_KMH[mode] || AVG_SPEED_KMH["도보"];
  const durationMin = Math.max(1, Math.round((distanceM / 1000 / speedKmh) * 60));
  return { mode, duration_min: durationMin, distance_m: distanceM, is_estimate: true };
}

export async function estimateMove(a, b, transportModes) {
  const straightDistanceM = haversineDistanceM(a, b);
  const mode = pickPrimaryMode(transportModes, straightDistanceM);

  if (mode === "도보" && isTmapConfigured()) {
    const real = await fetchWalkingRoute(a, b);
    if (real) {
      return { mode, ...real, is_estimate: false };
    }
  }

  return estimateByCorrectionFactor(straightDistanceM, mode);
}

function pickPrimaryMode(transportModes, distanceM) {
  if (!transportModes || transportModes.length === 0) return "도보";
  // 500m 이내면 선택 교통수단과 무관하게 도보로 간주
  if (distanceM <= 500 && transportModes.includes("도보")) return "도보";
  return transportModes[0];
}
