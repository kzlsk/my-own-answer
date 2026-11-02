import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

/**
 * 핵심 흐름 E2E. 테스트 서버는 데모 모드라 OpenAI를 부르지 않는다.
 * API 실패·지연·깨진 응답은 page.route로 만든다.
 * 테스트 이름의 [TC-xxx]는 docs/qa/test-cases.md의 TC ID.
 */

const fixture = (name: string) => path.join(process.cwd(), "tests", "fixtures", name);

const RESUME_TEXT = "이름: 하은솔\n연락처: 010-0000-1234 / haeunsol@example.com\n모바일 QA 3년, 결제 기능 회귀 테스트 자동화 경험";

/** /api/** 호출을 기록해 "요청이 가지 않았다"를 확인한다 */
function trackApi(page: Page) {
  const calls: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith("/api/")) calls.push(url.pathname);
  });
  return calls;
}

async function loadSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "샘플로 체험하기" }).click();
  await expect(page.getByLabel("가린 개인정보")).toBeVisible();
}

async function toQuestions(page: Page) {
  await loadSample(page);
  await page.getByRole("button", { name: "예상 질문 만들기" }).click();
  await expect(page.getByRole("heading", { name: "예상 질문" })).toBeVisible();
}

/** 데모에서 끝까지 체험할 수 있는 ★ 질문 (demo.json이 바뀌어도 동작하도록 문구에 의존하지 않는다) */
const demoQuestion = (page: Page) => page.locator("#step-questions").getByRole("button", { name: /^데모 체험 가능/ }).first();

const generateButton = (page: Page) => page.getByRole("button", { name: "예상 질문 만들기" });

/** multipart 요청 본문에 든 JPEG 조각마다 가로·세로 크기를 읽는다 (SOF 마커) */
function jpegSizes(body: Buffer): { width: number; height: number }[] {
  const soi = Buffer.from([0xff, 0xd8, 0xff]);
  const sizes: { width: number; height: number }[] = [];
  let start = body.indexOf(soi);
  while (start !== -1) {
    let i = start + 2;
    while (i < body.length - 9 && body[i] === 0xff) {
      const marker = body[i + 1];
      if (marker >= 0xc0 && marker <= 0xc3) {
        sizes.push({ height: body.readUInt16BE(i + 5), width: body.readUInt16BE(i + 7) });
        break;
      }
      i += 2 + body.readUInt16BE(i + 2);
    }
    start = body.indexOf(soi, i);
  }
  return sizes;
}

/** Next.js가 넣는 숨은 route announcer(role="alert")는 빼고, 화면의 오류 안내만 찾는다 */
const alertBox = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

test.describe("입력 · 업로드", () => {
  test("[TC-101] PDF 이력서를 올리면 파일명과 가린 이력서가 보인다", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel(/이력서 파일/).setInputFiles(fixture("sample-resume.pdf"));

    await expect(page.getByText("sample-resume.pdf")).toBeVisible();
    await page.getByText("가린 원문 보기").click();
    const preview = page.getByLabel("마스킹된 이력서");
    await expect(preview).toContainText("Backend Developer");
    await expect(preview).toContainText("[이름]");
    await expect(preview).not.toContainText("견태오");
  });

  test("[TC-102] 텍스트 이력서를 올리면 내용이 보인다", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel(/이력서 파일/).setInputFiles({
      name: "resume.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(RESUME_TEXT, "utf8"),
    });

    await expect(page.getByText("resume.txt")).toBeVisible();
    await page.getByText("가린 원문 보기").click();
    await expect(page.getByLabel("마스킹된 이력서")).toContainText("결제 기능 회귀 테스트");
  });

  test("[TC-103] 아무것도 넣지 않으면 생성 버튼이 비활성화되고 안내가 보인다", async ({ page }) => {
    await page.goto("/");

    await expect(generateButton(page)).toBeDisabled();
    await expect(page.getByText("이력서와 채용공고를 모두 넣어 주세요.")).toBeVisible();
  });

  test("[TC-104] 지원하지 않는 파일은 안내만 보이고 업로드되지 않는다", async ({ page }) => {
    const calls = trackApi(page);
    await page.goto("/");
    for (const name of ["virus.exe", "photo.jpg"]) {
      await page.getByLabel(/이력서 파일/).setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from("x") });
      await expect(page.getByText("지원하지 않는 형식입니다.", { exact: false })).toBeVisible();
    }
    expect(calls).not.toContain("/api/resume");
  });

  test("[TC-105] 10MB를 넘는 이력서 파일은 안내만 보이고 요청이 가지 않는다", async ({ page }) => {
    const calls = trackApi(page);
    await page.goto("/");
    await page.getByLabel(/이력서 파일/).setInputFiles({
      name: "big.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x20),
    });

    await expect(page.getByText("파일이 너무 큽니다. 10MB 이하로 올려 주세요.")).toBeVisible();
    expect(calls).not.toContain("/api/resume");
  });

  test("[TC-116] 4MB가 넘는 이력서 PDF도 브라우저에서 글자만 뽑아 보내고, 원본 파일은 서버로 가지 않는다", async ({ page }) => {
    const bodies: number[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/resume") bodies.push(r.postDataBuffer()?.length ?? 0);
    });
    await page.goto("/");
    // 사진·디자인 요소로 용량이 큰 이력서를 흉내: 글자가 든 PDF 뒤에 6MB를 덧붙인다
    const pdf = Buffer.concat([readFileSync(fixture("sample-resume.pdf")), Buffer.alloc(6 * 1024 * 1024, 0x20)]);
    await page.getByLabel(/이력서 파일/).setInputFiles({ name: "BE_견태오_이력서.pdf", mimeType: "application/pdf", buffer: pdf });

    await expect(page.getByLabel("가린 개인정보")).toContainText("이름");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toBeLessThan(100 * 1024); // 6MB 파일 대신 글자 몇 KB만 전송
  });

  test("[TC-118] 글자가 없는 이력서 PDF는 직접 붙여넣으라고 안내한다", async ({ page }) => {
    const calls = trackApi(page);
    await page.goto("/");
    await page.getByLabel(/이력서 파일/).setInputFiles(fixture("posting-image-only.pdf"));

    await expect(alertBox(page)).toContainText("이 PDF에는 글자가 없고 그림만 있어요");
    expect(calls).not.toContain("/api/resume");
  });

  test("[TC-106] 채용공고가 아닌 글을 넣으면 안내가 보인다", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "직접 붙여넣기" }).click();
    await page.getByLabel("이력서 내용").fill(RESUME_TEXT);
    await page.getByRole("button", { name: "이력서로 사용하기" }).click();
    await page.getByLabel("채용공고 본문").fill(
      "오늘 서울은 대체로 맑고 낮 최고기온은 18도로 어제보다 조금 높겠습니다. 미세먼지는 보통 수준이며 저녁부터는 바람이 다소 강하게 불겠습니다. 주말에는 전국에 비 소식이 있어 우산을 챙기는 것이 좋겠습니다.",
    );
    await generateButton(page).click();

    await expect(alertBox(page)).toContainText("채용공고로 보이지 않습니다");
  });

  test("[TC-107] 8,000자를 넘는 공고는 글자 수 안내가 보이고 요청이 가지 않는다", async ({ page }) => {
    const calls = trackApi(page);
    await loadSample(page);
    const longPosting = readFileSync(fixture("long-posting.md"), "utf8");
    await page.getByLabel("채용공고 본문").fill(longPosting);

    await expect(page.getByText("8,000자 이하로 줄여 주세요", { exact: false })).toBeVisible();
    await expect(generateButton(page)).toBeDisabled();
    expect(calls).not.toContain("/api/questions");
  });
});

test.describe("개인정보 마스킹", () => {
  test("[TC-201] 붙여넣은 이력서의 이름·전화번호·이메일이 가려져 보인다", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "직접 붙여넣기" }).click();
    await page.getByLabel("이력서 내용").fill(RESUME_TEXT);
    await page.getByRole("button", { name: "이력서로 사용하기" }).click();

    const chips = page.getByLabel("가린 개인정보");
    await expect(chips).toContainText("이름 1개 가림");
    await expect(chips).toContainText("전화번호 1개 가림");
    await expect(chips).toContainText("이메일 1개 가림");
    await page.getByText("가린 원문 보기").click();
    const preview = page.getByLabel("마스킹된 이력서");
    await expect(preview).not.toContainText("하은솔");
    await expect(preview).not.toContainText("010-0000-1234");
    await expect(preview).not.toContainText("haeunsol@example.com");
  });
});

test.describe("실제 이력서 형식 마스킹 (BUG-005)", () => {
  const HEADLINE_RESUME =
    "Frontend Developer 피도윤Frontend Developer 피도윤\n2001. 05. 17 | pidoyun@example.com | 010-0000-0000\n책갈피 | 2023. 09 - 2023. 11 | FE (피도윤 / 견태오)\n사용자 흐름까지 책임지는 개발자입니다.";

  async function pasteResume(page: Page) {
    await page.goto("/");
    await page.getByRole("tab", { name: "직접 붙여넣기" }).click();
    await page.getByLabel("이력서 내용").fill(HEADLINE_RESUME);
    await page.getByRole("button", { name: "이력서로 사용하기" }).click();
    await expect(page.getByLabel("가린 개인정보")).toBeVisible();
  }

  test("[TC-203][TC-204] '이름:' 표시가 없는 제목 줄 이름과 생년월일이 가려진다", async ({ page }) => {
    await pasteResume(page);

    const chips = page.getByLabel("가린 개인정보");
    await expect(chips).toContainText("이름 2개 가림");
    await expect(chips).toContainText("생년월일 1개 가림");
    await page.getByText("가린 원문 보기").click();
    const preview = page.getByLabel("마스킹된 이력서");
    await expect(preview).not.toContainText("피도윤");
    await expect(preview).not.toContainText("2001. 05. 17");
    await expect(preview).toContainText("2023. 09 - 2023. 11");
  });

  test("[TC-205] 더 가릴 단어를 넣으면 다시 가려진다", async ({ page }) => {
    await pasteResume(page);
    await page.getByLabel(/더 가릴 단어/).fill("견태오");
    await page.getByRole("button", { name: "가리기", exact: true }).click();

    await expect(page.getByLabel("가린 개인정보")).toContainText("직접 지정한 단어 1개 가림");
    await page.getByText("가린 원문 보기").click();
    await expect(page.getByLabel("마스킹된 이력서")).not.toContainText("견태오");
  });
});

test.describe("질문 → 경험 → 답변", () => {
  test("[TC-301] 질문이 이력서 / 직무 / 공고 기반으로 나뉘어 나온다", async ({ page }) => {
    await toQuestions(page);

    for (const label of ["이력서 기반", "직무 기반", "공고 기반"]) {
      await expect(page.getByRole("heading", { name: label })).toBeVisible();
    }
    for (const label of ["이력서 기반", "직무 기반", "공고 기반"]) {
      const group = page.locator("#step-questions div").filter({ has: page.getByRole("heading", { name: label }) }).last();
      expect(await group.locator("li").count()).toBeGreaterThan(0);
    }
  });

  test("[TC-401] 질문을 고르면 답변 전에 관련 경험부터 묻는다", async ({ page }) => {
    await toQuestions(page);
    await demoQuestion(page).click();

    await expect(page.getByRole("heading", { name: "내 경험 먼저 적기" })).toBeVisible();
    await expect(page.locator("#step-experience ol li")).toHaveCount(3);
    await expect(page.getByRole("heading", { name: "답변 초안" })).toHaveCount(0);
  });

  test("[TC-403] 경험을 비워 두고 제출하면 요청 없이 안내가 보인다", async ({ page }) => {
    const calls = trackApi(page);
    await toQuestions(page);
    await demoQuestion(page).click();
    await page.getByRole("button", { name: "이 경험으로 답변 초안 만들기" }).click();

    await expect(page.locator("#experience-hint")).toHaveText("경험을 먼저 적어 주세요. 적은 내용만으로 답변을 만듭니다.");
    await expect(page.getByRole("textbox", { name: "내 경험" })).toHaveAttribute("aria-invalid", "true");
    expect(calls).not.toContain("/api/answer");
  });

  test("[TC-402][BUG-001] 경험을 적으면 답변 초안이 나오고 가림 표시가 보이지 않는다", async ({ page }) => {
    await toQuestions(page);
    await demoQuestion(page).click();
    await page.getByRole("button", { name: "샘플 경험 채우기" }).click();
    await page.getByRole("button", { name: "이 경험으로 답변 초안 만들기" }).click();

    const answer = page.getByLabel("생성된 답변");
    await expect(answer).toBeVisible();
    expect((await answer.inputValue()).length).toBeGreaterThan(50);
    await expect(answer).not.toHaveValue(/\[(이름|전화번호|이메일|링크)\]/);
    await expect(page.getByText("지금까지 만든 초안 1개", { exact: false })).toBeVisible();
  });
});

test.describe("API 오류", () => {
  test("[TC-701] API가 500을 보내면 안내와 다시 시도 버튼이 보이고, 다시 시도하면 이어진다", async ({ page }) => {
    await loadSample(page);
    await page.route("**/api/questions", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "AI_FAILED", message: "AI 응답을 받지 못했습니다. 다시 시도해 주세요." } }),
      }),
    );
    await generateButton(page).click();

    const alert = alertBox(page);
    await expect(alert).toContainText("AI 응답을 받지 못했습니다");
    await page.unroute("**/api/questions");
    await alert.getByRole("button", { name: "다시 시도" }).click();
    await expect(page.getByRole("heading", { name: "예상 질문" })).toBeVisible();
  });

  test("[TC-702] 연결이 끊기거나 시간이 초과되면 안내가 보인다", async ({ page }) => {
    await loadSample(page);
    await page.route("**/api/questions", (route) => route.abort("timedout"));
    await generateButton(page).click();

    await expect(alertBox(page)).toContainText("서버에 연결하지 못했습니다");
    await expect(alertBox(page).getByRole("button", { name: "다시 시도" })).toBeVisible();
  });

  test("[TC-703] 형식이 깨진 응답이 와도 화면이 깨지지 않고 안내가 보인다", async ({ page }) => {
    await loadSample(page);
    await page.route("**/api/questions", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{ questions: [ 깨진 JSON" }),
    );
    await generateButton(page).click();

    await expect(alertBox(page)).toContainText("서버 응답을 읽지 못했습니다");
    await expect(page.getByRole("heading", { name: "이력서와 채용공고" })).toBeVisible();
  });
});

test.describe("복사가 막힌 공고 가져오기", () => {
  test("[TC-108] 공고 PDF를 올리면 글자가 공고 칸에 채워지고 확인 안내가 보인다", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("공고 PDF 올리기").setInputFiles(fixture("posting.pdf"));

    const posting = page.getByLabel("채용공고 본문");
    await expect(posting).toHaveValue(/QA Engineer/);
    await expect(posting).toHaveValue(/자격요건/);
    await expect(page.getByRole("status").filter({ hasText: "PDF에서 가져온 공고예요" })).toBeVisible();
  });

  test("[TC-109] 데모 모드에서 글자가 없는 PDF는 'PDF로 저장'으로 다시 저장하라고 안내한다", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("공고 PDF 올리기").setInputFiles(fixture("posting-image-only.pdf"));

    await expect(alertBox(page)).toContainText("이 PDF에는 글자가 없고 그림만 있어요");
    await expect(alertBox(page)).toContainText("Microsoft Print to PDF");
    await expect(page.getByLabel("채용공고 본문")).toHaveValue("");
  });

  test("[TC-115] 글자가 없는 PDF는 페이지를 이미지로 바꿔 자동으로 다시 읽는다", async ({ page }) => {
    const calls: { kind: string; parts: number }[] = [];
    await page.route("**/api/posting", async (route) => {
      const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
      const parts = (body.match(/name="images"/g) ?? []).length;
      calls.push({ kind: parts > 0 ? "images" : "pdf", parts });
      if (parts === 0) {
        // 키가 있는 서버가 글자 없는 PDF를 받았을 때의 응답
        return route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "PDF_NEEDS_OCR", message: "PDF에 글자가 없어 페이지를 이미지로 읽어야 합니다." } }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ text: "QA Engineer\n\n자격요건\n- QA 경력 1년 이상", source: "image" }),
      });
    });
    await page.goto("/");
    await page.getByLabel("공고 PDF 올리기").setInputFiles(fixture("posting-image-only.pdf"));

    await expect(page.getByLabel("채용공고 본문")).toHaveValue(/QA 경력 1년 이상/);
    await expect(page.getByRole("status").filter({ hasText: "AI가 페이지 이미지를 읽었어요" })).toBeVisible();
    expect(calls.map((c) => c.kind)).toEqual(["pdf", "images"]);
    expect(calls[1].parts).toBeGreaterThan(0);
    expect(calls[1].parts).toBeLessThanOrEqual(16);
  });

  test("[TC-110] 데모 모드에서 스크린샷을 올리면 사용할 수 없다는 안내가 보인다", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("공고 스크린샷 올리기").setInputFiles(fixture("posting-screenshot.png"));

    await expect(alertBox(page)).toContainText("데모 모드에서는 스크린샷 읽기를 쓸 수 없어요");
  });

  test("[TC-111] 긴 스크린샷은 잘라서 보내고, 읽은 글자가 공고 칸에 채워진다", async ({ page }) => {
    let sizes: { width: number; height: number }[] = [];
    await page.route("**/api/posting", async (route) => {
      sizes = jpegSizes(route.request().postDataBuffer() ?? Buffer.alloc(0));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ text: "QA Engineer\n\n자격요건\n- QA 경력 1년 이상", source: "image" }),
      });
    });
    await page.goto("/");
    // 900 × 4,908px 캡처 → 768px 높이로 60px씩 겹쳐 자르면 7조각 (BUG-007: 짧은 변이 768px를 넘으면 OpenAI가 다시 줄임)
    await page.getByLabel("공고 스크린샷 올리기").setInputFiles(fixture("posting-screenshot-tall.png"));

    await expect(page.getByLabel("채용공고 본문")).toHaveValue(/QA 경력 1년 이상/);
    await expect(page.getByRole("status").filter({ hasText: "스크린샷에서 AI가 읽은 공고예요" })).toBeVisible();
    expect(sizes).toHaveLength(7);
    for (const { width, height } of sizes) expect(Math.min(width, height)).toBeLessThanOrEqual(768);
  });

  test("[TC-112] 형식이 다르거나 너무 많은 파일은 안내만 보이고 요청이 가지 않는다", async ({ page }) => {
    const calls = trackApi(page);
    await page.goto("/");

    await page.getByLabel("공고 PDF 올리기").setInputFiles({ name: "공고.docx", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
    await expect(alertBox(page)).toContainText("PDF 파일만 올릴 수 있어요");

    const png = readFileSync(fixture("posting-screenshot.png"));
    await page.getByLabel("공고 스크린샷 올리기").setInputFiles(
      Array.from({ length: 6 }, (_, i) => ({ name: `shot-${i + 1}.png`, mimeType: "image/png", buffer: png })),
    );
    await expect(alertBox(page)).toContainText("스크린샷은 5장까지 올릴 수 있어요");
    expect(calls).not.toContain("/api/posting");
  });

  test("[TC-113] 복사가 되는 공고는 지금처럼 붙여넣어 바로 쓸 수 있다", async ({ page }) => {
    await loadSample(page);
    await page.getByLabel("채용공고 본문").fill(readFileSync(path.join(process.cwd(), "data", "postings", "p02-backend.md"), "utf8"));
    await generateButton(page).click();

    await expect(page.getByRole("heading", { name: "예상 질문" })).toBeVisible();
  });
});

test.describe("이력서 정리 (정해진 섹션의 MD)", () => {
  const STRUCTURED = "## 경력\n\n### 스텝노트 | 프론트엔드 개발자 | 2022.07 - 2024.03\n- 출결 대시보드 개발\n\n## 프로젝트\n\n### 출결 대시보드 렌더링 개선\n- 첫 화면 4.8초 → 1.6초\n- 전환율 30% 상승";

  async function mockStructure(page: Page, missing: string[] = ["30"]) {
    await page.route("**/api/resume/structure", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ markdown: STRUCTURED, fidelity: { ratio: 0.75, total: 4, missing }, structured: true, demo: false }),
      }),
    );
  }

  async function questionsRequestResume(page: Page): Promise<string> {
    const req = page.waitForRequest((r) => r.url().endsWith("/api/questions"));
    await generateButton(page).click();
    return JSON.parse((await req).postData() ?? "{}").resume;
  }

  test("[TC-119] 데모 모드에서는 정리를 건너뛰고 가린 원문으로 진행한다", async ({ page }) => {
    await loadSample(page);

    await expect(page.getByText("데모 모드라 정리를 건너뛰고 가린 원문을 그대로 써요.")).toBeVisible();
    await expect(generateButton(page)).toBeEnabled();
  });

  test("[TC-121] 원문에 없는 숫자가 있으면 경고하고, 사용자가 고친 정리본이 질문 생성에 쓰인다", async ({ page }) => {
    await mockStructure(page);
    await loadSample(page);

    await expect(page.getByRole("status").filter({ hasText: "수치 보존 75%" })).toContainText("원문에 없는 숫자: 30");
    const editor = page.getByLabel("정리된 이력서 (AI에 보냄)");
    await expect(editor).toHaveValue(/## 경력/);
    await editor.fill(STRUCTURED.replace("\n- 전환율 30% 상승", ""));

    const sent = await questionsRequestResume(page);
    expect(sent).toContain("## 프로젝트");
    expect(sent).not.toContain("30%");
  });

  test("[TC-122] '원문 그대로 쓰기'를 고르면 정리본 대신 가린 원문을 보낸다", async ({ page }) => {
    await mockStructure(page, []);
    await loadSample(page);
    await expect(page.getByRole("status").filter({ hasText: "수치 보존" })).toBeVisible();
    await page.getByLabel("정리하지 않고 가린 원문을 그대로 쓰기").check();

    const sent = await questionsRequestResume(page);
    expect(sent).not.toContain("## 경력\n\n### 스텝노트");
    expect(sent).toContain("[이름]");
  });

  test("[TC-122] 정리에 실패해도 다시 시도할 수 있고, 가린 원문으로 계속 진행할 수 있다", async ({ page }) => {
    await page.route("**/api/resume/structure", (route) =>
      route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "AI_FAILED", message: "AI 응답을 받지 못했습니다." } }) }),
    );
    await loadSample(page);

    const box = page.getByLabel("이력서 정리");
    await expect(box.getByRole("alert")).toContainText("정리하지 못하면 가린 원문을 그대로 씁니다");
    await expect(box.getByRole("button", { name: "다시 시도" })).toBeVisible();
    const sent = await questionsRequestResume(page);
    expect(sent).toContain("[이름]");
  });
});

/** 위쪽 진행 단계에서 단계를 고른다 */
async function goToStep(page: Page, name: "준비" | "질문과 답변" | "모의면접" | "결과 정리") {
  await page.getByRole("navigation", { name: "진행 단계" }).getByRole("button", { name, exact: true }).click();
}

/** 데모 ★ 질문 하나로 답변 초안까지 만든다 */
async function toDraft(page: Page) {
  await toQuestions(page);
  await demoQuestion(page).click();
  await page.getByRole("button", { name: "샘플 경험 채우기" }).click();
  await page.getByRole("button", { name: "이 경험으로 답변 초안 만들기" }).click();
  await expect(page.getByLabel("생성된 답변")).toBeVisible();
}

const LONG_ANSWER = "Charles Proxy로 서버 응답을 확인해서 원인이 앱 캐시라는 걸 밝혔고, 리포트에 원인 범위를 적어 출시 전에 수정됐습니다.";

test.describe("모의면접", () => {
  const chat = (page: Page) => page.getByRole("log", { name: "면접 대화" });
  const answerBox = (page: Page) => page.getByRole("textbox", { name: "내 답변" });
  async function reply(page: Page, text: string) {
    await answerBox(page).fill(text);
    await page.getByRole("button", { name: "답변 보내기" }).click();
  }
  async function startInterview(page: Page) {
    await toDraft(page);
    await goToStep(page, "모의면접");
    await page.getByRole("button", { name: "모의면접 시작" }).click();
    await expect(chat(page).locator("li").first()).toContainText("면접관");
  }

  test("[TC-501] 답할 때마다 꼬리질문이 2개까지 나오고, 그다음 질문별 피드백이 보인다", async ({ page }) => {
    await startInterview(page);
    await expect(page.getByText("질문 1 / 1 · 꼬리질문 0 / 2")).toBeVisible();

    await reply(page, LONG_ANSWER);
    await expect(chat(page).getByText("면접관 · 꼬리질문")).toHaveCount(1);
    await expect(page.getByText("꼬리질문 1 / 2")).toBeVisible();
    await expect(answerBox(page)).toHaveValue("");

    await reply(page, LONG_ANSWER);
    await expect(chat(page).getByText("면접관 · 꼬리질문")).toHaveCount(2);

    await reply(page, LONG_ANSWER);
    const feedback = page.getByLabel("질문별 피드백");
    await expect(feedback).toContainText("잘한 점");
    await expect(feedback).toContainText("보완할 점");
    await expect(chat(page).getByText("면접관 · 꼬리질문")).toHaveCount(2);
    await expect(answerBox(page)).toHaveCount(0);
    await page.getByRole("button", { name: "면접 마치기" }).click();
    await expect(page.getByText("피드백까지 받은 질문 1개")).toBeVisible();
  });

  test("[TC-502] '모르겠어요'에는 다시 북돋고, 또 모르면 멈추지 않고 피드백으로 넘어간다", async ({ page }) => {
    await startInterview(page);
    await reply(page, "모르겠어요");
    await expect(chat(page)).toContainText("비슷한 상황에서 직접 해 본 일이 있다면");
    await expect(page.getByText("꼬리질문 0 / 2")).toBeVisible();

    await reply(page, "잘 모르겠습니다");
    await expect(page.getByLabel("질문별 피드백")).toBeVisible();
  });

  test("[TC-503] 너무 짧은·무관한 답에는 꼬리질문 대신 구체적으로 다시 답해 달라고 한다", async ({ page }) => {
    await startInterview(page);
    await reply(page, "점심 뭐 먹지");
    await expect(chat(page)).toContainText("조금 더 구체적으로 말씀해 주시겠어요?");
    await expect(chat(page).getByText("면접관 · 꼬리질문")).toHaveCount(0);
    await expect(page.getByText("꼬리질문 0 / 2")).toBeVisible();
  });

  test("[TC-506] 빈 답변은 요청 없이 안내가 보인다", async ({ page }) => {
    const calls = trackApi(page);
    await startInterview(page);
    await page.getByRole("button", { name: "답변 보내기" }).click();

    await expect(page.locator("#interview-answer-hint")).toHaveText("답변을 입력해 주세요.");
    await expect(answerBox(page)).toHaveAttribute("aria-invalid", "true");
    expect(calls).not.toContain("/api/interview");
  });

  test("[TC-509] 면접 중 API가 실패하면 안내와 다시 시도가 보이고, 적은 답은 남아 이어서 진행된다", async ({ page }) => {
    await startInterview(page);
    let fail = true;
    await page.route("**/api/interview", async (route) => {
      if (fail) {
        fail = false;
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "AI_FAILED", message: "AI 응답을 받지 못했습니다. 다시 시도해 주세요." } }) });
      }
      return route.continue();
    });
    await reply(page, LONG_ANSWER);

    await expect(alertBox(page)).toContainText("AI 응답을 받지 못했습니다");
    await expect(answerBox(page)).toHaveValue(LONG_ANSWER);
    await alertBox(page).getByRole("button", { name: "다시 시도" }).click();
    await expect(chat(page).getByText("면접관 · 꼬리질문")).toHaveCount(1);
    await expect(alertBox(page)).toHaveCount(0);
  });

  test("[TC-510] 면접을 중간에 그만둬도 그때까지의 대화가 결과 정리에 남는다", async ({ page }) => {
    await startInterview(page);
    await reply(page, LONG_ANSWER);
    await expect(chat(page).getByText("면접관 · 꼬리질문")).toHaveCount(1);
    await page.getByRole("button", { name: "면접 그만하기" }).click();

    await expect(page.getByText("피드백까지 받은 질문 0개")).toBeVisible();
    await expect(page.locator("#step-export")).toContainText("모의면접 1문항");
  });
});

test.describe("결과 정리", () => {
  async function downloadHtml(page: Page): Promise<{ name: string; html: string }> {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "HTML로 저장" }).click()]);
    const file = await download.path();
    return { name: download.suggestedFilename(), html: readFileSync(file!, "utf8") };
  }

  test("[TC-603] 답변 초안이 없으면 저장·복사 버튼이 비활성이고 안내가 보인다", async ({ page }) => {
    await toQuestions(page);
    await goToStep(page, "결과 정리");
    await expect(page.getByRole("button", { name: "HTML로 저장" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Notion용 Markdown 복사" })).toBeDisabled();
    await expect(page.getByText("답변 초안을 하나 이상 만들어 주세요.", { exact: false })).toBeVisible();
  });

  test("[TC-601] HTML로 저장하면 질문이 유형별로 정리되고 초안 있는 질문엔 경험·답변이 들어 있다", async ({ page }) => {
    await toDraft(page);
    const answer = (await page.getByLabel("생성된 답변").inputValue()).trim();
    await goToStep(page, "결과 정리");
    const { name, html } = await downloadHtml(page);

    expect(name).toMatch(/^my-own-answer_\d{4}-\d{2}-\d{2}\.html$/);
    // 준비한 질문(★ 데모 질문 = 공고 기반)은 유형 제목 아래, 나머지 8개는 맨 아래 목록 (TC-601 변경: 내보내기 정리)
    expect(html).toContain("<h2>공고 기반</h2>");
    expect(html).toContain("<h4>내 경험</h4>");
    expect(html).toContain(answer.slice(0, 30));
    expect(html).toMatch(/<h2>아직 준비하지 않은 질문 \(8개\)<\/h2>/);
    expect(html.indexOf("<h4>내 경험</h4>")).toBeLessThan(html.indexOf("아직 준비하지 않은 질문"));
    // 이력서 내용은 내보내지 않는다
    expect(html).not.toContain("[이름]");
  });

  test("[TC-605] 모의면접을 하면 HTML에 대화와 질문별 피드백이 들어간다", async ({ page }) => {
    await toDraft(page);
    await goToStep(page, "모의면접");
    await page.getByRole("button", { name: "모의면접 시작" }).click();
    for (let i = 0; i < 3; i++) {
      await page.getByRole("textbox", { name: "내 답변" }).fill(LONG_ANSWER);
      await page.getByRole("button", { name: "답변 보내기" }).click();
      await expect(page.getByRole("log", { name: "면접 대화" }).locator("li").nth(2 * (i + 1))).toBeVisible();
    }
    await expect(page.getByLabel("질문별 피드백")).toBeVisible();
    await goToStep(page, "결과 정리");
    const { html } = await downloadHtml(page);

    expect(html).toContain("<h4>모의면접</h4>");
    expect(html).toContain(LONG_ANSWER);
    expect(html).toContain("<h4>피드백</h4>");
  });
});

test.describe("진행 단계 · 초안 고치기", () => {
  const steps = (page: Page) => page.getByRole("navigation", { name: "진행 단계" });

  test("[TC-004] 아직 갈 수 없는 단계는 비활성이고, 단계를 옮겨도 입력이 유지된다", async ({ page }) => {
    await page.goto("/");
    for (const name of ["질문과 답변", "모의면접", "결과 정리"]) {
      await expect(steps(page).getByRole("button", { name, exact: true })).toBeDisabled();
    }
    await expect(steps(page).getByRole("button", { name: "준비", exact: true })).toHaveAttribute("aria-current", "step");

    await toQuestions(page);
    await expect(steps(page).getByRole("button", { name: "모의면접", exact: true })).toBeDisabled();
    await goToStep(page, "준비");
    await expect(page.getByLabel("채용공고 본문")).not.toHaveValue("");
    await expect(page.getByLabel("가린 개인정보")).toBeVisible();
    await goToStep(page, "질문과 답변");
    await expect(page.getByRole("heading", { name: "예상 질문" })).toBeVisible();
  });

  test("[TC-404] 답변 초안을 고치면 모의면접과 결과 정리에 고친 내용이 쓰인다", async ({ page }) => {
    await toDraft(page);
    const edited = "고친 초안: 상태 전이도로 TC 34개를 만들어 자정 전후 결함을 찾았습니다.";
    await page.getByLabel("생성된 답변").fill(edited);

    const sent: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/interview")) sent.push(r.postDataJSON().draft);
    });
    await goToStep(page, "모의면접");
    await page.getByRole("button", { name: "모의면접 시작" }).click();
    await page.getByRole("textbox", { name: "내 답변" }).fill(LONG_ANSWER);
    await page.getByRole("button", { name: "답변 보내기" }).click();
    await expect(page.getByRole("log", { name: "면접 대화" }).getByText("면접관 · 꼬리질문")).toHaveCount(1);
    expect(sent).toEqual([edited]);

    await goToStep(page, "결과 정리");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "HTML로 저장" }).click()]);
    expect(readFileSync((await download.path())!, "utf8")).toContain(edited);
  });

  test("[TC-405] 초안을 만든 질문을 다시 고르면 경험을 다시 묻지 않고 초안을 보여 준다", async ({ page }) => {
    await toDraft(page);
    const answer = await page.getByLabel("생성된 답변").inputValue();
    const calls = trackApi(page);

    await page.locator("#step-questions").getByRole("button", { name: /^데모 체험 가능/ }).nth(1).click();
    await expect(page.getByRole("heading", { name: "내 경험 먼저 적기" })).toBeVisible();
    await demoQuestion(page).click();

    await expect(page.getByLabel("생성된 답변")).toHaveValue(answer);
    await expect(demoQuestion(page)).toContainText("초안 있음");
    expect(calls.filter((c) => c === "/api/experience")).toHaveLength(1); // 두 번째 질문 때 한 번만
  });

  test("[TC-406] 경험을 고쳐서 다시 만들면 고친 경험으로 새 초안이 만들어진다", async ({ page }) => {
    await toDraft(page);
    const bodies: { experience: string }[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/answer")) bodies.push(r.postDataJSON());
    });
    await page.getByRole("button", { name: "경험 고쳐서 다시 만들기" }).click();
    const box = page.getByRole("textbox", { name: "내 경험" });
    await expect(box).not.toHaveValue(""); // 전에 적은 경험이 채워져 있다
    await box.fill("고친 경험: 자정 전후 이체 결함을 상태 전이도로 찾았습니다.");
    await page.getByRole("button", { name: "이 경험으로 답변 초안 만들기" }).click();

    await expect(page.getByLabel("생성된 답변")).toBeVisible();
    expect(bodies.at(-1)?.experience).toBe("고친 경험: 자정 전후 이체 결함을 상태 전이도로 찾았습니다.");
    await expect(page.getByText("지금까지 만든 초안 1개", { exact: false })).toBeVisible();
  });
});

test.describe("시연 흐름", () => {
  test("[TC-005] 샘플만으로 처음부터 결과 정리(Markdown 복사)까지 직접 입력 없이 이어진다", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const sampleRes = page.waitForResponse("**/api/sample");
    await toQuestions(page);
    expect((await (await sampleRes).json()).sampleExperience).toContain("이체 한도");

    await demoQuestion(page).click();
    await page.getByRole("button", { name: "샘플 경험 채우기" }).click();
    await page.getByRole("button", { name: "이 경험으로 답변 초안 만들기" }).click();
    await expect(page.getByLabel("생성된 답변")).toBeVisible();

    await goToStep(page, "모의면접");
    await page.getByRole("button", { name: "모의면접 시작" }).click();
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "샘플 답 채우기" }).click();
      await expect(page.getByRole("textbox", { name: "내 답변" })).not.toHaveValue("");
      await page.getByRole("button", { name: "답변 보내기" }).click();
      await expect(page.getByRole("log", { name: "면접 대화" }).locator("li").nth(2 * (i + 1))).toBeVisible();
    }
    await expect(page.getByLabel("질문별 피드백")).toBeVisible();
    await page.getByRole("button", { name: "면접 마치기" }).click();
    await page.getByRole("button", { name: "결과 정리로 가기" }).click();

    await page.getByRole("button", { name: "Notion용 Markdown 복사" }).click();
    await expect(page.getByRole("button", { name: "복사했어요" })).toBeVisible();
    const md = await page.evaluate(() => navigator.clipboard.readText());
    expect(md).toMatch(/^# 면접 준비 노트/);
    expect(md).toContain("**답변 초안**");
    expect(md).toContain("**모의면접**");
    expect(md).toContain("**피드백**");
    expect(md).toMatch(/## 아직 준비하지 않은 질문 \(\d+개\)/);
  });
});
