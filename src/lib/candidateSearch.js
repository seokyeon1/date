import "server-only";
import { geocodeAddress, searchKeyword, searchCategory } from "./kakaoLocal";
import { shuffleArray } from "./shuffle";

const CATEGORY_GROUP = {
  식사: "FD6",
  카페: "CE7",
  문화: "CT1",
  술집: "FD6",
  숙소: "AD5",
};

// 음식 취향/자유요청 텍스트에서 식사 키워드를 유추한다 (없으면 일반 "맛집")
const CUISINE_KEYWORDS = [
  "한식", "일식", "중식", "양식", "이탈리안", "프렌치", "멕시칸", "베트남",
  "태국", "인도", "비건", "파스타", "스시", "오마카세", "고기", "해산물",
];

function detectMealKeyword(freeRequest) {
  const text = freeRequest || "";
  const found = CUISINE_KEYWORDS.find((kw) => text.includes(kw));
  return found ? `${found} 맛집` : "맛집";
}

// 항상 검색하는 기본 액티비티 종류 — 무드 태그와 무관하게 매번 다양한 선택지를 확보한다.
const BASE_CULTURE_KEYWORDS = ["보드게임카페", "만화카페", "방탈출", "전시"];

function detectCultureKeywords(moodTags) {
  const tags = moodTags || [];
  const keywords = new Set(BASE_CULTURE_KEYWORDS);
  if (tags.includes("액티브한 데이트")) {
    keywords.add("방탈출");
    keywords.add("볼링장");
  }
  if (tags.includes("조용한 힐링")) keywords.add("북카페");
  if (tags.includes("기념일/특별한 날")) {
    keywords.add("전시");
    keywords.add("팝업스토어");
  }
  if (tags.includes("편안한 데이트")) keywords.add("소품샵");
  return Array.from(keywords);
}

// 파리바게뜨/써브웨이 같은 베이커리·샌드위치·간식 위주 프랜차이즈는 "식사"를 대체할 수 없으므로
// 식사 후보에서 제외한다 (이름/카테고리 문자열 기준).
const MEAL_EXCLUDE_NAME_KEYWORDS = [
  "파리바게뜨", "뚜레쥬르", "파리크라상", "신라명과",
  "던킨", "던킨도너츠", "크리스피", "배스킨라빈스", "써브웨이",
];
const MEAL_EXCLUDE_CATEGORY_KEYWORDS = ["베이커리", "제과", "도넛", "아이스크림", "간식"];

function isMealEligible(place) {
  const name = place.name || "";
  const category = place.category || "";
  if (MEAL_EXCLUDE_NAME_KEYWORDS.some((kw) => name.includes(kw))) return false;
  if (MEAL_EXCLUDE_CATEGORY_KEYWORDS.some((kw) => category.includes(kw))) return false;
  return true;
}

function filterCandidates(activityType, places) {
  if (activityType === "식사") return places.filter(isMealEligible);
  return places;
}

function detectCafeKeyword(moodTags) {
  const tags = moodTags || [];
  if (tags.includes("설레는 첫만남") || tags.includes("기념일/특별한 날")) {
    return "루프탑 카페";
  }
  return "카페";
}

// activity_type 하나에 대한 검색 스펙 목록(키워드/카테고리코드)을 만든다. 여러 키워드를 반환하는
// 유형(예: 문화/액티비티)은 각 키워드를 병렬 검색해 합침으로써 후보 다양성을 확보한다.
// 최초 대량 검색과, 스케줄러가 스팟을 고를 때 근처를 다시 훑는 보강 검색이 이 스펙을 공유한다.
function getSearchSpecs(activityType, { moodTags, freeRequest } = {}) {
  switch (activityType) {
    case "식사":
      return [{ method: "keyword", query: detectMealKeyword(freeRequest), categoryGroupCode: CATEGORY_GROUP.식사 }];
    case "카페":
      return [{ method: "keyword", query: detectCafeKeyword(moodTags), categoryGroupCode: CATEGORY_GROUP.카페 }];
    case "산책":
      return [{ method: "keyword", query: "공원", categoryGroupCode: CATEGORY_GROUP.문화 }];
    case "영화관":
      return [{ method: "keyword", query: "영화관", categoryGroupCode: CATEGORY_GROUP.문화 }];
    case "술집/야경":
      return [{ method: "keyword", query: "루프탑 바", categoryGroupCode: CATEGORY_GROUP.술집 }];
    case "숙소":
      return [{ method: "category", categoryGroupCode: CATEGORY_GROUP.숙소 }];
    case "문화/액티비티":
      return detectCultureKeywords(moodTags).map((query) => ({
        method: "keyword",
        query,
        categoryGroupCode: CATEGORY_GROUP.문화,
      }));
    default:
      return [];
  }
}

async function runSearchSpec(spec, { x, y, radius, size = 15 }) {
  if (!spec) return [];
  if (spec.method === "category") {
    return searchCategory({ categoryGroupCode: spec.categoryGroupCode, x, y, radius, size });
  }
  return searchKeyword({ query: spec.query, x, y, radius, categoryGroupCode: spec.categoryGroupCode, size });
}

// 여러 검색 스펙을 병렬로 실행하고 결과를 kakao_place_id 기준으로 중복 제거해 합친다.
async function runSearchSpecs(specs, opts) {
  const resultsArrays = await Promise.all(specs.map((spec) => runSearchSpec(spec, opts)));
  const seen = new Set();
  const merged = [];
  for (const places of resultsArrays) {
    for (const place of places) {
      if (seen.has(place.kakao_place_id)) continue;
      seen.add(place.kakao_place_id);
      merged.push(place);
    }
  }
  return merged;
}

// 직전 스팟(또는 임의 좌표) 근처를 좁은 반경으로 다시 검색한다.
// 규칙 기반 스케줄러가 "가장 가까운 후보가 너무 멀 때" 실시간으로 더 가까운 대안을 찾는 데 쓴다.
export async function searchNearby({ activityType, point, radiusM, moodTags, freeRequest }) {
  const specs = getSearchSpecs(activityType, { moodTags, freeRequest });
  if (specs.length === 0) return [];
  const places = await runSearchSpecs(specs, { x: point.lng, y: point.lat, radius: radiusM });
  return filterCandidates(activityType, places).map((p) => ({ ...p, activity_type: activityType }));
}

export async function buildCandidatePool(input) {
  const { region, radiusKm, moodTags, freeRequest } = input;

  // 지하철역 모드는 이미 검색 단계에서 좌표를 확보했으므로 다시 지오코딩하지 않는다.
  const center =
    region.mode === "station" && region.station
      ? { lat: region.station.lat, lng: region.station.lng }
      : await geocodeAddress(`${region.sido} ${region.gu}`);

  if (!center) {
    return { center: null, candidatesByType: {}, allCandidates: [] };
  }

  const radiusM = Math.round(radiusKm * 1000);

  // 데이트 시간을 빈틈없이 채울 수 있도록 매번 폭넓은 카테고리를 모두 검색해둔다.
  // (실제로 쓸지는 스케줄러가 시간대/후보 유무에 따라 판단 — 여기서는 재료만 최대한 확보)
  const activityTypes = ["식사", "카페", "산책", "영화관", "술집/야경", "숙소", "문화/액티비티"];

  const results = await Promise.all(
    activityTypes.map(async (activityType) => {
      const specs = getSearchSpecs(activityType, { moodTags, freeRequest });
      const places = await runSearchSpecs(specs, { x: center.lng, y: center.lat, radius: radiusM });
      return {
        activityType,
        places: filterCandidates(activityType, places).map((p) => ({ ...p, activity_type: activityType })),
      };
    })
  );

  const seen = new Map();
  const candidatesByType = {};

  for (const { activityType, places } of results) {
    if (!candidatesByType[activityType]) candidatesByType[activityType] = [];
    for (const place of places) {
      if (seen.has(place.kakao_place_id)) continue;
      seen.set(place.kakao_place_id, true);
      candidatesByType[activityType].push(place);
    }
  }

  // 같은 조건으로 여러 번 요청해도 매번 다른 코스가 나오도록 후보 순서를 섞는다
  // (카카오 검색은 accuracy 순으로 고정 정렬되어 있어, 섞지 않으면 항상 같은 장소가 뽑힘)
  Object.keys(candidatesByType).forEach((type) => {
    candidatesByType[type] = shuffleArray(candidatesByType[type]);
  });

  const allCandidates = Object.values(candidatesByType).flat();

  return { center, candidatesByType, allCandidates };
}

export function isPoolSufficient(candidatesByType) {
  const hasMeal = (candidatesByType["식사"] || []).length > 0;
  const hasCafe = (candidatesByType["카페"] || []).length > 0;
  const totalCount = Object.values(candidatesByType).flat().length;
  return hasMeal && hasCafe && totalCount >= 4;
}

export function buildCandidateMap(candidatesByType) {
  const map = new Map();
  Object.values(candidatesByType)
    .flat()
    .forEach((p) => map.set(String(p.kakao_place_id), p));
  return map;
}
