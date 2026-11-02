import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/openai";
import { generateJson } from "@/lib/ai";
import { ApiError, errorResponse, readJson, requireText } from "@/lib/api-error";
import { fillPrompt, loadPrompt } from "@/lib/prompts";
import { maskPersonalInfo } from "@/lib/mask";
import { looksLikePosting } from "@/lib/posting";
import { LIMITS } from "@/lib/limits";
import { PROMPT_VERSION } from "@/lib/config";
import { demoQuestionIds, demoQuestions } from "@/lib/demo";
import type { Question, QuestionsResponse, QuestionType } from "@/lib/flow-types";

export const runtime = "nodejs";

const SCHEMA = {
  name: "interview_questions",
  strict: true,
  schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["resume", "role", "posting"] },
            question: { type: "string" },
          },
          required: ["type", "question"],
          additionalProperties: false,
        },
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
};

export async function POST(req: Request) {
  try {
    const body = await readJson<{ resume?: unknown; posting?: unknown }>(req);
    const resume = maskPersonalInfo(requireText(body.resume, "이력서", LIMITS.resumeChars)).text;
    const posting = requireText(body.posting, "채용공고", LIMITS.postingChars, LIMITS.postingMinChars);
    if (!looksLikePosting(posting)) {
      throw new ApiError("NOT_POSTING", "채용공고로 보이지 않습니다. 담당 업무, 자격요건 등이 들어간 공고 본문을 붙여넣어 주세요.", 422);
    }

    if (isDemoMode()) {
      const res: QuestionsResponse = { questions: demoQuestions(), demo: true, demoQuestionIds };
      return NextResponse.json(res);
    }

    const prompt = fillPrompt(loadPrompt("question", PROMPT_VERSION.question), { resume, posting });
    const out = await generateJson<{ questions: { type: QuestionType; question: string }[] }>(prompt, SCHEMA);
    const questions: Question[] = out.questions
      .filter((q) => q.question?.trim())
      .map((q, i) => ({ id: `q${i + 1}`, type: q.type, question: q.question.trim() }));
    if (questions.length === 0) throw new ApiError("AI_FAILED", "질문이 만들어지지 않았습니다. 다시 시도해 주세요.", 502);

    const res: QuestionsResponse = { questions, demo: false };
    return NextResponse.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
