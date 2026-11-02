/**
 * 데모 모드 샘플을 실제 생성 결과로 만든다.
 *
 *   npm run demo:build
 *
 * 가상 이력서 r03-qa × 공고 p03-qa로 앱과 같은 프롬프트(src/lib/config.ts의 버전)를 실행해
 * src/demo/demo.json을 덮어쓴다. 데모로 끝까지 체험할 질문은 공고 기반 첫 질문과 마지막 질문 2개.
 * 경험 입력은 이력서의 "## 경험 답변" 섹션을 그대로 쓴다.
 * 모의면접 데모: 지원자 답으로 ① 경험 답변 ② 답변 초안을 넣어 꼬리질문 2개와 피드백을 만든다
 * (데모에서는 사용자가 무엇을 답하든 이 꼬리질문·피드백이 나온다).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import OpenAI from "openai";

loadEnvConfig(process.cwd());

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error(".env.local에 OPENAI_API_KEY가 없습니다.");
    process.exit(1);
  }
  // config.ts는 env를 읽으므로 loadEnvConfig 다음에 불러온다
  const { PROMPT_VERSION } = await import("../src/lib/config");
  const { fillPrompt, loadPrompt } = await import("../src/lib/prompts");
  const { cleanAnswer } = await import("../src/lib/sanitize");
  const { interviewerSchema, FEEDBACK_SCHEMA, interviewerPrompt, feedbackPrompt, cleanFeedback } = await import("../src/lib/interview-ai");
  type Turn = import("../src/lib/interview").InterviewTurn;
  const { loadPostings, loadResumes } = await import("./lib/dataset");

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000 });
  const resume = loadResumes().find((r) => r.id === "r03-qa")!;
  const posting = loadPostings().find((p) => p.id === "p03-qa")!;
  const vars = { resume: resume.text, posting: posting.text };

  const json = async <T,>(prompt: string, name: string, schema: Record<string, unknown>): Promise<T> => {
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    });
    return JSON.parse(res.choices[0]?.message?.content ?? "{}") as T;
  };

  console.log("질문 생성…");
  const { questions } = await json<{ questions: { type: string; question: string }[] }>(
    fillPrompt(loadPrompt("question", PROMPT_VERSION.question), vars),
    "interview_questions",
    {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: { type: { type: "string", enum: ["resume", "role", "posting"] }, question: { type: "string" } },
            required: ["type", "question"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  );
  const withIds = questions.map((q, i) => ({ id: `q${i + 1}`, ...q }));
  const postingQs = withIds.filter((q) => q.type === "posting");
  const picks = [...new Set([postingQs[0], postingQs.at(-1)].filter((q) => q !== undefined))];

  const flows: Record<string, unknown> = {};
  for (const q of picks) {
    console.log(`경험 질문·답변 생성: ${q.question}`);
    const exp = await json<{ prompts: string[]; hint: string }>(
      fillPrompt(loadPrompt("experience", PROMPT_VERSION.experience), { ...vars, question: q.question }),
      "experience_prompts",
      {
        type: "object",
        properties: { prompts: { type: "array", items: { type: "string" } }, hint: { type: "string" } },
        required: ["prompts", "hint"],
        additionalProperties: false,
      },
    );
    const res = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: fillPrompt(loadPrompt("answer", PROMPT_VERSION.answer), { ...vars, question: q.question, experience: resume.experience }),
        },
      ],
    });
    const answer = cleanAnswer(res.choices[0]?.message?.content ?? "");

    console.log("  모의면접 꼬리질문·피드백 생성…");
    const ctx = (turns: Turn[]) => ({ resume: resume.text, posting: posting.text, question: q.question, draft: answer, turns });
    const ask = async (turns: Turn[]) =>
      (await json<{ message: string }>(interviewerPrompt(ctx(turns)), interviewerSchema().name, interviewerSchema().schema)).message.trim();
    let turns: Turn[] = [
      { role: "interviewer", kind: "question", text: q.question },
      { role: "candidate", kind: "answer", text: resume.experience },
    ];
    const followups: string[] = [];
    for (const nextAnswer of [answer, ""]) {
      const message = await ask(turns);
      if (!message) break;
      followups.push(message);
      if (!nextAnswer) break;
      turns = [...turns, { role: "interviewer", kind: "followup", text: message }, { role: "candidate", kind: "answer", text: nextAnswer }];
    }
    const feedback = cleanFeedback(await json(feedbackPrompt(ctx(turns)), FEEDBACK_SCHEMA.name, FEEDBACK_SCHEMA.schema));

    flows[q.id] = {
      prompts: exp.prompts.slice(0, 3),
      hint: exp.hint,
      sampleExperience: resume.experience,
      answer,
      interview: { followups, feedback },
    };
  }

  const demo = {
    note: `데모 모드 샘플. ${new Date().toISOString().slice(0, 10)}에 npm run demo:build로 생성 (모델 ${model}, 프롬프트 question-${PROMPT_VERSION.question} / experience-${PROMPT_VERSION.experience} / answer-${PROMPT_VERSION.answer} / interviewer-${PROMPT_VERSION.interviewer} / interview-feedback-${PROMPT_VERSION.interviewFeedback}).`,
    generated: true,
    resumeId: resume.id,
    postingId: posting.id,
    questions: withIds,
    flows,
  };
  const out = path.join(process.cwd(), "src", "demo", "demo.json");
  writeFileSync(out, JSON.stringify(demo, null, 2) + "\n");
  console.log(`저장: ${path.relative(process.cwd(), out)} (체험 가능 질문 ${picks.length}개)`);
  console.log("E2E 테스트(TC-401, 402)는 특정 질문 문구에 의존하므로 실행 후 npm run test:e2e로 확인하세요.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
