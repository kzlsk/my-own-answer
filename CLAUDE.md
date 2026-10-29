# CLAUDE.md — my-own-answer

AI 네이티브 커리어 캠프 2기 1차 프로젝트(개인, 5일). 개발 직군.

## 서비스 한 줄

이력서와 채용공고를 넣으면 면접 예상 질문을 만들고, 내 실제 경험을 먼저 물어본 뒤 그 경험만으로 답변 초안을 쓴다. 이어서 텍스트 모의면접과 결과 내보내기(HTML, Notion용 Markdown)까지 한다.

## 핵심 흐름 (이 순서로 만든다)

1. 이력서 업로드(PDF/텍스트) + 채용공고 붙여넣기
2. 개인정보(이름·전화번호·이메일) 마스킹 — **API 호출 전에** 처리
3. 예상 질문 생성: 이력서 / 직무 / 공고 기반
4. 질문 선택 → 관련 경험을 먼저 질문
5. 사용자 답변에 있는 경험만으로 답변 초안 생성
6. 텍스트 모의면접: 질문 → 답 → 꼬리질문 1~2개 → 질문별 피드백
7. 결과 정리: HTML 저장, Notion용 Markdown 복사

범위 밖: 음성 면접, ZEP 스타일 화면, Notion API 업로드, 로그인/DB, RAG.
RAG를 쓰지 않는 이유: 근거 자료(이력서 1, 공고 1, 질문·답변 20개 내외)가 작아서 프롬프트에 통째로 넣는다.

## 스택

- Next.js 15 (App Router) + TypeScript + Tailwind CSS
- OpenAI API (`openai` 패키지) — **서버(Route Handler, `src/app/api/**`)에서만 호출**
- 배포: Vercel

## 규칙

- API 키는 `process.env.OPENAI_API_KEY`로만 읽는다. 클라이언트 코드(`"use client"`)에서 절대 쓰지 않는다. `NEXT_PUBLIC_` 접두사 금지.
- 키가 없으면 데모 모드: `data/results/`의 미리 생성한 샘플 결과를 보여 준다. 에러로 죽지 않는다.
- 프롬프트는 코드에 하드코딩하지 않고 `prompts/*.md` 파일로 둔다. 파일명에 버전을 붙인다 (`question-v1.md`, `question-v2.md`).
- 프롬프트를 바꾸면 루트의 `프롬프트.md`에 변경 이유와 결과 수치를 남긴다.
- AI가 틀린 코드를 냈다가 고친 사례는 `docs/ai-log.md`에 남긴다.
- 실제 개인정보·회사 내부 자료는 저장소에 넣지 않는다. 테스트 데이터는 가상 인물/공개 공고만.
- UI 문구는 한국어.

## 안정성 (반드시 막고 시연)

- 빈 입력, 지원하지 않는 파일 형식, 용량 초과
- 공고가 아닌 텍스트, 너무 긴 입력
- API 실패·키 누락·시간 초과 → 에러 화면 + 다시 시도
- 민감정보 마스킹 결과를 화면에 표시
- 모의면접: 빈 답변/"모르겠어요", 면접과 무관한 말, 이력서에 없는 경험을 전제로 한 꼬리질문

## 지표 (평가용)

- 핵심: **내 경험 근거 비율** — 답변 초안의 사실 문장 중 이력서·사용자 답변에 근거가 있는 비율. 문장마다 내 경험 / 지어낸 경험 / 일반적인 말로 표시하고 지어낸 문장 수도 함께 기록.
- 보조: 공고 키워드 반영률, 질문 중복률, 꼬리질문 근거 비율, 응답 시간
- 테스트 세트: 가상 이력서 5 × 공개 공고 6 = 30건. v1과 v2를 같은 세트로 돌려 비교.

## QA (이 프로젝트는 QA 포트폴리오로도 쓴다)

- 새 기능을 만들기 **전에** `write-tc` 스킬로 TC를 먼저 설계한다.
- 기능을 만든 뒤 `e2e-test` 스킬로 E2E 대상 TC를 Playwright로 자동화한다.
- E2E 테스트는 OpenAI를 호출하지 않는다 (데모 모드 + route mock).
- 버그는 `docs/qa/bugs.md`에, 실행 결과는 `docs/qa/test-report.md`에 남긴다.
- 테스트를 통과시키려고 기대 결과를 바꾸지 않는다.
- 화면 요소에는 테스트하기 쉽게 의미 있는 role, label을 붙인다.

## 프로젝트 스킬 (`.claude/skills/`)

| 스킬 | 언제 |
| --- | --- |
| `make-test-data` | 가상 이력서, 공개 공고 만들기 |
| `run-eval` | 프롬프트 버전을 30건에 돌려 지표 측정 |
| `log-prompt` | 프롬프트 새 버전, 평가 결과, AI 실수, 설계 판단 기록 |
| `write-tc` | 기능별 테스트 케이스 설계 |
| `e2e-test` | TC를 Playwright로 자동화하고 결과 기록 |

## 폴더

```
prompts/              프롬프트 원문 (버전별)
data/resumes/         가상 이력서
data/postings/        공개 채용공고 (출처 표기)
data/results/         v1·v2 실행 결과, 채점 표, 데모용 샘플
docs/ai-log.md        AI 실수와 수정 기록, 설계 판단
docs/qa/              TC, 버그 리포트, 테스트 결과 보고서
tests/e2e/            Playwright 테스트 (테스트 이름에 TC ID)
프롬프트.md           제출용 프롬프트 기록
src/app/api/          OpenAI 호출 Route Handler
src/lib/              공용 로직 (마스킹, OpenAI 클라이언트 등)
.github/workflows/    push마다 lint · build · E2E 자동 실행
```

## 명령어

- `npm run dev` — 개발 서버 (3000)
- `npm run build` / `npm run lint`
- `npm run test:e2e` — E2E 테스트 (3100 포트에 데모 모드 서버를 띄워 실행)
- `npm run test:report` — 마지막 E2E 결과 보고서 열기
- `npm run test:unit` — 단위 테스트 (마스킹)

## 작업 방식

- 한 번에 한 단계씩 만들고, 단계가 끝나면 `npm run build`가 통과하는지 확인한다.
- 큰 변경 전에 무엇을 바꿀지 먼저 말한다.
