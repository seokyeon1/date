import { NextResponse } from "next/server";
import { buildCandidatePool, isPoolSufficient, buildCandidateMap } from "@/lib/candidateSearch";
import { assembleCourse, isClaudeConfigured } from "@/lib/claudeCourse";
import { assembleCourseRuleBased } from "@/lib/ruleBasedCourse";
import { buildCourseResponse } from "@/lib/buildCourseResponse";

function validateInput(body) {
  const errors = [];
  if (!body.startTime || !body.endTime) errors.push("시간대를 입력하세요.");
  if (body.startTime && body.endTime && body.startTime >= body.endTime) {
    errors.push("종료 시간은 시작 시간보다 늦어야 합니다.");
  }
  if (!body.region?.sido) {
    errors.push("지역을 선택하세요.");
  } else if (body.region.mode === "station") {
    const station = body.region.station;
    if (!station?.name || typeof station.lat !== "number" || typeof station.lng !== "number") {
      errors.push("지하철역을 선택하세요.");
    }
  } else if (!body.region.gu) {
    errors.push("지역을 선택하세요.");
  }
  if (!body.radiusKm) errors.push("이동 반경을 선택하세요.");
  if (!Array.isArray(body.transportModes) || body.transportModes.length === 0) {
    errors.push("교통수단을 1개 이상 선택하세요.");
  }
  if (!Array.isArray(body.moodTags) || body.moodTags.length === 0) {
    errors.push("목적/분위기를 1개 이상 선택하세요.");
  }
  return errors;
}

function metaFor(input) {
  return {
    date: input.date,
    start_time: input.startTime,
    end_time: input.endTime,
    region: input.region,
    radius_km: input.radiusKm,
    transport_modes: input.transportModes,
    mood_tags: input.moodTags,
    free_request: input.freeRequest,
  };
}

// 후보 검색 -> (가능하면 Claude, 아니면 규칙 기반) 조립까지 한 번 시도한다.
// 실패하면 error 필드로 어떤 이유인지 알려준다(SEARCH_FAILED/INVALID_REGION/
// INSUFFICIENT_CANDIDATES/GENERATION_FAILED) — 호출부가 이 값으로 재시도 여부를 결정한다.
async function tryGenerateCourse(input, { allowClaude }) {
  const meta = metaFor(input);

  let pool;
  try {
    pool = await buildCandidatePool(input);
  } catch (err) {
    console.error("[generate-course] candidate search failed", err);
    return {
      error: "SEARCH_FAILED",
      message: "실제 장소를 검색하는 중 문제가 발생했습니다.",
      status: 502,
    };
  }

  if (!pool.center) {
    return {
      error: "INVALID_REGION",
      message: "입력하신 지역의 좌표를 찾을 수 없습니다.",
      status: 422,
    };
  }

  if (!isPoolSufficient(pool.candidatesByType)) {
    return {
      error: "INSUFFICIENT_CANDIDATES",
      message: "선택하신 반경 내에서 충분한 후보 장소를 찾지 못했습니다.",
      status: 422,
    };
  }

  const candidateMap = buildCandidateMap(pool.candidatesByType);
  let assembled = null;

  if (allowClaude && isClaudeConfigured()) {
    try {
      assembled = await assembleCourse({ meta, candidatesByType: pool.candidatesByType, candidateMap });
    } catch (err) {
      console.error("[generate-course] claude assembly failed, falling back to rule-based", err);
    }
  }

  if (!assembled) {
    assembled = await assembleCourseRuleBased({
      meta,
      candidatesByType: pool.candidatesByType,
      center: pool.center,
      candidateMap,
    });
  }

  if (!assembled) {
    return {
      error: "GENERATION_FAILED",
      message: "유효한 코스를 생성하지 못했습니다. 다시 시도해주세요.",
      status: 502,
    };
  }

  return { assembled, candidateMap, meta };
}

const RADIUS_MAX_KM = 20;

function roundKm(km) {
  return Math.round(km * 10) / 10;
}

// 원래 조건으로 충분한 후보/코스를 만들지 못했을 때 단계적으로 조건을 완화해 재시도한다.
// 뒤 단계로 갈수록 더 넓게 풀어보고, 성공한 단계에서 "무엇을 완화했는지"를 안내 문구로
// 남긴다. 첫 단계(원본 조건)만 Claude를 시도하고, 이후 완화 단계는 규칙 기반으로 바로
// 처리해 불필요한 LLM 재호출(비용·지연)을 피한다.
const RELAXATION_STEPS = [
  {
    relax: (base) => ({ radiusKm: base.radiusKm }),
    describe: null,
  },
  {
    relax: (base) => ({ radiusKm: roundKm(Math.min(base.radiusKm * 1.6, RADIUS_MAX_KM)) }),
    describe: (base, next) =>
      `입력하신 반경(${base.radiusKm}km) 내에는 충분한 장소가 없어 반경을 ${next.radiusKm}km로 넓혀 추천했어요.`,
  },
  {
    relax: (base) => ({
      radiusKm: roundKm(Math.min(base.radiusKm * 2.5, RADIUS_MAX_KM)),
      freeRequest: "",
    }),
    describe: (base, next) =>
      base.freeRequest
        ? `반경(${base.radiusKm}km)과 요청사항("${base.freeRequest}") 조건으로는 충분한 장소를 찾지 못해, 요청사항 조건을 잠시 접어두고 반경을 ${next.radiusKm}km로 넓혀 추천했어요.`
        : `입력하신 반경(${base.radiusKm}km) 내에는 충분한 장소가 없어 반경을 ${next.radiusKm}km로 넓혀 추천했어요.`,
  },
  {
    relax: (base) => ({
      radiusKm: roundKm(Math.min(base.radiusKm * 2.5, RADIUS_MAX_KM)),
      freeRequest: "",
      moodTags: [],
    }),
    describe: (base, next) =>
      `입력하신 조건(반경 ${base.radiusKm}km, 분위기 "${base.moodTags.join(", ")}"${
        base.freeRequest ? `, 요청사항 "${base.freeRequest}"` : ""
      })으로는 충분한 장소를 찾지 못해, 분위기·요청사항 조건을 완화하고 반경을 ${next.radiusKm}km로 넓혀 추천했어요. 원하는 분위기가 아니라면 조건을 바꿔 다시 만들어보세요.`,
  },
];

const RETRYABLE_ERRORS = new Set(["INSUFFICIENT_CANDIDATES", "GENERATION_FAILED"]);

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_INPUT", message: "요청 본문을 파싱할 수 없습니다." },
      { status: 400 }
    );
  }

  const errors = validateInput(body);
  if (errors.length > 0) {
    return NextResponse.json(
      { error: "INVALID_INPUT", message: errors.join(" ") },
      { status: 400 }
    );
  }

  const input = {
    date: body.date || new Date().toISOString().slice(0, 10),
    startTime: body.startTime,
    endTime: body.endTime,
    region: body.region,
    radiusKm: body.radiusKm,
    transportModes: body.transportModes,
    moodTags: body.moodTags,
    freeRequest: body.freeRequest || "",
  };

  let outcome = null;
  let attemptInput = input;
  let stepIndex = 0;
  let lastFailure = null;

  for (let i = 0; i < RELAXATION_STEPS.length; i++) {
    const step = RELAXATION_STEPS[i];
    attemptInput = { ...input, ...step.relax(input) };

    outcome = await tryGenerateCourse(attemptInput, { allowClaude: i === 0 });

    if (!outcome.error) {
      stepIndex = i;
      break;
    }

    lastFailure = outcome;

    // 지역 좌표를 못 찾았거나 검색 자체가 실패한 경우 조건을 완화해도 소용없으므로
    // 즉시 반환한다 (반경/분위기 문제가 아니라 입력 지역·네트워크/API 문제이기 때문).
    if (!RETRYABLE_ERRORS.has(outcome.error)) {
      return NextResponse.json({ error: outcome.error, message: outcome.message }, { status: outcome.status });
    }

    outcome = null; // 다음 완화 단계로 계속 시도
  }

  if (!outcome) {
    return NextResponse.json(
      {
        error: lastFailure.error,
        message: `${lastFailure.message} 반경을 최대 ${RADIUS_MAX_KM}km까지 넓히고 분위기·요청사항 조건도 완화해봤지만 충분한 장소를 찾지 못했습니다. 지역을 바꿔보시는 걸 추천해요.`,
      },
      { status: lastFailure.status }
    );
  }

  const { assembled, candidateMap } = outcome;
  const relaxationNote = stepIndex > 0 ? RELAXATION_STEPS[stepIndex].describe(input, attemptInput) : null;
  const warnings = relaxationNote ? [relaxationNote, ...(assembled.warnings || [])] : assembled.warnings;

  const course = await buildCourseResponse({
    input: attemptInput,
    stops: assembled.stops,
    warnings,
    candidateMap,
  });

  return NextResponse.json({ course });
}
