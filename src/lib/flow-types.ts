/** 화면과 API가 함께 쓰는 데이터 모양 */

export type QuestionType = "resume" | "role" | "posting";

export type Question = { id: string; type: QuestionType; question: string };

export type MaskCounts = { name: number; birth: number; phone: number; email: number; url: number; custom: number };

export type ResumeResponse = { fileName?: string; text: string; counts: MaskCounts; chars: number };

export type ResumeStructureResponse = {
  markdown: string;
  fidelity: { ratio: number; total: number; missing: string[] };
  /** false면 정리하지 않고 원문을 그대로 돌려준 것 (데모 모드) */
  structured: boolean;
  demo: boolean;
};

export type QuestionsResponse = { questions: Question[]; demo: boolean; demoQuestionIds?: string[] };

export type ExperienceResponse = { prompts: string[]; hint: string; sampleExperience?: string; demo: boolean };

export type AnswerResponse = { answer: string; demo: boolean };

export type PostingResponse = { text: string; source: "pdf" | "image" };

/** rawResume: 가상 인물 샘플 원문 (가릴 단어를 추가해 다시 가릴 때 사용) */
export type SampleResponse = {
  resume: ResumeResponse;
  rawResume: string;
  posting: string;
  label: string;
  /** 가상 인물이 경험 질문에 답한 내용 (이력서의 "## 경험 답변"). 실제 키로 쓸 때도 바로 답변 초안을 만들어 볼 수 있게 */
  sampleExperience: string;
};

export type ApiErrorBody = { error: { code: string; message: string } };

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  resume: "이력서 기반",
  role: "직무 기반",
  posting: "공고 기반",
};

/** 질문 하나에 대해 사용자가 적은 경험과 그 경험으로 만든 답변 초안 */
export type Draft = {
  question: Question;
  experience: string;
  answer: string;
  /** 경험을 물을 때 받은 질문들. 초안을 다시 만들 때 또 묻지 않으려고 둔다 */
  exp?: ExperienceResponse;
};
