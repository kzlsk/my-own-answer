import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cleanAnswer, hasMaskToken } from "../../src/lib/sanitize";
import { looksLikePosting } from "../../src/lib/posting";

/** 테스트 이름 앞의 [TC-xxx]·[BUG-xxx]는 docs/qa의 ID */

test("[BUG-001] 마스킹 토큰이 든 자기소개 문장은 빠지고 나머지는 남는다", () => {
  const out = cleanAnswer("안녕하세요, 저는 [이름]입니다. 좌석 중복 판매 문제를 해결했습니다.");
  assert.equal(out, "좌석 중복 판매 문제를 해결했습니다.");
  assert.equal(hasMaskToken(out), false);
});

test("[BUG-001] 문장 중간의 토큰도 지운다", () => {
  const out = cleanAnswer("연락은 [전화번호] 으로 주세요. 결과는 [링크]에 정리했습니다.");
  assert.equal(hasMaskToken(out), false);
});

test("[BUG-001] 굵게 표시·목록 같은 마크다운을 지운다", () => {
  assert.equal(cleanAnswer("**일관성**이 중요합니다."), "일관성이 중요합니다.");
  assert.equal(cleanAnswer("- 첫째\n- 둘째"), "첫째\n둘째");
});

test("[TC-106] 수집한 공개 공고 6개는 모두 공고로 판별된다", () => {
  const dir = path.join(process.cwd(), "data", "postings");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  assert.ok(files.length > 0);
  for (const f of files) {
    assert.ok(looksLikePosting(readFileSync(path.join(dir, f), "utf8")), `${f}가 공고로 판별되지 않음`);
  }
});

test("[TC-106] 날씨 기사·이력서 같은 글은 공고가 아니라고 판별된다", () => {
  const weather = "오늘 서울은 대체로 맑고 낮 최고기온은 18도로 어제보다 조금 높겠습니다. 주말에는 비 소식이 있습니다.";
  assert.equal(looksLikePosting(weather), false);
  const resume = readFileSync(path.join(process.cwd(), "data", "resumes", "r04-marketing.md"), "utf8");
  assert.equal(looksLikePosting(resume), false, "이력서가 공고로 판별됨 (이력서를 공고 칸에 잘못 넣은 경우)");
});
