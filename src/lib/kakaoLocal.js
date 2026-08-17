import "server-only";

const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;
const BASE_URL = "https://dapi.kakao.com/v2/local";

function assertKey() {
  if (!KAKAO_REST_API_KEY) {
    throw new Error(
      "KAKAO_REST_API_KEY가 설정되지 않았습니다. .env.local 파일을 확인하세요."
    );
  }
}

async function kakaoGet(path, params) {
  assertKey();
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`카카오 API 오류 (${res.status}): ${body}`);
  }

  return res.json();
}

// 주소 문자열 -> {lat, lng} 좌표 변환 (구/군 중심 좌표 확보용)
export async function geocodeAddress(address) {
  const data = await kakaoGet("/search/address.json", { query: address });
  const doc = data.documents?.[0];
  if (!doc) return null;
  return { lat: Number(doc.y), lng: Number(doc.x) };
}

// 키워드 기반 장소 검색 (좌표 + 반경)
// sort: 좌표(x,y)가 있으면 "distance"(가까운 순)를 기본으로 한다 — 지하철역 검색처럼
// 좌표 없이 전국을 검색할 때만 "accuracy"로 호출해야 한다(Kakao API는 좌표 없이
// sort=distance를 보내면 오류를 반환함).
export async function searchKeyword({
  query,
  x,
  y,
  radius,
  categoryGroupCode,
  size = 15,
  sort = x && y ? "distance" : "accuracy",
}) {
  const data = await kakaoGet("/search/keyword.json", {
    query,
    x,
    y,
    radius,
    category_group_code: categoryGroupCode,
    size,
    sort,
  });
  return (data.documents || []).map(normalizePlace);
}

// 카테고리 코드만으로 검색 (키워드 편향 없이 해당 카테고리 전체를 좌표+반경으로 조회)
export async function searchCategory({ categoryGroupCode, x, y, radius, size = 15 }) {
  const data = await kakaoGet("/search/category.json", {
    category_group_code: categoryGroupCode,
    x,
    y,
    radius,
    size,
    sort: "distance",
  });
  return (data.documents || []).map(normalizePlace);
}

function normalizePlace(doc) {
  return {
    kakao_place_id: doc.id,
    name: doc.place_name,
    category: doc.category_name,
    category_group_code: doc.category_group_code,
    address: doc.road_address_name || doc.address_name,
    lat: Number(doc.y),
    lng: Number(doc.x),
    phone: doc.phone || null,
    kakao_map_url: doc.place_url,
  };
}
