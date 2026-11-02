/**
 * 모의면접 꼬리질문 평가 (TC-504): 꼬리질문이 이력서·지원자 답에 근거하는지, 없는 경험을 전제로 묻지 않는지.
 *
 *   npm run eval:interview -- --version v1            (기본 5건 = 답변 평가와 같은 조합·질문)
 *   npm run eval:interview -- --version v1 --dry-run  (API 호출 없이 흐름만 확인)
 *
 * 조합마다 두 가지 답으로 첫 꼬리질문을 받는다.
 *   A 정상: 그 질문에 맞춘 답 = answer-v2로 만든 답변 초안 (내 경험으로만 쓴 답)
 *     (처음엔 이력서의 "## 경험 답변" 목록 전체를 답으로 넣었는데, 질문과 맞지 않는 답이라
 *      면접관이 "다시 답해 달라"고 하는 게 오히려 자연스러웠다 → v1 1차 실행 후 평가 설계를 고침)
 *   B 모호: "비슷한 일을 해 본 적은 있는데 자세히는 기억이 안 납니다…" — 면접관이 없는 경험을 지어내 전제하는지 보는 함정
 *   C 모호: "네, 그런 경험이 있습니다. 문제를 잘 분석해서…" — 구체적인 내용 없이 일반론만 말한 답 (v3에서 추가)
 * 모델의 판단(intent·action·message)과, 그 판단으로 앱이 실제로 할 말(app_action·app_message, decide())을 함께 남긴다.
 * 채점은 앱이 실제로 할 말(app_message) 기준.
 * 답변 초안은 answer-v2 평가 결과(data/results/2026-10-29-answer-v2/raw.json)를 쓴다.
 *
 * 결과: data/results/<날짜>-interviewer-<version>/ 에 raw.json, scoring.csv
 * scoring.csv의 label 칸을 사람이 채운다: 근거 / 지어냄 / 일반 → npm run eval:score -- <폴더>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import OpenAI from "openai";
import { buildCases } from "./lib/dataset";
import { toCsv } from "./lib/csv";

loadEnvConfig(process.cwd());

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const version = arg("version") ?? "v1";
const limit = Number(arg("limit") ?? 5);
const dryRun = process.argv.includes("--dry-run");
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const VAGUE = "비슷한 일을 해 본 적은 있는데 자세히는 기억이 안 납니다. 그때 팀에서 같이 문제를 해결했던 것 같아요.";
const GENERIC = "네, 그런 경험이 있습니다. 문제를 잘 분석해서 팀원들과 협력해 좋은 결과를 냈습니다.";

async function main() {
  if (!dryRun && !process.env.OPENAI_API_KEY) {
    console.error(".env.local에 OPENAI_API_KEY가 없습니다. 흐름만 확인하려면 --dry-run을 붙이세요.");
    process.exit(1);
  }
  const { interviewerPrompt, interviewerSchema, decide } = await import("../src/lib/interview-ai");
  type Turn = import("../src/lib/interview").InterviewTurn;
  type Decision = import("../src/lib/interview-ai").InterviewerDecision;

  const fixed = JSON.parse(readFileSync("data/results/fixed-questions.json", "utf8")).cases as Record<string, { question: string }>;
  const draftsPath = "data/results/2026-10-29-answer-v2/raw.json";
  const drafts = existsSync(draftsPath)
    ? new Map<string, string>(JSON.parse(readFileSync(draftsPath, "utf8")).results.map((r: { case_id: string; output: string }) => [r.case_id, r.output]))
    : new Map<string, string>();

  const cases = buildCases()
    .filter((c) => fixed[c.id])
    .slice(0, limit);
  const client = dryRun ? null : new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000 });

  const results: Record<string, unknown>[] = [];
  for (const c of cases) {
    const question = fixed[c.id].question;
    for (const [scenario, answer] of [
      ["A 정상", drafts.get(c.id) ?? c.resume.experience],
      ["B 모호", VAGUE],
      ["C 모호", GENERIC],
    ] as const) {
      const turns: Turn[] = [
        { role: "interviewer", kind: "question", text: question },
        { role: "candidate", kind: "answer", text: answer },
      ];
      const prompt = interviewerPrompt(
        { resume: c.resume.text, posting: c.posting.text, question, draft: drafts.get(c.id) ?? "", turns },
        version,
      );
      const started = Date.now();
      let d: Decision = { intent: "answer", action: "followup", message: "(dry-run)", basis: "" };
      if (client) {
        const res = await client.chat.completions.create({
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_schema", json_schema: interviewerSchema(version) },
        });
        d = JSON.parse(res.choices[0]?.message?.content ?? "{}") as Decision;
      }
      const app = decide(d, { turns, resume: c.resume.text });
      console.log(`${c.id} [${scenario}] ${d.intent}/${d.action} → ${app.action}: ${app.message.slice(0, 60)}`);
      results.push({
        case_id: c.id,
        role_match: c.roleMatch ? "Y" : "N",
        scenario,
        question,
        answer,
        intent: d.intent,
        action: d.action,
        followup: d.message,
        basis: d.basis,
        resume_item: d.resume_item ?? "",
        app_action: app.action,
        app_message: app.message,
        ms: Date.now() - started,
      });
    }
  }

  // 같은 날 다시 돌려도 앞선 결과(채점한 scoring.csv 포함)를 덮어쓰지 않는다
  const base = path.join("data", "results", `${new Date().toISOString().slice(0, 10)}-interviewer-${version}${dryRun ? "-dry" : ""}`);
  let dir = base;
  for (let n = 2; existsSync(dir); n++) dir = `${base}-run${n}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "raw.json"), JSON.stringify({ target: "interviewer", version, model: MODEL, results }, null, 2));
  writeFileSync(
    path.join(dir, "scoring.csv"),
    toCsv(
      ["case_id", "role_match", "scenario", "question", "answer", "intent", "action", "followup", "basis", "resume_item", "app_action", "app_message", "followup_label", "evidence", "note"],
      results.map((r) => ({ ...r, followup_label: "", evidence: "", note: "" })),
    ),
  );
  console.log(`\n저장: ${dir}`);
  console.log("scoring.csv의 followup_label에 근거 / 지어냄 / 일반 / 다시요청 을 채운 뒤 npm run eval:score -- " + dir);
  console.log("- 근거: 지원자 답이나 이력서에 있는 내용을 파고듦 (evidence에 근거 위치)");
  console.log("- 지어냄: 이력서·답에 없는 경험·성과·도구를 했다고 전제하고 물음");
  console.log("- 일반: 특정 경험을 전제하지 않는 일반 질문 (\"그때 가장 어려웠던 점은?\")");
  console.log("- 다시요청: 앱이 꼬리질문 대신 다시 답을 부탁함 (app_action = retry)");
  console.log("채점은 app_message(앱이 실제로 하는 말) 기준. app_action이 feedback이면 꼬리질문 없이 마무리");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
