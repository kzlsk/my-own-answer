import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/openai";
import { generateJson } from "@/lib/ai";
import { ApiError, errorResponse, readJson, requireText } from "@/lib/api-error";
import { maskPersonalInfo } from "@/lib/mask";
import { LIMITS } from "@/lib/limits";
import { demoInterview } from "@/lib/demo";
import {
  MESSAGES,
  ruleStep,
  validateTurns,
  type InterviewFeedback,
  type InterviewResponse,
  type InterviewTurn,
} from "@/lib/interview";
import {
  FEEDBACK_SCHEMA,
  decide,
  interviewerSchema,
  cleanFeedback,
  feedbackPrompt,
  interviewerPrompt,
  maskTurns,
  type InterviewerDecision,
} from "@/lib/interview-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 모의면접 한 걸음: 지원자의 마지막 답을 받아 면접관의 다음 말을 정한다 (TC-501~510)
 * 1) 규칙: "모르겠어요"·너무 짧은 답·꼬리질문 2개 → AI 없이 처리
 * 2) AI(interviewer): 꼬리질문 / 마무리 / 무관한 답 판단
 * 3) 마무리면 AI(interview-feedback)로 질문별 피드백
 */
export async function POST(req: Request) {
  try {
    const body = await readJson<{
      resume?: unknown;
      posting?: unknown;
      question?: unknown;
      questionId?: unknown;
      draft?: unknown;
      turns?: unknown;
    }>(req);
    const resume = maskPersonalInfo(requireText(body.resume, "이력서", LIMITS.resumeChars)).text;
    const posting = requireText(body.posting, "채용공고", LIMITS.postingChars);
    const question = requireText(body.question, "질문", 500);
    const draft = typeof body.draft === "string" ? body.draft.slice(0, LIMITS.experienceChars) : "";
    const invalid = validateTurns(body.turns);
    if (invalid) throw new ApiError(invalid === "답변을 입력해 주세요." ? "EMPTY_INPUT" : "BAD_REQUEST", invalid);
    const turns = maskTurns(body.turns as InterviewTurn[]);

    const reply = (r: Omit<InterviewResponse, "demo">) => NextResponse.json({ ...r, demo: isDemoMode() } satisfies InterviewResponse);
    const finish = (feedback: InterviewFeedback) => reply({ action: "feedback", message: MESSAGES.closing, feedback });

    const rule = ruleStep(turns);
    if (rule.type === "retry") return reply({ action: "retry", message: rule.message, feedback: null });

    if (isDemoMode()) {
      const demo = demoInterview(body.questionId);
      const asked = turns.filter((t) => t.kind === "followup").length;
      if (rule.type === "feedback" || asked >= demo.followups.length) return finish(demo.feedback);
      return reply({ action: "followup", message: demo.followups[asked], feedback: null });
    }

    const ctx = { resume, posting, question, draft, turns };
    if (rule.type === "ai") {
      const d = await generateJson<InterviewerDecision>(interviewerPrompt(ctx), interviewerSchema());
      const next = decide(d, { turns, resume });
      if (next.action !== "feedback") return reply({ ...next, feedback: null });
    }
    const f = await generateJson<InterviewFeedback>(feedbackPrompt(ctx), FEEDBACK_SCHEMA);
    return finish(cleanFeedback(f));
  } catch (e) {
    return errorResponse(e);
  }
}
