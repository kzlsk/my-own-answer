---
name: e2e-test
description: docs/qa/test-cases.md에서 자동화가 E2E인 TC를 Playwright 테스트로 만들고 실행해 결과를 기록한다. "E2E 테스트", "자동화", "Playwright", "테스트 돌려줘"를 요청받으면 사용한다.
---

# e2e-test — Playwright 자동화

## 순서

1. `docs/qa/test-cases.md`에서 자동화 칸이 `E2E` 또는 `E2E(데모)`이고 아직 테스트가 없는 TC를 고른다. 대상 기능이 아직 구현되지 않았으면 그 TC는 건너뛰고 알린다.
2. `tests/e2e/<영역>.spec.ts`에 테스트를 추가한다.
3. `npm run test:e2e`로 실행한다.
4. 결과를 기록한다:
   - `docs/qa/test-cases.md`의 결과 칸 (Pass / Fail)과 요약 표
   - `docs/qa/test-report.md` 맨 위에 실행 기록 한 줄
   - Fail이면 `docs/qa/bugs.md`에 BUG를 등록한다 (재현 절차, 기대/실제 결과, 실패 스크린샷 경로). **테스트를 통과시키려고 기대 결과를 바꾸지 않는다.** 기대 결과가 잘못된 경우에만 사용자에게 확인받고 TC를 고친다.

## 작성 규칙

- 테스트 이름은 `[TC-xxx] <기대 결과 요약>` 형식. TC ID로 문서와 연결한다.
- 선택자는 `getByRole`, `getByLabel`, `getByText` 순으로 쓴다. CSS 클래스·nth-child에 의존하지 않는다. 필요하면 컴포넌트에 `aria-label`이나 `data-testid`를 추가한다.
- **OpenAI를 실제로 호출하지 않는다.** 테스트 서버는 키 없이(데모 모드) 뜬다 (`playwright.config.ts`).
  - AI 결과가 필요한 흐름은 데모 모드 샘플로 확인한다.
  - API 실패·지연·깨진 응답은 `page.route('**/api/...', ...)`로 응답을 가로채서 만든다 (TC-701~703).
- 고정 대기(`waitForTimeout`)를 쓰지 않는다. `expect(...).toBeVisible()` 같은 자동 대기를 쓴다.
- 업로드 테스트 파일은 `tests/fixtures/`에 둔다. 가상 데이터만 쓴다.
- 데스크톱과 모바일 두 프로젝트에서 모두 통과해야 한다.

## 실패했을 때 분석

- `playwright-report/`의 trace와 스크린샷을 확인한다.
- 원인을 "테스트 코드 문제 / 앱 버그 / 환경 문제"로 나눠 설명한다.
- AI가 잘못 짠 테스트였다면 `log-prompt` 스킬로 `docs/ai-log.md`에 사례를 남긴다.
