import demo from "@/demo/demo.json";
import type { ExperienceResponse, Question } from "@/lib/flow-types";
import type { InterviewFeedback } from "@/lib/interview";
import { ApiError } from "@/lib/api-error";

type DemoInterview = { followups: string[]; feedback: InterviewFeedback };
type DemoFlow = { prompts: string[]; hint: string; sampleExperience: string; answer: string; interview?: DemoInterview };

const flows = demo.flows as Record<string, DemoFlow>;

export const demoQuestionIds = Object.keys(flows);

export function demoQuestions(): Question[] {
  return demo.questions as Question[];
}

function flowFor(questionId: unknown): DemoFlow {
  const flow = typeof questionId === "string" ? flows[questionId] : undefined;
  if (!flow) {
    throw new ApiError("BAD_REQUEST", "데모 모드에서는 ★ 표시된 질문만 체험할 수 있어요.", 400);
  }
  return flow;
}

export function demoExperience(questionId: unknown): ExperienceResponse {
  const f = flowFor(questionId);
  return { prompts: f.prompts, hint: f.hint, sampleExperience: f.sampleExperience, demo: true };
}

export function demoAnswer(questionId: unknown): string {
  return flowFor(questionId).answer;
}

export const demoInput = { resumeId: demo.resumeId, postingId: demo.postingId };

/** 데모 모드 모의면접: 지원자 답과 상관없이 미리 정해 둔 꼬리질문과 피드백 */
export function demoInterview(questionId: unknown): DemoInterview {
  const f = flowFor(questionId);
  return (
    f.interview ?? {
      followups: ["방금 말씀하신 경험에서 가장 어려웠던 점은 무엇이었나요?", "그 경험에서 배운 점을 이 직무에 어떻게 쓰실 건가요?"],
      feedback: { good: ["질문에 맞는 실제 경험으로 답했습니다."], improve: ["결과를 수치로 말해 보세요."], tip: "상황 → 한 일 → 결과 순서로 1분 안에 말해 보세요." },
    }
  );
}
