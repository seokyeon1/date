import "server-only";
import { haversineDistanceM } from "./distance";

// 카카오 로컬 API는 영업시간을 제공하지 않으므로, Google Places API(New)의
// Text Search로 동일 장소를 찾아 실제 영업시간(regularOpeningHours)을 조회한다.
// GOOGLE_PLACES_API_KEY가 없으면 이 기능은 통째로 비활성화되고(항상 null 반환),
// 나머지 코스 생성 로직은 기존과 동일하게 동작한다.
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

// 이름이 같아도 다른 지점(체인점)일 수 있으므로, 카카오 좌표와 이 거리(m) 이내인
// 결과만 "같은 장소"로 신뢰한다.
const MATCH_DISTANCE_THRESHOLD_M = 300;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1시간 — 서버 프로세스 생명주기 내 중복 호출 방지용 캐시

export function isGooglePlacesConfigured() {
  return Boolean(GOOGLE_PLACES_API_KEY);
}

const cache = new Map(); // kakao_place_id -> { expiresAt, promise }

function getCached(key, loader) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.promise;
  const promise = loader();
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, promise });
  return promise;
}

async function fetchGooglePlace(place) {
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.regularOpeningHours,places.businessStatus",
    },
    body: JSON.stringify({
      textQuery: `${place.name} ${place.address || ""}`.trim(),
      languageCode: "ko",
      regionCode: "KR",
      maxResultCount: 5,
      locationBias: {
        circle: { center: { latitude: place.lat, longitude: place.lng }, radius: 200 },
      },
    }),
    cache: "no-store",
  });

  if (!res.ok) return null;
  const data = await res.json();
  const candidates = data.places || [];

  const nearest = candidates
    .map((p) => ({
      place: p,
      dist:
        p.location?.latitude != null && p.location?.longitude != null
          ? haversineDistanceM(
              { lat: place.lat, lng: place.lng },
              { lat: p.location.latitude, lng: p.location.longitude }
            )
          : Infinity,
    }))
    .filter((c) => c.dist <= MATCH_DISTANCE_THRESHOLD_M)
    .sort((a, b) => a.dist - b.dist)[0];

  return nearest ? nearest.place : null;
}

function toMinutes(hour, minute) {
  return hour * 60 + minute;
}

const MINUTES_PER_DAY = 24 * 60;

// periods: Google Places regularOpeningHours.periods.
// close가 없는 단일 period는 24시간 연중무휴를 의미한다.
// 자정을 넘겨 닫는 영업(예: 22:00~익일 02:00)도 처리한다.
function isOpenDuring(periods, dayOfWeek, startMin, endMin) {
  if (!periods || periods.length === 0) return null;
  if (periods.length === 1 && periods[0].open && !periods[0].close) return true;

  for (const period of periods) {
    if (!period.open || !period.close) continue;
    const openDay = period.open.day;
    const openMin = toMinutes(period.open.hour, period.open.minute);
    const closeDay = period.close.day;
    const closeMin = toMinutes(period.close.hour, period.close.minute);

    if (openDay === dayOfWeek) {
      const closeAbsMin = closeDay === openDay ? closeMin : closeMin + MINUTES_PER_DAY;
      if (startMin >= openMin && endMin <= closeAbsMin) return true;
    } else if (closeDay === dayOfWeek && (openDay + 1) % 7 === dayOfWeek) {
      // 전날 열어서 오늘 새벽에 닫는 경우
      if (startMin < closeMin && endMin <= closeMin) return true;
    }
  }
  return false;
}

// 카카오 장소가 주어진 날짜/시간대에 실제로 영업하는지 확인한다.
// true: 영업 확인됨 / false: 휴업으로 확인됨 / null: 매칭 실패·정보 없음(판단 불가 — 배제하지 않음)
export async function checkOpenStatus(place, { date, startTime, endTime }) {
  if (!isGooglePlacesConfigured() || !place || place.lat == null || place.lng == null) return null;

  const matched = await getCached(String(place.kakao_place_id), () =>
    fetchGooglePlace(place).catch(() => null)
  );
  if (!matched) return null;

  if (
    matched.businessStatus === "CLOSED_PERMANENTLY" ||
    matched.businessStatus === "CLOSED_TEMPORARILY"
  ) {
    return false;
  }

  const periods = matched.regularOpeningHours?.periods;
  const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);

  return isOpenDuring(periods, dayOfWeek, toMinutes(sh, sm), toMinutes(eh, em));
}
