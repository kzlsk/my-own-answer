/**
 * 사람이 채운 scoring.csv를 집계한다.
 *
 *   npm run eval:score -- data/results/2026-10-29-answer-v1
 *
 * 결과: 같은 폴더의 score.md (+ 화면 출력)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "./lib/csv";

const dir = process.argv[2];
if (!dir || !existsSync(path.join(dir, "scoring.csv"))) {
  console.error("사용법: npm run eval:score -- <scoring.csv가 있는 결과 폴더>");
  process.exit(1);
}

const rows = parseCsv(readFileSync(path.join(dir, "scoring.csv"), "utf8"));
const pct = (a: number, b: number) => (b === 0 ? "-" : `${Math.round((a / b) * 1000) / 10}%`);

function answerReport(): string {
  const norm = (s: string) => s.replace(/\s+/g, "");
  const unlabeled = rows.filter((r) => !["내경험", "지어냄", "일반"].includes(norm(r.label)));
  if (unlabeled.length > 0) {
    console.warn(`⚠ 채점이 안 된 문장 ${unlabeled.length}개 (예: ${unlabeled[0].case_id} ${unlabeled[0].sentence_no}번). 제외하고 집계합니다.`);
  }

  const group = (filter: (r: Record<string, string>) => boolean) => {
    const g = rows.filter(filter);
    const mine = g.filter((r) => norm(r.label) === "내경험").length;
    const made = g.filter((r) => norm(r.label) === "지어냄").length;
    const general = g.filter((r) => norm(r.label) === "일반").length;
    const casesWithMade = new Set(g.filter((r) => norm(r.label) === "지어냄").map((r) => r.case_id)).size;
    const cases = new Set(g.map((r) => r.case_id)).size;
    return { mine, made, general, cases, casesWithMade };
  };

  const line = (name: string, s: ReturnType<typeof group>) =>
    `| ${name} | ${s.cases} | ${pct(s.mine, s.mine + s.made)} | ${s.made} | ${s.casesWithMade}/${s.cases} | ${s.mine} | ${s.general} |`;

  return [
    `# 채점 집계 — ${path.basename(dir)}`,
    "",
    "**내 경험 근거 비율** = 내경험 ÷ (내경험 + 지어냄). 일반적인 말은 분모에서 뺀다.",
    "",
    "| 구분 | 조합 수 | 내 경험 근거 비율 | 지어낸 문장 | 지어낸 문장이 있는 조합 | 내경험 문장 | 일반 문장 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    line("전체", group(() => true)),
    line("직무 일치", group((r) => r.role_match === "Y")),
    line("직무 불일치", group((r) => r.role_match === "N")),
    "",
    unlabeled.length ? `채점 안 된 문장 ${unlabeled.length}개는 제외했습니다.` : "모든 문장이 채점됐습니다.",
    "",
  ].join("\n");
}

function questionReport(): string {
  const yes = (v: string) => /^y/i.test(v);
  const total = rows.length;
  const kw = rows.filter((r) => yes(r.posting_keyword)).length;
  const dup = rows.filter((r) => yes(r.duplicate)).length;
  return [
    `# 채점 집계 — ${path.basename(dir)}`,
    "",
    `| 질문 수 | 공고 키워드 반영률 | 질문 중복률 |`,
    `| --- | --- | --- |`,
    `| ${total} | ${pct(kw, total)} | ${pct(dup, total)} |`,
    "",
  ].join("\n");
}

const report = "label" in (rows[0] ?? {}) ? answerReport() : questionReport();
writeFileSync(path.join(dir, "score.md"), report);
console.log(report);
console.log(`저장: ${path.join(dir, "score.md")}`);
