---
name: run-eval
description: 프롬프트 버전(v1, v2 등)을 테스트 세트 30건에 돌려 결과와 채점표를 만든다. "평가 돌려줘", "v1 v2 비교", "지표 측정", "기준선 측정"을 요청받으면 사용한다.
---

# run-eval — 프롬프트 버전 평가

목표: 같은 테스트 세트에 프롬프트 버전을 돌려 **내 경험 근거 비율**(핵심 지표)과 보조 지표를 비교할 수 있게 만든다.

## 입력 확인

1. `data/resumes/`(가상 이력서)와 `data/postings/`(공개 공고)에 파일이 있는지 확인한다. 없으면 멈추고 `make-test-data` 스킬을 먼저 쓰자고 말한다.
2. 평가할 프롬프트 파일이 `prompts/`에 있는지 확인한다 (예: `answer-v1.md`, `answer-v2.md`).
3. `.env.local`에 `OPENAI_API_KEY`가 있는지 확인한다. 없으면 실행하지 않고 알린다. 키 값은 절대 출력하지 않는다.

## 실행

1. `scripts/eval.ts`가 없으면 만든다. 요구사항:
   - 이력서 × 공고 조합을 순서대로 실행 (기본 30건, `--limit`으로 줄일 수 있음)
   - 인자: `--target question|answer|interviewer`, `--version v1`, `--limit N`
   - 앱과 **같은** 마스킹 함수(`src/lib/`)와 같은 프롬프트 파일을 사용한다. 평가용으로 따로 복사하지 않는다.
   - 답변 초안 평가에 필요한 "사용자 경험 답변"은 `data/resumes/` 파일 안의 `## 경험 답변` 섹션에서 읽는다.
   - 건마다 응답 시간(ms)과 오류 여부를 기록한다. 한 건이 실패해도 나머지는 계속한다.
   - `package.json`에 `"eval": "tsx scripts/eval.ts"` 스크립트를 추가한다 (`tsx`는 devDependency).
2. `npm run eval -- --target <대상> --version <버전>`으로 실행한다. 처음에는 `--limit 3`으로 시험한 뒤 전체를 돌린다.

## 출력

`data/results/<YYYY-MM-DD>-<대상>-<버전>/` 폴더에:

- `raw.json`: 건별 입력 파일명, 출력, 응답 시간, 오류
- `scoring.csv`: 사람이 채점할 표. 답변 초안은 **문장 단위**로 한 줄씩 나누고 열은 다음과 같다:
  `case_id, resume, posting, sentence_no, sentence, label(내경험/지어냄/일반), evidence(근거 위치), note`
  `label`과 `evidence`는 비워 둔다 — **채점은 사람이 한다.** AI가 미리 채우지 않는다.
- `summary.md`: 실행 건수, 오류 수, 평균·최대 응답 시간

## 채점이 끝난 뒤

사용자가 `scoring.csv`를 채우면 집계한다:

- 내 경험 근거 비율 = 내경험 문장 수 ÷ (내경험 + 지어냄) 문장 수
- 지어낸 문장 수
- 버전끼리 표로 비교해 `summary.md`에 추가하고, `log-prompt` 스킬로 `프롬프트.md`에 결과를 남기자고 제안한다.

## 하지 말 것

- 채점 라벨을 AI가 채우기 (평가의 신뢰성이 깨진다)
- 테스트 세트를 버전마다 바꾸기
- 실제 개인정보가 담긴 파일을 평가에 쓰기
