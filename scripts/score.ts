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

/**
 * 모의면접 꼬리질문 (TC-504): 근거 / 지어냄 / 일반 / 다시요청
 * 앱은 intent가 off_topic이면 꼬리질문 대신 "다시 답해 달라"고 하므로(꼬리질문 개수에 세지 않음) 다시요청은 따로 센다.
 */
function interviewReport(): string {
  const norm = (s: string) => s.replace(/\s+/g, "");
  const labels = ["근거", "지어냄", "일반", "다시요청"];
  const unlabeled = rows.filter((r) => !labels.includes(norm(r.followup_label)) && (r.app_action ?? r.action) !== "feedback");
  const group = (name: string, f: (r: Record<string, string>) => boolean) => {
    const g = rows.filter(f);
    const n = (l: string) => g.filter((r) => norm(r.followup_label) === l).length;
    const asked = n("근거") + n("지어냄") + n("일반");
    return `| ${name} | ${g.length} | ${asked} | ${pct(n("근거"), n("근거") + n("지어냄"))} | ${pct(n("근거"), g.length)} | ${n("지어냄")} | ${n("근거")} | ${n("일반")} | ${n("다시요청")} |`;
  };
  return [
    `# 채점 집계 — ${path.basename(dir)}`,
    "",
    "- **근거 비율** = 근거 ÷ (근거 + 지어냄). 특정 경험을 전제하지 않는 일반 질문은 분모에서 뺀다.",
    "- **답을 파고든 비율** = 근거 ÷ 전체 답. 질문 되풀이·일반 질문·다시 요청이 많으면 낮아진다.",
    "- **다시요청** = 무관한 답으로 보고 다시 답을 부탁한 경우 (앱에서는 꼬리질문이 아님)",
    "",
    "| 구분 | 답 수 | 꼬리질문 수 | 근거 비율 | 답을 파고든 비율 | 지어냄 | 근거 | 일반 | 다시요청 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    group("전체", () => true),
    group("A 정상 답", (r) => r.scenario.startsWith("A")),
    group("모호한 답 (B·C)", (r) => /^[BC]/.test(r.scenario)),
    "",
    unlabeled.length ? `채점 안 된 꼬리질문 ${unlabeled.length}개는 제외했습니다.` : "모든 답이 채점됐습니다.",
    "",
  ].join("\n");
}

const first = rows[0] ?? {};
const report = "followup_label" in first ? interviewReport() : "label" in first ? answerReport() : questionReport();
writeFileSync(path.join(dir, "score.md"), report);
console.log(report);
console.log(`저장: ${path.join(dir, "score.md")}`);
