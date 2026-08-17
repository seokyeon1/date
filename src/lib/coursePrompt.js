export const ASSEMBLE_COURSE_TOOL = {
  name: "assemble_course",
  description:
    "candidate_places 목록만 사용해 시간대별 데이트 코스를 조립한다. 후보 목록에 없는 장소는 절대 만들어내지 않는다.",
  input_schema: {
    type: "object",
    properties: {
      stops: {
        type: "array",
        description: "시간 순으로 정렬된 코스 스팟 목록",
        items: {
          type: "object",
          properties: {
            order: { type: "integer", description: "1부터 시작하는 순서" },
            start_time: { type: "string", description: "HH:MM 형식 시작 시각" },
            end_time: { type: "string", description: "HH:MM 형식 종료 시각" },
            activity_type: {
              type: "string",
              description: "예: 식사, 카페, 문화/액티비티, 술집/야경",
            },
            kakao_place_id: {
              type: "string",
              description: "candidate_places 목록에 있는 장소의 kakao_place_id (필수)",
            },
            notes: { type: "string", description: "웨이팅, 예약 등 짧은 안내 (없으면 빈 문자열)" },
            alt_kakao_place_id: {
              type: "string",
              description: "같은 activity_type의 대안 후보 kakao_place_id (선택, 없으면 생략)",
            },
          },
          required: ["order", "start_time", "end_time", "activity_type", "kakao_place_id"],
        },
      },
      warnings: {
        type: "array",
        items: { type: "string" },
        description: "예산 초과, 시간 부족 등 사용자에게 알려야 할 경고 (없으면 빈 배열)",
      },
    },
    required: ["stops", "warnings"],
  },
};

export function buildSystemPrompt() {
  return `당신은 실제 장소 데이터를 근거로 데이트 코스를 짜는 어시스턴트입니다.
다음 규칙을 반드시 지키세요 (위반 시 서비스 신뢰도가 무너집니다):

1. 사용자 메시지에 포함된 candidate_places 목록에 있는 장소만 사용할 것. 목록에 없는 장소명을 절대 생성하지 말 것.
2. 각 스팟 선택 시 candidate_places의 kakao_place_id를 반드시 함께 반환할 것 (서버가 이 id로 검증함).
3. 가장 중요한 목표: 입력된 시작~종료 시각을 빈 시간 없이 최대한 꽉 채울 것. 후보가 남아있는 한 스팟 수를 늘려서라도 종료 시각까지 채우고, 종료 시각을 크게 초과하지도 않게 조정할 것.
4. 이동시간·이동거리는 직접 계산하지 말 것 (서버가 좌표 기반으로 별도 계산함). start_time/end_time만 논리적으로 배정할 것.
5. 각 스팟의 activity_type은 candidate_places에 표시된 activity_type 중에서 고를 것. 사용 가능한 activity_type에는 식사, 카페, 산책, 문화/액티비티, 영화관, 술집/야경, 숙소가 포함될 수 있다.
6. 특정 activity_type의 후보가 없으면 건너뛰고, 있는 후보 안에서 시간을 최대한 채우는 자연스러운 코스를 구성할 것. 영화관·산책·숙소 등도 실제 후보가 있다면 적극적으로 활용해 시간을 채울 것 (특정 유형을 배제하지 말 것).
7. 가능하면 activity_type별로 대안(alt_kakao_place_id)을 함께 제시할 것 (같은 activity_type의 다른 후보 중에서).
8. activity_type이 "식사" 또는 "카페"인 스팟은 start_time과 end_time의 차이를 정확히 60분(1시간)으로 배정할 것. "산책"은 남는 시간이 짧을 때 20~40분으로 유연하게 배정해 빈 시간을 메우는 용도로 사용해도 좋음.
9. "술집/야경", "숙소" 활동은 반드시 "식사"보다 뒤, 그리고 18시(숙소는 19시) 이후에만 배치할 것. "식사" 후보가 없다면 이 제약은 적용하지 않음.
10. 대한민국 커플들이 일반적으로 즐기는 데이트 코스 흐름(식사 → 카페 → 산책/문화·액티비티 → 영화관 → 필요 시 술집/야경 → 늦은 시간이면 숙소)을 참고해 자연스럽게 이어지는 순서로 구성할 것.
11. "식사" 스팟은 하루 최대 3회(아침 06~10시, 점심 11~14시, 저녁 17~21시)까지만 포함하고, 반드시 이 시간대 안에서만 배정할 것. 점심과 저녁 사이처럼 끼니 시간대가 아닌 때에 별도의 "식사" 스팟을 끼워 넣지 말 것.
11-1. "카페" 스팟은 하루에 최대 1곳만 포함할 것. 카페 후보가 여러 곳이거나 시간이 남아도 카페를 두 번 이상 배치하지 말 것.
11-2. 파리바게뜨, 뚜레쥬르, 던킨도너츠, 배스킨라빈스, 써브웨이 등 베이커리·도넛·아이스크림·샌드위치 위주의 프랜차이즈는 간식이지 식사가 아니므로 "식사" 스팟으로 선택하지 말 것. candidate_places의 "식사" 후보 중 이런 곳이 있더라도 다른 정식 식사 후보를 우선하고, 대안이 전혀 없을 때만 부득이하게 사용할 것.
12. "식사"를 제외한 나머지 유형은 바로 앞 스팟과 같은 activity_type을 연속으로 배치하지 말 것(예: 산책 다음에 바로 산책 금지). 같은 유형을 다시 쓰더라도 반드시 사이에 다른 유형을 끼워 넣을 것. 종료 시각까지 채우기 위해 꼭 필요하고 실제 후보가 남아있다면 같은 유형을 다시 사용해도 되지만, 연속 배치는 절대 금지.
13. 교통수단에 "자차"가 포함되어 있지 않다면(도보/대중교통/자전거만 있는 경우), candidate_places에 함께 제공된 좌표(lat,lng)를 참고해 연속된 두 스팟 간 거리가 가급적 가깝도록(같은 동네·인접 블록 위주로) 선택할 것. 특히 "도보"만 선택된 경우 지나치게 멀리 이동해야 하는 조합은 피할 것.
14. assemble_course 도구를 사용해서만 응답할 것.`;
}

export function buildUserPrompt({ meta, candidatesByType }) {
  const locationLabel = meta.region.gu || meta.region.station || meta.region.sido;
  const candidateSummary = Object.entries(candidatesByType)
    .map(([type, places]) => {
      const lines = places
        .map(
          (p) =>
            `  - id=${p.kakao_place_id} | ${p.name} | ${p.category} | ${p.address} | 좌표(lat,lng)=${p.lat},${p.lng}`
        )
        .join("\n");
      return `[${type}] 후보 ${places.length}곳\n${lines}`;
    })
    .join("\n\n");

  return `## 사용자 입력
- 날짜: ${meta.date}
- 시간대: ${meta.start_time} ~ ${meta.end_time}
- 지역: ${meta.region.sido} ${locationLabel} (반경 ${meta.radius_km}km)
- 교통수단: ${meta.transport_modes.join(", ")}
- 분위기/목적: ${meta.mood_tags.join(", ") || "무관"}
- 요청사항: ${meta.free_request || "없음"}

## candidate_places (이 목록의 장소만 사용 가능)
${candidateSummary}

위 규칙에 따라 시간대별 코스를 조립해 assemble_course 도구를 호출하세요.`;
}
