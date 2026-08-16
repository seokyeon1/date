import "server-only";

// SK Open API(Tmap) 보행자 경로 안내 API — 실제 도보 이동 거리/시간을 조회한다.
// https://tmap-skopenapi.readme.io/reference/보행자-경로안내
// 키가 없거나 호출에 실패하면 null을 반환해, 호출부가 도로 보정계수 기반
// 추정치로 자연스럽게 폴백하도록 한다(앱이 항상 정상 동작하는 것이 우선).
const TMAP_APP_KEY = process.env.TMAP_APP_KEY;
const TMAP_URL = "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1";

export function isTmapConfigured() {
  return Boolean(TMAP_APP_KEY);
}

export async function fetchWalkingRoute(a, b) {
  if (!TMAP_APP_KEY) return null;

  try {
    const res = await fetch(TMAP_URL, {
      method: "POST",
      headers: {
        appKey: TMAP_APP_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        startX: String(a.lng),
        startY: String(a.lat),
        endX: String(b.lng),
        endY: String(b.lat),
        startName: "출발지",
        endName: "도착지",
        reqCoordType: "WGS84GEO",
        resCoordType: "WGS84GEO",
        searchOption: "0",
      }),
      cache: "no-store",
    });

    if (!res.ok) return null;

    const data = await res.json();
    // 총 이동거리/시간은 항상 첫 번째 feature(Point)의 properties에만 담겨 있다.
    const summary = data?.features?.[0]?.properties;
    if (!summary || typeof summary.totalDistance !== "number" || typeof summary.totalTime !== "number") {
      return null;
    }

    return {
      distance_m: Math.round(summary.totalDistance),
      duration_min: Math.max(1, Math.round(summary.totalTime / 60)),
    };
  } catch {
    return null;
  }
}
