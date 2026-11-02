/**
 * 이력서 정리 평가: 형식이 다른 가상 이력서(data/resumes-raw)를 정리하고 수치 보존율을 잰다.
 *
 *   npm run eval:structure            (API 호출, 이력서당 1번)
 *   npm run eval:structure -- --dry-run
 *
 * 결과: data/results/<날짜>-structure-<버전>/ 에 파일별 정리 결과(.md)와 summary.md
 * 수치 보존율은 코드로 자동 계산한다 (사람 채점 불필요). 빠진 내용은 summary의 "원문 수치 중 결과에 없는 것"을 보고 사람이 판단한다.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import OpenAI from "openai";

loadEnvConfig(process.cwd());

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun && !process.env.OPENAI_API_KEY) {
    console.error(".env.local에 OPENAI_API_KEY가 없습니다. 흐름만 확인하려면 --dry-run을 붙이세요.");
    process.exit(1);
  }
  const { PROMPT_VERSION } = await import("../src/lib/config");
  const { fillPrompt, loadPrompt } = await import("../src/lib/prompts");
  const { collapseDoubledLines, maskPersonalInfo } = await import("../src/lib/mask");
  const { STRUCTURE_SCHEMA, checkFidelity, toMarkdown } = await import("../src/lib/resume-structure");
  type StructuredResume = import("../src/lib/resume-structure").StructuredResume;

  const version = PROMPT_VERSION.resumeStructure;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = dryRun ? null : new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000 });
  const dir = path.join(process.cwd(), "data", "resumes-raw");
  const files = readdirSync(dir).filter((f) => /\.(txt|md)$/.test(f) && f !== "README.md").sort();

  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  let out = path.join(process.cwd(), "data", "results", `${date}-structure-${version}${dryRun ? "-dryrun" : ""}`);
  for (let i = 2; existsSync(out); i++) out = `${out.replace(/-\d+$/, "")}-${i}`;
  mkdirSync(out, { recursive: true });

  const rows: string[] = [];
  for (const file of files) {
    const source = maskPersonalInfo(collapseDoubledLines(readFileSync(path.join(dir, file), "utf8"))).text;
    process.stdout.write(`${file} ... `);
    const t0 = Date.now();
    let markdown = source;
    if (client) {
      const res = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: fillPrompt(loadPrompt("resume-structure", version), { resume: source }) }],
        response_format: { type: "json_schema", json_schema: STRUCTURE_SCHEMA },
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as StructuredResume;
      markdown = maskPersonalInfo(toMarkdown(parsed)).text;
    }
    const ms = Date.now() - t0;
    const kept = checkFidelity(source, markdown); // 결과 숫자가 원문에 있는가 (지어냄·바뀜)
    const dropped = checkFidelity(markdown, source); // 원문 숫자가 결과에 있는가 (빠짐, 학력·연락처는 일부러 뺌)
    const sections = markdown.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3));
    writeFileSync(path.join(out, file.replace(/\.(txt|md)$/, ".md")), markdown + "\n");
    rows.push(
      `| ${file} | ${sections.join(", ") || "-"} | ${Math.round(kept.ratio * 100)}% (${kept.total - kept.missing.length}/${kept.total}) | ${kept.missing.join(", ") || "-"} | ${dropped.missing.join(", ") || "-"} | ${ms}ms |`,
    );
    console.log(`완료 (수치 보존 ${Math.round(kept.ratio * 100)}%)`);
  }

  const summary = [
    `# 이력서 정리 평가 — resume-structure-${version}`,
    "",
    `- 실행 시각: ${new Date().toISOString()}`,
    `- 모델: ${dryRun ? "dry-run (정리 없이 원문 그대로)" : model}`,
    "",
    "| 파일 | 정리된 섹션 | 수치 보존율 | 원문에 없는 숫자 (지어냄·바뀜 의심) | 원문 수치 중 결과에 없는 것 (빠짐 의심) | 시간 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "- 수치 보존율 = 정리 결과의 숫자 중 원문에 그대로 있는 비율. 100% 미만이면 AI가 숫자를 바꾸거나 만든 것",
    "- \"빠짐 의심\"에는 일부러 빼는 학력 기간 등도 섞여 있으니 사람이 확인한다",
    "",
  ].join("\n");
  writeFileSync(path.join(out, "summary.md"), summary);
  console.log(`\n결과 저장: ${path.relative(process.cwd(), out)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
