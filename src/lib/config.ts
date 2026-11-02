/** 앱에서 쓰는 프롬프트 버전. 평가로 더 나은 버전이 정해지면 여기서 바꾼다 */
export const PROMPT_VERSION = {
  question: process.env.QUESTION_PROMPT_VERSION || "v1",
  experience: process.env.EXPERIENCE_PROMPT_VERSION || "v1",
  answer: process.env.ANSWER_PROMPT_VERSION || "v2", // v1 42.9% → v2 90.0% (data/results/compare-answer-v1-v2.md)
  postingOcr: process.env.POSTING_OCR_PROMPT_VERSION || "v2", // v1은 실제 공고에서 단어 바꿔 적기·회사 소개 누락 (BUG-007)
  interviewer: process.env.INTERVIEWER_PROMPT_VERSION || "v4", // 정상 답 파고듦 5/5 + 지어냄 0/15, 모호한 답은 이력서 항목으로 다시 물음 7/10 (data/results/compare-interviewer-v1-v2-v3.md)
  interviewFeedback: process.env.INTERVIEW_FEEDBACK_PROMPT_VERSION || "v1",
  resumeStructure: process.env.RESUME_STRUCTURE_PROMPT_VERSION || "v1",
};
