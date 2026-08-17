export const TIME_PRESETS = [
  { label: "점심 데이트 (13~16시)", start: "13:00", end: "16:00" },
  { label: "저녁 데이트 (17~21시)", start: "17:00", end: "21:00" },
  { label: "종일 데이트 (13~21시)", start: "13:00", end: "21:00" },
];

export const RADIUS_PRESETS = [1, 3, 5, 10];

export const TRANSPORT_OPTIONS = ["도보", "대중교통", "자차", "자전거/따릉이"];

// 교통수단별 이동 반경 프리셋 — 도보인데 반경이 커서 너무 멀리 걷게 되는 것을 방지
export const RADIUS_PRESETS_BY_TRANSPORT = {
  도보: { presets: [0.5, 1, 1.5, 2], min: 0.5, max: 2, step: 0.5 },
  "자전거/따릉이": { presets: [1, 2, 3, 5], min: 1, max: 5, step: 1 },
  대중교통: { presets: [1, 3, 5, 7], min: 1, max: 7, step: 1 },
  자차: { presets: [3, 5, 10, 15], min: 3, max: 15, step: 1 },
};
const DEFAULT_RADIUS_CONFIG = { presets: RADIUS_PRESETS, min: 1, max: 10, step: 1 };

// 여러 교통수단을 함께 선택했다면 가장 이동이 자유로운 수단 기준으로 반경을 넓게 잡고,
// "도보"만 선택했다면 실제로 걸을 수 있는 범위로 좁힌다.
export function resolveRadiusConfig(transportModes) {
  const modes = transportModes || [];
  if (modes.includes("자차")) return RADIUS_PRESETS_BY_TRANSPORT["자차"];
  if (modes.includes("대중교통")) return RADIUS_PRESETS_BY_TRANSPORT["대중교통"];
  if (modes.includes("자전거/따릉이")) return RADIUS_PRESETS_BY_TRANSPORT["자전거/따릉이"];
  if (modes.includes("도보")) return RADIUS_PRESETS_BY_TRANSPORT["도보"];
  return DEFAULT_RADIUS_CONFIG;
}

export const MOOD_TAGS = [
  "설레는 첫만남",
  "편안한 데이트",
  "기념일/특별한 날",
  "액티브한 데이트",
  "조용한 힐링",
  "맛집 위주",
];

export const MAX_MOOD_TAGS = 3;

export const FREE_REQUEST_PLACEHOLDERS = [
  "예: 이탈리안 음식 좋아하고, 사람 너무 많은 곳은 피하고 싶어요",
  "예: 조용히 대화할 수 있는 곳 위주로 부탁해요",
  "예: 디저트 맛집 꼭 한 곳 넣어주세요",
];
