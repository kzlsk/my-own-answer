/**
 * 공고 스크린샷 판독 평가 (TC-114).
 *
 *   npm run eval:ocr -- --score <결과 폴더>   이미 받은 판독 결과(.txt)를 정답과 비교만 함 (API 비용 없음)
 *   npm run eval:ocr                         켜 둔 개발 서버(키 있음)에 실제 화면으로 스크린샷을 올려 판독 → 채점
 *
 * 두 번째 방식은 브라우저 자르기 → /api/posting → 프롬프트 → 모델까지 실제 경로를 그대로 탄다.
 * 먼저 다른 터미널에서 `npm run dev`(키가 든 .env.local)를 켜 둔다. 주소는 --url로 바꿀 수 있다 (기본 http://localhost:3000).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { chromium } from "@playwright/test";
import { scoreOcr } from "./lib/ocr-score";

const SET = "data/postings-image";
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const cases = readdirSync(SET)
  .filter((f) => f.endsWith(".png"))
  .map((f) => basename(f, ".png"));

function writeSummary(dir: string, label: string) {
  const rows: string[] = [];
  const details: string[] = [];
  let sumDist = 0;
  let sumChars = 0;
  for (const id of cases) {
    const outPath = join(dir, `${id}.txt`);
    if (!existsSync(outPath)) continue;
    const r = scoreOcr(readFileSync(join(SET, `${id}.txt`), "utf8"), readFileSync(outPath, "utf8"));
    sumDist += r.distance;
    sumChars += r.truthChars;
    rows.push(`| ${id} | ${(r.accuracy * 100).toFixed(1)}% | ${r.distance} / ${r.truthChars} | ${r.diffs.length} |`);
    details.push(
      `### ${id}\n\n` +
        (r.diffs.length
          ? r.diffs.map((x) => `- \`${x.truth || "(없음)"}\` → \`${x.output || "(빠짐)"}\``).join("\n")
          : "- 틀린 곳 없음"),
    );
  }
  const total = sumChars ? (Math.max(0, 1 - sumDist / sumChars) * 100).toFixed(1) : "-";
  const md = [
    `# 공고 스크린샷 판독 결과 — ${label}`,
    "",
    "글자 정확도 = 1 - 편집 거리 / 정답 글자 수 (공백·목록 기호 제외)",
    "",
    "| 케이스 | 글자 정확도 | 편집 거리 / 정답 글자 | 틀린 구간 |",
    "| --- | --- | --- | --- |",
    ...rows,
    `| **전체** | **${total}%** | ${sumDist} / ${sumChars} | |`,
    "",
    "## 틀린 구간 (정답 → 판독)",
    "",
    "앞부분이 통째로 빠지면 한 구간으로 길게 나옵니다.",
    "",
    ...details,
    "",
  ].join("\n");
  writeFileSync(join(dir, "summary.md"), md);
  console.log(md);
}

async function runLive() {
  const url = arg("--url") ?? "http://localhost:3000";
  const health = await fetch(`${url}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health) throw new Error(`${url}에 서버가 없습니다. 먼저 npm run dev를 켜 주세요.`);
  if (health.demo) throw new Error("서버가 데모 모드입니다. .env.local에 OPENAI_API_KEY를 넣고 다시 켜 주세요.");

  const label = arg("--label") ?? `ocr-${process.env.POSTING_OCR_PROMPT_VERSION ?? "current"}`;
  const dir = join("data/results", `${new Date().toISOString().slice(0, 10)}-${label}`);
  mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const id of cases) {
      const page = await browser.newPage();
      await page.goto(url);
      const started = Date.now();
      await page.getByLabel("공고 스크린샷 올리기").setInputFiles(join(SET, `${id}.png`));
      await page.getByRole("status").filter({ hasText: "스크린샷에서 AI가 읽은 공고예요" }).waitFor({ timeout: 120_000 });
      const text = await page.getByLabel("채용공고 본문").inputValue();
      writeFileSync(join(dir, `${id}.txt`), text);
      console.log(`${id}: ${((Date.now() - started) / 1000).toFixed(1)}초`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  writeSummary(dir, label);
}

const scoreDir = arg("--score");
if (scoreDir) {
  writeSummary(scoreDir, basename(scoreDir));
} else {
  runLive().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
