import { defineConfig, devices } from "@playwright/test";

/**
 * E2E 테스트 설정
 * - 테스트용 서버는 3100 포트에서 따로 띄운다 (개발 서버 3000과 겹치지 않게).
 * - OPENAI_API_KEY를 비워서 항상 데모 모드로 실행한다.
 *   → 테스트가 API 비용을 쓰지 않고, 매번 같은 결과가 나온다.
 * - 개발 서버(next dev)가 아니라 빌드한 서버(next start)로 띄운다.
 *   개발 서버는 라우트를 처음 요청받을 때 컴파일해서, 병렬 실행 중 PDF 처리(unpdf) 같은 무거운
 *   라우트의 첫 응답이 expect 기본 대기(5초)를 넘겨 실패했다. CI는 앞 단계에서 이미 빌드한다.
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
    command: process.env.CI
      ? `npm run start -- --port ${PORT}`
      : `npm run build && npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { OPENAI_API_KEY: "" },
  },
});
