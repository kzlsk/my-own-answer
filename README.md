# my-own-answer

이력서와 채용공고로 면접 예상 질문을 만들고, **내 실제 경험만으로** 답변 초안을 쓰고, 텍스트 모의면접까지 해 보는 면접 준비 서비스입니다.

> AI 네이티브 커리어 캠프 2기 1차 프로젝트 (작업 중)

## 주요 기능

1. 이력서 업로드 + 채용공고 붙여넣기
2. 개인정보 자동 마스킹
3. 예상 질문 생성 (이력서 / 직무 / 공고 기반)
4. 경험을 먼저 묻고, 그 경험으로만 답변 초안 작성
5. 텍스트 모의면접과 질문별 피드백
6. 결과를 HTML로 저장하거나 Notion용 Markdown으로 복사

## 실행 방법

필요한 것: Node.js 20 이상, OpenAI API 키

```bash
git clone https://github.com/<your-id>/my-own-answer.git
cd my-own-answer
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
```

`.env.local`을 열어 `OPENAI_API_KEY`에 본인 키를 넣은 뒤:

```bash
npm run dev
```

브라우저에서 http://localhost:3000 을 엽니다.

키를 넣지 않으면 **데모 모드**로 실행되어 미리 만들어 둔 샘플 결과만 보여 줍니다. 배포된 사이트도 데모 모드입니다.

## 테스트

기능마다 테스트 케이스를 먼저 설계하고, 화면에서 확인할 수 있는 케이스는 Playwright로 자동화했습니다.

```bash
npx playwright install chromium   # 처음 한 번
npm run test:unit                 # 마스킹 단위 테스트
npm run test:e2e
npm run test:report               # 결과 보고서 보기
```

E2E 테스트는 API 키 없이 데모 모드로 실행되어 비용이 들지 않습니다. GitHub에 push할 때마다 GitHub Actions에서 lint, build, E2E가 자동으로 돌아갑니다.

| 문서 | 내용 |
| --- | --- |
| [테스트 케이스](docs/qa/test-cases.md) | 영역별 TC (정상 · 경계 · 예외 · 보안) |
| [버그 리포트](docs/qa/bugs.md) | 발견한 버그와 수정 내역 |
| [테스트 결과](docs/qa/test-report.md) | 실행 기록과 최종 요약 |

## 폴더 구조

| 경로 | 내용 |
| --- | --- |
| `src/app` | 화면과 API 라우트 |
| `src/lib` | 마스킹, OpenAI 호출 등 공용 로직 |
| `prompts/` | 프롬프트 원문 (버전별) |
| `data/` | 가상 이력서, 공개 공고, 평가 결과 |
| `docs/ai-log.md` | AI 활용 과정 기록 |
| `docs/qa/` | 테스트 케이스, 버그 리포트, 테스트 결과 |
| `tests/e2e/` | Playwright E2E 테스트 |
| `.claude/skills/` | 이 프로젝트용 Claude Code 스킬 |
| `프롬프트.md` | 프롬프트 변경 기록 (제출용) |

## 평가 지표

핵심 지표는 **내 경험 근거 비율**입니다. 답변 초안의 사실 문장 중 이력서나 사용자 답변에 근거가 있는 문장의 비율을 프롬프트 v1과 v2로 비교합니다. 결과는 `data/results/`에 있습니다.
