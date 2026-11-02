import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/openai";
import { generateJson } from "@/lib/ai";
import { ApiError, errorResponse, readJson, requireText } from "@/lib/api-error";
import { fillPrompt, loadPrompt } from "@/lib/prompts";
import { maskPersonalInfo } from "@/lib/mask";
import { LIMITS } from "@/lib/limits";
import { PROMPT_VERSION } from "@/lib/config";
import { STRUCTURE_SCHEMA, checkFidelity, toMarkdown, type StructuredResume } from "@/lib/resume-structure";
import type { ResumeStructureResponse } from "@/lib/flow-types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 가린 이력서를 정해진 섹션의 MD로 정리한다 (TC-119~122).
 * 피그마·노션·원티드처럼 형식이 제각각인 이력서를 같은 모양으로 맞춰 뒤 단계 품질을 고르게 한다.
 * 정리 결과의 숫자가 원문에 있는지 검사해(수치 보존율) 화면에서 경고한다.
 */
export async function POST(req: Request) {
  try {
    const body = await readJson<{ text?: unknown }>(req);
    // 화면이 보낸 글은 이미 가린 글이지만, 외부 AI로 보내기 전에 한 번 더 가린다
    const source = maskPersonalInfo(requireText(body.text, "이력서", LIMITS.resumeChars)).text;

    if (isDemoMode()) {
      const res: ResumeStructureResponse = {
        markdown: source,
        fidelity: checkFidelity(source, source),
        structured: false,
        demo: true,
      };
      return NextResponse.json(res);
    }

    const prompt = fillPrompt(loadPrompt("resume-structure", PROMPT_VERSION.resumeStructure), { resume: source });
    const parsed = await generateJson<StructuredResume>(prompt, STRUCTURE_SCHEMA);
    // 모델이 가린 표시나 개인정보를 다시 쓰는 경우를 막기 위해 결과도 한 번 더 가린다
    const markdown = maskPersonalInfo(toMarkdown(parsed)).text;
    if (markdown.replace(/[#\s-]/g, "").length < 30) {
      throw new ApiError("AI_FAILED", "이력서를 정리하지 못했습니다. 원문을 그대로 쓰거나 다시 시도해 주세요.", 502);
    }

    const res: ResumeStructureResponse = {
      markdown,
      fidelity: checkFidelity(source, markdown),
      structured: true,
      demo: false,
    };
    return NextResponse.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
