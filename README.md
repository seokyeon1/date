# 데이트 코스 추천 AI (v1)

시간대·지역·교통수단·분위기·요청사항 5가지만 입력하면, 카카오 로컬 API로 검색한 실제
장소 후보 중에서 Claude가 시간대별 데이트 코스를 조립해주는 웹앱입니다.

## 스택

- 프론트엔드: React 19 (Next.js App Router) + Tailwind CSS
- 백엔드: Next.js API Route (`/api/generate-course`) — API 키는 서버에서만 사용
- 장소 검색: 카카오 로컬 API (키워드/카테고리 검색, 좌표+반경)
- 코스 조립: Anthropic Claude API (`claude-opus-5`, tool use로 구조화된 출력 강제)
- 엑셀 다운로드: SheetJS(xlsx), 클라이언트에서 생성

## 환경 변수

`.env.local` 파일에 아래 값을 채워주세요 (`.env.example` 참고). 두 키 모두 서버 사이드에서만
읽히며 클라이언트 번들에 노출되지 않습니다.

```
KAKAO_REST_API_KEY=카카오_디벨로퍼스_REST_API_키
ANTHROPIC_API_KEY=Anthropic_API_키
```

- 카카오 REST API 키: [카카오 디벨로퍼스](https://developers.kakao.com) > 내 애플리케이션 > 앱 키 > REST API 키
- Anthropic API 키: [Anthropic Console](https://console.anthropic.com) > API Keys

## 개발 서버 실행

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) 에서 확인할 수 있습니다.

## 동작 흐름

1. 사용자가 시간대/지역/반경/교통수단/목적·분위기/요청사항을 입력
2. 서버가 카카오 로컬 API로 구/군 중심 좌표를 구하고, 좌표+반경 기반으로 식사/카페/문화·액티비티
   (필요 시 저녁 술집) 카테고리 후보를 수집
3. 후보가 부족하면 "반경을 넓혀볼까요?" 안내를 반환 (LLM 호출 없이 조기 종료)
4. 후보 목록을 Claude에게 tool use로 전달 — "후보 목록에 있는 장소만 선택하고 kakao_place_id를
   반드시 반환할 것" 등 환각 방지 규칙을 시스템 프롬프트로 강제
5. 서버가 응답의 kakao_place_id를 후보 목록과 재대조 검증 (없는 id면 최대 2회 재요청)
6. 장소의 이름/주소/전화/지도링크 등 사실 정보는 **항상 카카오 후보 데이터에서** 채움 (LLM이
   생성한 텍스트를 신뢰하지 않음). LLM은 순서·시간·activity_type만 결정
7. 이동시간은 카카오모빌리티 Directions API 승인 전까지 좌표 간 직선거리 + 이동수단별 평균 속도로
   추정 (`src/lib/distance.js`). 승인 후에는 이 파일만 실제 Directions API 호출로 교체하면 됨
8. 결과 JSON을 기준으로 타임라인 화면 렌더링, 텍스트 복사, 엑셀 다운로드 제공

## 주요 파일

- `src/lib/regions.js` — 시/도 → 시/군/구 데이터 (좌표는 런타임에 카카오 주소 검색으로 조회)
- `src/lib/kakaoLocal.js` — 카카오 로컬 API 클라이언트 (주소 검색, 키워드 검색)
- `src/lib/candidateSearch.js` — 입력 → 검색 키워드 매핑, 후보 풀 구성, 충분성 판단
- `src/lib/coursePrompt.js` / `src/lib/claudeCourse.js` — 환각 방지 시스템 프롬프트, tool use 호출,
  place_id 재검증 및 재시도
- `src/lib/buildCourseResponse.js` — 최종 코스 JSON 조립 (이동시간 계산 포함)
- `src/app/api/generate-course/route.js` — 위 흐름을 엮는 API 라우트
- `src/components/InputForm.jsx` — 하이브리드(칩+직접입력) 입력 폼
- `src/components/ResultView.jsx` — 로딩/에러/결과없음/정상 4가지 상태 렌더링
- `src/lib/textTemplate.js` / `src/lib/excelExport.js` — 텍스트 복사 / 엑셀 다운로드 렌더러

## v1 범위 (Now)

기획서 16장 로드맵 기준 Now(v1) 범위만 구현했습니다: 필수 5개 입력, 카카오 로컬 API 연동,
환각 방지 검증, 텍스트/엑셀 출력, 반경 내 후보 부족 시 안내. 예산·음식 선호 필터, 부분 재생성,
실제 이동시간(카카오모빌리티) 반영, 날씨 연동 등은 Next/Later 범위로 이번 구현에는 포함하지
않았습니다.
