/**
 * 모의면접 진행 규칙. 화면과 서버가 같이 쓴다 (AI를 부르지 않는 순수 함수).
 *
 * 한 질문의 흐름: 면접관 질문 → 내 답 → 꼬리질문(최대 2개) → 질문별 피드백
 * "모르겠어요", 너무 짧은 답, 꼬리질문 개수 제한은 규칙으로 처리한다.
 * - 결과가 매번 같아서 테스트할 수 있고 (TC-502, 503, 507)
 * - AI를 부르지 않으니 비용이 들지 않는다
 */

export type TurnKind = "question" | "followup" | "retry" | "closing" | "answer";

export type InterviewTurn = { role: "interviewer" | "candidate"; kind: TurnKind; text: string };

export type InterviewFeedback = { good: string[]; improve: string[]; tip: string };

export type InterviewAction = "followup" | "retry" | "feedback";

export type InterviewResponse = {
  action: InterviewAction;
  /** 면접관이 할 말 (꼬리질문, 다시 요청, 마무리 인사) */
  message: string;
  /** action이 feedback일 때만 */
  feedback: InterviewFeedback | null;
  /** 꼬리질문의 근거 (지원자 답변·이력서에서 따온 구절). 평가(TC-504)용 */
  basis?: string;
  demo: boolean;
};

export const MAX_FOLLOWUPS = 2;
export const MAX_RETRIES = 2;
/** 공백을 뺀 글자 수가 이보다 적으면 너무 짧은 답 */
export const MIN_ANSWER_CHARS = 10;
export const MAX_ANSWER_CHARS = 2_000;
/** 한 질문 안의 대화 수 상한: 질문 1 + (답 + 꼬리질문/다시 요청) × 최대 4회 + 마지막 답 */
export const MAX_TURNS = 12;

export const MESSAGES = {
  dontKnow: "괜찮습니다. 똑같은 경험이 아니어도, 비슷한 상황에서 직접 해 본 일이 있다면 그 이야기를 해 주세요.",
  tooShort: "조금 더 구체적으로 말씀해 주시겠어요? 어떤 상황에서 무엇을 했고 결과가 어땠는지 이야기해 주세요.",
  offTopic: "면접 질문에 대한 답을 부탁드립니다. 질문을 다시 한번 떠올려 보시고 직접 해 본 일로 말씀해 주세요.",
  /** 관계는 있지만 구체적인 내용이 없는 답. 이력서에서 짚을 항목을 못 찾았을 때 */
  vague: "조금 더 구체적으로 부탁드립니다. 직접 해 본 일 하나를 골라 상황, 한 일, 결과 순서로 말씀해 주세요.",
  closing: "답변 잘 들었습니다. 이 질문은 여기까지 하겠습니다.",
} as const;

/** 답 전체가 "모르겠어요"류일 때만 (답 안에 "모르겠어서 찾아봤다"처럼 섞인 건 제외) */
const DONT_KNOW =
  /^(?:(?:음+|어+|흠+|글쎄요?|저는?|사실)[\s.,…~]*)*(?:잘\s*)?(?:모르겠(?:어요|습니다|네요)?|모름|몰라요|모릅니다|(?:기억|생각)이?\s*안\s*나(?:요|네요|습니다)?|패스|pass|없(?:어요|습니다))[\s.!…~ㅠㅜ]*$/i;

export function isDontKnow(answer: string): boolean {
  return DONT_KNOW.test(answer.trim());
}

export function isTooShort(answer: string): boolean {
  return answer.replace(/\s/g, "").length < MIN_ANSWER_CHARS;
}

const count = (turns: InterviewTurn[], kind: TurnKind) => turns.filter((t) => t.kind === kind).length;

export type RuleStep =
  | { type: "retry"; message: string }
  | { type: "feedback" }
  /** 규칙으로 정할 수 없음 → AI가 꼬리질문/마무리/무관한 답을 판단 */
  | { type: "ai" };

/**
 * 마지막 답을 보고 다음 단계를 규칙으로 정한다. 마지막 대화는 지원자의 답이어야 한다.
 * 다시 요청(retry)은 꼬리질문 개수에 세지 않는다.
 */
export function ruleStep(turns: InterviewTurn[]): RuleStep {
  const last = turns.at(-1);
  if (!last || last.role !== "candidate") throw new Error("마지막 대화가 지원자의 답이 아닙니다.");
  const retries = count(turns, "retry");
  const followups = count(turns, "followup");

  if (isDontKnow(last.text)) {
    const dontKnows = turns.filter((t) => t.role === "candidate" && isDontKnow(t.text)).length;
    // 처음 "모르겠어요"는 한 번 북돋고, 또 모르면 멈추지 않고 피드백으로 넘어간다 (TC-502)
    return dontKnows === 1 && retries < MAX_RETRIES ? { type: "retry", message: MESSAGES.dontKnow } : { type: "feedback" };
  }
  if (isTooShort(last.text)) {
    return retries < MAX_RETRIES ? { type: "retry", message: MESSAGES.tooShort } : { type: "feedback" };
  }
  if (followups >= MAX_FOLLOWUPS) return { type: "feedback" };
  return { type: "ai" };
}

/** 프롬프트에 넣을 대화 기록 */
export function transcript(turns: InterviewTurn[]): string {
  return turns.map((t) => `${t.role === "interviewer" ? "면접관" : "지원자"}: ${t.text}`).join("\n");
}

export function followupsLeft(turns: InterviewTurn[]): number {
  return Math.max(0, MAX_FOLLOWUPS - count(turns, "followup"));
}

export function retriesLeft(turns: InterviewTurn[]): number {
  return Math.max(0, MAX_RETRIES - count(turns, "retry"));
}

/** 요청으로 받은 대화가 올바른 모양인지 확인한다. 문제가 있으면 안내 문구, 없으면 null */
export function validateTurns(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 2) return "면접 대화가 비어 있습니다.";
  if (value.length > MAX_TURNS) return "한 질문의 대화가 너무 깁니다. 다음 질문으로 넘어가 주세요.";
  const kinds: TurnKind[] = ["question", "followup", "retry", "closing", "answer"];
  for (const t of value) {
    if (
      typeof t !== "object" ||
      t === null ||
      !["interviewer", "candidate"].includes((t as InterviewTurn).role) ||
      !kinds.includes((t as InterviewTurn).kind) ||
      typeof (t as InterviewTurn).text !== "string"
    ) {
      return "면접 대화 형식이 올바르지 않습니다.";
    }
    if ((t as InterviewTurn).text.length > MAX_ANSWER_CHARS) {
      return `답변은 ${MAX_ANSWER_CHARS.toLocaleString("ko-KR")}자 이하로 줄여 주세요.`;
    }
  }
  const last = value.at(-1) as InterviewTurn;
  if (last.role !== "candidate" || !last.text.trim()) return "답변을 입력해 주세요.";
  return null;
}

/** 모호한 답에는 이력서에 실제로 있는 항목을 짚어 다시 묻는다. 문장은 코드가 만들어 모델이 경험을 덧붙이지 못하게 한다 */
export function vagueMessage(resumeItem: string): string {
  // 이력서 제목의 "활동 2:", "사례 1." 같은 번호 머리는 떼고 말한다 (v4 평가: '활동 2: 학회 캠페인 기획')
  const name = resumeItem.replace(/^\s*(?:사례|활동|프로젝트|경력|경험)\s*\d+\s*[:.)]\s*/, "").trim() || resumeItem;
  return `이력서에 적어 주신 '${name}' 경험으로 말씀해 주실 수 있을까요? 그때 어떤 상황에서 무엇을 하셨는지 궁금합니다.`;
}

/** 띄어쓰기·문장부호·따옴표 차이는 무시하고 비교 */
function squash(text: string): string {
  return text.replace(/[\s.,·•…'"‘’“”()[\]「」『』:;!?~\-–—/]/g, "").toLowerCase();
}

/** quote가 text 안에 그대로 있는지 (모델이 "이력서에서 옮겼다"는 구절을 검증할 때) */
export function containsQuote(text: string, quote: string): boolean {
  const q = squash(quote);
  return q.length >= 2 && squash(text).includes(q);
}
