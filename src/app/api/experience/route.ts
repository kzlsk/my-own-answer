import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/openai";
import { generateJson } from "@/lib/ai";
import { errorResponse, readJson, requireText } from "@/lib/api-error";
import { fillPrompt, loadPrompt } from "@/lib/prompts";
import { maskPersonalInfo } from "@/lib/mask";
import { LIMITS } from "@/lib/limits";
import { PROMPT_VERSION } from "@/lib/config";
import { demoExperience } from "@/lib/demo";
import type { ExperienceResponse } from "@/lib/flow-types";

export const runtime = "nodejs";

const SCHEMA = {
  name: "experience_prompts",
  strict: true,
  schema: {
    type: "object",
    properties: {
      prompts: { type: "array", items: { type: "string" } },
      hint: { type: "string" },
    },
    required: ["prompts", "hint"],
    additionalProperties: false,
  },
};

/** 답변 초안을 쓰기 전에 관련 경험을 묻는 질문 (TC-401) */
export async function POST(req: Request) {
  try {
    const body = await readJson<{ resume?: unknown; posting?: unknown; question?: unknown; questionId?: unknown }>(req);
    const resume = maskPersonalInfo(requireText(body.resume, "이력서", LIMITS.resumeChars)).text;
    const posting = requireText(body.posting, "채용공고", LIMITS.postingChars);
    const question = requireText(body.question, "질문", 500);

    if (isDemoMode()) return NextResponse.json(demoExperience(body.questionId));

    const prompt = fillPrompt(loadPrompt("experience", PROMPT_VERSION.experience), { resume, posting, question });
    const out = await generateJson<{ prompts: string[]; hint: string }>(prompt, SCHEMA);
    const res: ExperienceResponse = {
      prompts: out.prompts.map((p) => p.trim()).filter(Boolean).slice(0, 3),
      hint: out.hint.trim(),
      demo: false,
    };
    return NextResponse.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
