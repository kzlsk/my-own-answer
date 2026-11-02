import { test, expect } from "@playwright/test";

/**
 * 테스트 이름 앞의 [TC-xxx]는 docs/qa/test-cases.md의 TC ID와 연결된다.
 */

test.describe("첫 화면", () => {
  test("[TC-001] 서비스 이름과 첫 단계(이력서와 채용공고)가 보인다", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/my-own-answer/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("my-own-answer");
    await expect(page.getByRole("heading", { name: "이력서와 채용공고" })).toBeVisible();
  });

  test("[TC-002] API 키가 없으면 데모 모드 안내가 보인다", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("데모 모드로 실행 중입니다")).toBeVisible();
  });

  test("[TC-003] 상태 확인 API는 데모 여부만 알려 주고 키 값은 내보내지 않는다", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body.demo).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/sk-/);
    expect(Object.keys(body).sort()).toEqual(["demo", "model"]);
  });
});
