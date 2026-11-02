import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/openai";
import { generateText } from "@/lib/ai";
import { errorResponse, readJson, requireText } from "@/lib/api-error";
import { fillPrompt, loadPrompt } from "@/lib/prompts";
import { maskPersonalInfo } from "@/lib/mask";
import { cleanAnswer } from "@/lib/sanitize";
import { LIMITS } from "@/lib/limits";
import { PROMPT_VERSION } from "@/lib/config";
import { demoAnswer } from "@/lib/demo";
import type { AnswerResponse } from "@/lib/flow-types";

export const runtime = "nodejs";

/** 사용자가 답한 경험만으로 답변 초안 (TC-402, TC-403, BUG-001) */
export async function POST(req: Request) {
  try {
    const body = await readJson<{
      resume?: unknown;
      posting?: unknown;
      question?: unknown;
      questionId?: unknown;
      experience?: unknown;
    }>(req);
    const resume = maskPersonalInfo(requireText(body.resume, "이력서", LIMITS.resumeChars)).text;
    const posting = requireText(body.posting, "채용공고", LIMITS.postingChars);
    const question = requireText(body.question, "질문", 500);
    // 사용자가 직접 적은 경험에도 연락처 등이 들어갈 수 있어 한 번 더 가린다
    const experience = maskPersonalInfo(
      requireText(body.experience, "경험", LIMITS.experienceChars, LIMITS.experienceMinChars),
    ).text;

    if (isDemoMode()) {
      const res: AnswerResponse = { answer: demoAnswer(body.questionId), demo: true };
      return NextResponse.json(res);
    }

    const prompt = fillPrompt(loadPrompt("answer", PROMPT_VERSION.answer), { resume, posting, question, experience });
    const answer = cleanAnswer(await generateText(prompt));
    const res: AnswerResponse = { answer, demo: false };
    return NextResponse.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
