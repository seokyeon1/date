import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ASSEMBLE_COURSE_TOOL, buildSystemPrompt, buildUserPrompt } from "./coursePrompt";

const MODEL = "claude-opus-5";
const MAX_RETRIES = 2;

export function isClaudeConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function extractToolInput(message) {
  const block = message.content.find(
    (b) => b.type === "tool_use" && b.name === "assemble_course"
  );
  return block ? block.input : null;
}

// LLM 응답의 kakao_place_id를 candidate_places와 재대조 검증한다.
// 검증에 실패하면 재생성을 요청하고, 최종 실패 시 null을 반환한다.
export async function assembleCourse({ meta, candidatesByType, candidateMap }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = buildSystemPrompt();
  const messages = [
    { role: "user", content: buildUserPrompt({ meta, candidatesByType }) },
  ];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      tools: [ASSEMBLE_COURSE_TOOL],
      tool_choice: { type: "tool", name: "assemble_course" },
      output_config: { effort: "medium" },
      messages,
    });

    const toolUseBlock = response.content.find(
      (b) => b.type === "tool_use" && b.name === "assemble_course"
    );
    const parsed = extractToolInput(response);

    if (!parsed) {
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseBlock?.id || "unknown",
            content: "assemble_course 도구 호출이 감지되지 않았습니다. 다시 호출하세요.",
            is_error: true,
          },
        ],
      });
      continue;
    }

    const invalidIds = [];
    for (const stop of parsed.stops || []) {
      if (!candidateMap.has(String(stop.kakao_place_id))) {
        invalidIds.push(stop.kakao_place_id);
      }
      if (stop.alt_kakao_place_id && !candidateMap.has(String(stop.alt_kakao_place_id))) {
        invalidIds.push(stop.alt_kakao_place_id);
      }
    }

    if (invalidIds.length === 0 && (parsed.stops || []).length > 0) {
      return { stops: parsed.stops, warnings: parsed.warnings || [] };
    }

    // 검증 실패 -> 후보 목록에 있는 id만 사용하도록 재요청
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseBlock.id,
          content: `다음 kakao_place_id는 candidate_places 목록에 존재하지 않습니다: ${invalidIds.join(
            ", "
          )}. candidate_places 목록에 실제로 있는 id만 사용해서 다시 응답하세요.`,
          is_error: true,
        },
      ],
    });
  }

  return null;
}
