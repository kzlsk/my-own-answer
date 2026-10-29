/**
 * 프롬프트 버전 평가 (run-eval 스킬이 사용)
 *
 *   npm run eval -- --target answer --version v1 --limit 5
 *   npm run eval -- --target question --version v1
 *   npm run eval -- --target answer --version v1 --limit 3 --dry-run   (API 호출 없이 흐름만 확인)
 *
 * 결과: data/results/<날짜>-<target>-<version>/ 에 raw.json, scoring.csv, summary.md
 * scoring.csv의 label 칸은 사람이 채점한다. (채점 후: npm run eval:score -- <결과 폴더>)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import OpenAI from "openai";
import { fillPrompt, loadPrompt, type PromptTarget } from "../src/lib/prompts";
import { buildCases, type Case } from "./lib/dataset";
import { toCsv } from "./lib/csv";

loadEnvConfig(process.cwd());

// ---------- 인자 ----------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const target = (arg("target") ?? "answer") as PromptTarget;
const version = arg("version") ?? "v1";
const limit = arg("limit") ? Number(arg("limit")) : undefined;
const dryRun = process.argv.includes("--dry-run");
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

if (!["question", "answer"].includes(target)) {
  console.error(`--target은 question 또는 answer만 지원합니다. (받은 값: ${target})`);
  process.exit(1);
}
if (!dryRun && !process.env.OPENAI_API_KEY) {
  console.error(".env.local에 OPENAI_API_KEY가 없습니다. 흐름만 확인하려면 --dry-run을 붙이세요.");
  process.exit(1);
}

const client = dryRun ? null : new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000 });

// ---------- 모델 호출 ----------

type Question = { type: "resume" | "role" | "posting"; question: string };

const QUESTION_SCHEMA = {
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
} as const;

async function generateQuestions(prompt: string): Promise<Question[]> {
  if (!client) {
    return [
      { type: "resume", question: "[dry-run] 이력서의 대표 프로젝트를 설명해 주세요." },
      { type: "role", question: "[dry-run] 이 직무에서 가장 중요한 역량은 무엇이라고 생각하나요?" },
      { type: "posting", question: "[dry-run] 공고의 자격요건 중 본인과 가장 맞는 것은 무엇인가요?" },
    ];
  }
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_schema", json_schema: QUESTION_SCHEMA },
  });
  const content = res.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(content) as { questions: Question[] };
  return parsed.questions;
}

async function generateText(prompt: string): Promise<string> {
  if (!client) {
    return "[dry-run] 저는 이 경험에서 문제를 정의했습니다. 그 결과 지표가 개선됐습니다. 이 경험을 귀사에서도 살리겠습니다.";
  }
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}

function caseVars(c: Case): Record<string, string> {
  return { resume: c.resume.text, posting: c.posting.text, experience: c.resume.experience };
}

/** "다. " "요. " 등 문장 끝에서 나누고, 줄바꿈·목록 기호도 문장 경계로 본다 */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^#+\s/.test(s));
}

// ---------- 고정 질문 (답변 평가용) ----------
// 답변 v1, v2를 공정하게 비교하려면 같은 질문에 답해야 하므로,
// 조합마다 질문 하나를 한 번만 뽑아 data/results/fixed-questions.json에 고정한다.

type FixedQuestions = {
  note: string;
  generatedWith: string;
  model: string;
  cases: Record<string, Question>;
};

const FIXED_PATH = path.join(process.cwd(), "data", "results", "fixed-questions.json");

function loadFixed(): FixedQuestions {
  if (existsSync(FIXED_PATH)) return JSON.parse(readFileSync(FIXED_PATH, "utf8"));
  return {
    note: "답변 평가용 고정 질문. 조합마다 question-v1로 만든 질문 중 공고 기반 첫 질문. 지우면 새로 뽑습니다.",
    generatedWith: "question-v1",
    model: dryRun ? "dry-run" : MODEL,
    cases: {},
  };
}

async function fixedQuestionFor(c: Case, fixed: FixedQuestions): Promise<Question> {
  const existing = fixed.cases[c.id];
  if (existing) return existing;
  const prompt = fillPrompt(loadPrompt("question", "v1"), caseVars(c));
  const qs = await generateQuestions(prompt);
  const pick = qs.find((q) => q.type === "posting") ?? qs[0];
  if (!pick) throw new Error("질문이 하나도 생성되지 않았습니다.");
  fixed.cases[c.id] = pick;
  if (!dryRun) writeFileSync(FIXED_PATH, JSON.stringify(fixed, null, 2) + "\n");
  return pick;
}

// ---------- 실행 ----------

function outDir(): string {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const base = path.join(process.cwd(), "data", "results", `${date}-${target}-${version}${dryRun ? "-dryrun" : ""}`);
  let dir = base;
  for (let i = 2; existsSync(dir); i++) dir = `${base}-${i}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

type RawResult = {
  case_id: string;
  resume: string;
  posting: string;
  role_match: boolean;
  question?: Question;
  output?: unknown;
  ms?: number;
  error?: string;
};

async function main() {
  const template = loadPrompt(target, version); // 파일이 없으면 여기서 바로 실패
  const all = buildCases();
  const cases = limit ? all.slice(0, limit) : all;
  const fixed = target === "answer" ? loadFixed() : null;

  console.log(`평가 대상: ${target}-${version} / 모델: ${dryRun ? "dry-run (API 호출 없음)" : MODEL}`);
  console.log(`조합 ${cases.length}건 (전체 ${all.length}건 중) — 직무 일치 ${cases.filter((c) => c.roleMatch).length}건\n`);

  const results: RawResult[] = [];
  for (const [i, c] of cases.entries()) {
    const base: RawResult = { case_id: c.id, resume: c.resume.id, posting: c.posting.id, role_match: c.roleMatch };
    process.stdout.write(`[${i + 1}/${cases.length}] ${c.id} ... `);
    try {
      if (target === "question") {
        const prompt = fillPrompt(template, caseVars(c));
        const t0 = Date.now();
        const questions = await generateQuestions(prompt);
        results.push({ ...base, output: questions, ms: Date.now() - t0 });
      } else {
        const question = await fixedQuestionFor(c, fixed!);
        const prompt = fillPrompt(template, { ...caseVars(c), question: question.question });
        const t0 = Date.now();
        const answer = await generateText(prompt);
        results.push({ ...base, question, output: answer, ms: Date.now() - t0 });
      }
      console.log(`완료 (${results.at(-1)!.ms}ms)`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results.push({ ...base, error: message });
      console.log(`실패: ${message}`);
    }
  }

  const dir = outDir();
  writeFileSync(path.join(dir, "raw.json"), JSON.stringify({ target, version, model: dryRun ? "dry-run" : MODEL, results }, null, 2) + "\n");

  // 채점표 — label 칸은 비워 둔다. 채점은 사람이 한다.
  if (target === "answer") {
    const rows = results.flatMap((r) =>
      r.error
        ? []
        : splitSentences(String(r.output)).map((sentence, n) => ({
            case_id: r.case_id,
            role_match: r.role_match ? "Y" : "N",
            question: n === 0 ? r.question?.question : "",
            sentence_no: n + 1,
            sentence,
            label: "",
            evidence: "",
            note: "",
          })),
    );
    writeFileSync(
      path.join(dir, "scoring.csv"),
      toCsv(["case_id", "role_match", "question", "sentence_no", "sentence", "label", "evidence", "note"], rows),
    );
  } else {
    const rows = results.flatMap((r) =>
      r.error
        ? []
        : (r.output as Question[]).map((q, n) => ({
            case_id: r.case_id,
            role_match: r.role_match ? "Y" : "N",
            q_no: n + 1,
            type: q.type,
            question: q.question,
            posting_keyword: "",
            duplicate: "",
            note: "",
          })),
    );
    writeFileSync(
      path.join(dir, "scoring.csv"),
      toCsv(["case_id", "role_match", "q_no", "type", "question", "posting_keyword", "duplicate", "note"], rows),
    );
  }

  const ok = results.filter((r) => !r.error);
  const times = ok.map((r) => r.ms!);
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const summary = [
    `# ${target}-${version} 실행 요약`,
    "",
    `- 실행 시각: ${new Date().toISOString()}`,
    `- 모델: ${dryRun ? "dry-run (API 호출 없음)" : MODEL}`,
    `- 조합: ${results.length}건 (직무 일치 ${results.filter((r) => r.role_match).length}건 / 불일치 ${results.filter((r) => !r.role_match).length}건)`,
    `- 성공 ${ok.length}건 · 실패 ${results.length - ok.length}건`,
    `- 응답 시간: 평균 ${avg}ms · 최대 ${times.length ? Math.max(...times) : 0}ms`,
    "",
    "## 채점 방법",
    "",
    target === "answer"
      ? "`scoring.csv`의 문장마다 `label`에 **내경험 / 지어냄 / 일반** 중 하나를, `evidence`에 근거(이력서의 어느 사례·경험 답변 몇 번)를 적는다. 끝나면 `npm run eval:score -- " +
        path.relative(process.cwd(), dir).replace(/\\/g, "/") +
        "`"
      : "`posting_keyword`에 공고 자격·우대 키워드를 반영했으면 Y, `duplicate`에 앞 질문과 의미가 겹치면 Y를 적는다.",
    "",
  ].join("\n");
  writeFileSync(path.join(dir, "summary.md"), summary);

  console.log(`\n결과 저장: ${path.relative(process.cwd(), dir)}`);
  console.log(`성공 ${ok.length}건 · 실패 ${results.length - ok.length}건 · 평균 ${avg}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
