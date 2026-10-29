import { defineConfig, devices } from "@playwright/test";

/**
 * E2E 테스트 설정
 * - 테스트용 서버는 3100 포트에서 따로 띄운다 (개발 서버 3000과 겹치지 않게).
 * - OPENAI_API_KEY를 비워서 항상 데모 모드로 실행한다.
 *   → 테스트가 API 비용을 쓰지 않고, 매번 같은 결과가 나온다.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { OPENAI_API_KEY: "" },
  },
});
