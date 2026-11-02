import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, scoreOcr } from "../../scripts/lib/ocr-score";

test("[TC-125] 판독 채점: 공백·목록 기호·마크다운 꾸밈 차이는 틀린 것으로 세지 않는다", () => {
  assert.equal(normalize("## 담당업무\n  - React 및Next.js\n( 1명 )"), normalize("담당업무\n- React 및 Next.js\n(1명)"));
  const r = scoreOcr("담당업무\n- 목업 작성", "**담당업무**\n  * 목업 작성");
  assert.equal(r.accuracy, 1);
  assert.deepEqual(r.diffs, []);
});

test("[TC-125] 판독 채점: 바뀐 단어와 빠진 문단을 구간으로 찾는다", () => {
  // 바로 붙어 있는 편집은 한 구간으로 묶이므로, 빠진 문단과 바뀐 단어 사이에 맞는 글자("업무:")를 둔다
  const truth = "회사 소개 문단입니다.\n업무: 의료 영상\n- 목업 작성";
  const r = scoreOcr(truth, "업무: 외로 영상\n- 목욕 작성");
  assert.deepEqual(r.diffs, [
    { truth: "회사소개문단입니다.", output: "" },
    { truth: "의료", output: "외로" },
    { truth: "업", output: "욕" },
  ]);
  assert.equal(r.distance, 10 + 2 + 1);
  assert.ok(r.accuracy < 0.5);
});
