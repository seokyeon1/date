// 지도 마커/경로와 하단 타임라인 카드가 같은 색으로 매칭되도록 공유하는 팔레트.
// 최대 5개 스팟까지 서로 구분되는 색을 순서대로 사용한다.
export const STOP_COLORS = ["#f43f5e", "#f59e0b", "#0ea5e9", "#8b5cf6", "#10b981"];

export function colorForStop(index) {
  return STOP_COLORS[index % STOP_COLORS.length];
}
