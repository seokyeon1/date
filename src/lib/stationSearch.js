import "server-only";
import { searchKeyword } from "./kakaoLocal";

// 주소 앞부분 매칭용 시/도 축약 표기 (카카오 응답의 address_name이 이 형태로 시작함)
const SIDO_SHORT_NAME = {
  서울특별시: "서울",
  부산광역시: "부산",
  대구광역시: "대구",
  인천광역시: "인천",
  광주광역시: "광주",
  대전광역시: "대전",
  울산광역시: "울산",
  세종특별자치시: "세종",
  경기도: "경기",
  강원특별자치도: "강원",
  충청북도: "충북",
  충청남도: "충남",
  전북특별자치도: "전북",
  전라남도: "전남",
  경상북도: "경북",
  경상남도: "경남",
  제주특별자치도: "제주",
};

// 카카오 로컬 API의 지하철역 카테고리(SW8)로 실시간 검색한다.
// 정적으로 역 목록을 내장하지 않고 항상 실제 검색 결과만 사용해 오탈자/폐역 등의
// 잘못된 데이터를 원천 차단한다 (환각 방지 원칙과 동일한 이유).
export async function searchStations({ sido, query }) {
  const q = (query || "").trim();
  if (!q) return [];

  const keyword = q.includes("역") ? q : `${q}역`;
  const results = await searchKeyword({
    query: keyword,
    categoryGroupCode: "SW8",
    size: 15,
  });

  const shortName = SIDO_SHORT_NAME[sido];
  const filtered = shortName ? results.filter((r) => r.address?.startsWith(shortName)) : results;

  const seen = new Set();
  const unique = [];
  for (const r of filtered) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    unique.push(r);
  }

  return unique.slice(0, 10);
}
