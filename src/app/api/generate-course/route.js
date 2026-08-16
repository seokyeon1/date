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

  let pool;
  try {
    pool = await buildCandidatePool(input);
  } catch (err) {
    console.error("[generate-course] candidate search failed", err);
    return NextResponse.json(
      { error: "SEARCH_FAILED", message: "실제 장소를 검색하는 중 문제가 발생했습니다." },
      { status: 502 }
    );
  }

  if (!pool.center) {
    return NextResponse.json(
      { error: "INVALID_REGION", message: "입력하신 지역의 좌표를 찾을 수 없습니다." },
      { status: 422 }
    );
  }

  if (!isPoolSufficient(pool.candidatesByType)) {
    return NextResponse.json(
      {
        error: "INSUFFICIENT_CANDIDATES",
        message: "선택하신 반경 내에서 충분한 후보 장소를 찾지 못했습니다.",
      },
      { status: 422 }
    );
  }

  const meta = {
    date: input.date,
    start_time: input.startTime,
    end_time: input.endTime,
    region: input.region,
    radius_km: input.radiusKm,
    transport_modes: input.transportModes,
    mood_tags: input.moodTags,
    free_request: input.freeRequest,
  };

  const candidateMap = buildCandidateMap(pool.candidatesByType);

  let assembled = null;

  if (isClaudeConfigured()) {
    try {
      assembled = await assembleCourse({ meta, candidatesByType: pool.candidatesByType, candidateMap });
    } catch (err) {
      console.error("[generate-course] claude assembly failed, falling back to rule-based", err);
    }
  }

  if (!assembled) {
    // Claude 키가 없거나 호출에 실패한 경우, 규칙 기반 로직으로 폴백해 항상 결과를 돌려준다.
    assembled = await assembleCourseRuleBased({
      meta,
      candidatesByType: pool.candidatesByType,
      center: pool.center,
      candidateMap,
    });
  }

  if (!assembled) {
    return NextResponse.json(
      {
        error: "GENERATION_FAILED",
        message: "유효한 코스를 생성하지 못했습니다. 다시 시도해주세요.",
      },
      { status: 502 }
    );
  }

  const course = await buildCourseResponse({
    input,
    stops: assembled.stops,
    warnings: assembled.warnings,
    candidateMap,
  });

  return NextResponse.json({ course });
}
