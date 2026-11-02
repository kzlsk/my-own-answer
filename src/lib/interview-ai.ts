import { fillPrompt, loadPrompt } from "@/lib/prompts";
import { maskPersonalInfo } from "@/lib/mask";
import { PROMPT_VERSION } from "@/lib/config";
import {
  MESSAGES,
  containsQuote,
  followupsLeft,
  retriesLeft,
  transcript,
  vagueMessage,
  type InterviewAction,
  type InterviewFeedback,
  type InterviewTurn,
} from "@/lib/interview";

/**
 * 모의면접의 AI 부분: 프롬프트 만들기와 응답 모양(JSON 스키마).
 * API 라우트와 평가 스크립트(eval:interview)가 같은 함수를 쓰도록 "server-only" 없이 둔다.
 */

export type InterviewerDecision = {
  /** vague는 v3부터: 질문과 관계는 있지만 구체적인 행동·수치·이름이 없는 답 */
  intent: "answer" | "vague" | "off_topic";
  action: "followup" | "finish";
  message: string;
  basis: string;
  /** v3부터: 모호한 답일 때 짚을 이력서 항목 이름 (이력서에서 그대로 옮김) */
  resume_item?: string;
};

/** v1·v2가 받은 응답 모양. 평가를 같은 조건으로 다시 돌릴 수 있게 남겨 둔다 */
const LEGACY_INTERVIEWER_SCHEMA = {
  name: "interviewer_decision",
  strict: true,
  schema: {
    type: "object",
    properties: {
      intent: { type: "string", enum: ["answer", "off_topic"] },
      action: { type: "string", enum: ["followup", "finish"] },
      message: { type: "string" },
      basis: { type: "string" },
    },
    required: ["intent", "action", "message", "basis"],
    additionalProperties: false,
  },
};

const INTERVIEWER_SCHEMA_V3 = {
  name: "interviewer_decision",
  strict: true,
  schema: {
    type: "object",
    properties: {
      intent: { type: "string", enum: ["answer", "vague", "off_topic"] },
      action: { type: "string", enum: ["followup", "finish"] },
      message: { type: "string" },
      basis: { type: "string" },
      resume_item: { type: "string" },
    },
    required: ["intent", "action", "message", "basis", "resume_item"],
    additionalProperties: false,
  },
};

export function interviewerSchema(version = PROMPT_VERSION.interviewer) {
  return version === "v1" || version === "v2" ? LEGACY_INTERVIEWER_SCHEMA : INTERVIEWER_SCHEMA_V3;
}

export const FEEDBACK_SCHEMA = {
  name: "interview_feedback",
  strict: true,
  schema: {
    type: "object",
    properties: {
      good: { type: "array", items: { type: "string" } },
      improve: { type: "array", items: { type: "string" } },
      tip: { type: "string" },
    },
    required: ["good", "improve", "tip"],
    additionalProperties: false,
  },
};

/** 지원자가 면접에서 한 말에도 연락처가 들어갈 수 있어 AI에 보내기 전에 가린다 (TC-508) */
export function maskTurns(turns: InterviewTurn[]): InterviewTurn[] {
  return turns.map((t) => (t.role === "candidate" ? { ...t, text: maskPersonalInfo(t.text).text } : t));
}

type Context = { resume: string; posting: string; question: string; draft: string; turns: InterviewTurn[] };

export function interviewerPrompt(c: Context, version = PROMPT_VERSION.interviewer): string {
  return fillPrompt(loadPrompt("interviewer", version), {
    resume: c.resume,
    posting: c.posting,
    question: c.question,
    draft: c.draft || "(없음)",
    followupsLeft: String(followupsLeft(c.turns)),
    transcript: transcript(c.turns),
  });
}

export function feedbackPrompt(c: Context, version = PROMPT_VERSION.interviewFeedback): string {
  return fillPrompt(loadPrompt("interview-feedback", version), {
    resume: c.resume,
    posting: c.posting,
    question: c.question,
    draft: c.draft || "(없음)",
    transcript: transcript(c.turns),
  });
}

/** 모델이 빈 배열·빈 문자열을 섞어 보내도 화면이 깨지지 않게 정리 */
export function cleanFeedback(f: InterviewFeedback): InterviewFeedback {
  const list = (xs: unknown) =>
    (Array.isArray(xs) ? xs : []).filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 3);
  return { good: list(f.good), improve: list(f.improve), tip: typeof f.tip === "string" ? f.tip.trim() : "" };
}

export type InterviewStep = { action: InterviewAction; message: string; basis?: string };

/**
 * 면접관 모델의 판단을 앱이 실제로 할 말로 바꾼다. API 라우트와 평가 스크립트가 같이 쓴다.
 * - 무관한 답·모호한 답 → 다시 요청 (질문당 2번까지, 꼬리질문 개수에 세지 않음). 문장은 코드가 정한다
 * - 모호한 답에서 짚을 이력서 항목은 이력서에 정말 있는지 확인한 뒤에만 쓴다 (없는 경험을 만들지 못하게)
 * - 꼬리질문이 남아 있고 모델이 꼬리질문을 골랐을 때만 묻는다. 그 밖에는 피드백(message 없음)
 */
export function decide(d: InterviewerDecision, ctx: { turns: InterviewTurn[]; resume: string }): InterviewStep {
  if (d.intent === "off_topic" || d.intent === "vague") {
    if (retriesLeft(ctx.turns) === 0) return { action: "feedback", message: "" };
    if (d.intent === "off_topic") return { action: "retry", message: MESSAGES.offTopic };
    const item = (d.resume_item ?? "").trim();
    return { action: "retry", message: item && containsQuote(ctx.resume, item) ? vagueMessage(item) : MESSAGES.vague };
  }
  if (d.action === "followup" && d.message.trim() && followupsLeft(ctx.turns) > 0) {
    return { action: "followup", message: d.message.trim(), basis: d.basis };
  }
  return { action: "feedback", message: "" };
}
