import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { maskPersonalInfo, findNames } from "../../src/lib/mask";

/** 테스트 이름 앞의 [TC-xxx]는 docs/qa/test-cases.md의 TC ID */

test("[TC-201] 이름·전화번호·이메일이 각각의 토큰으로 바뀐다", () => {
  const input = "이름: 하은솔\n연락처: 010-0000-1234 / haeunsol@example.com\n저는 하은솔입니다.";
  const { text, counts } = maskPersonalInfo(input);

  assert.ok(!text.includes("하은솔"));
  assert.ok(!text.includes("010-0000-1234"));
  assert.ok(!text.includes("haeunsol@example.com"));
  assert.equal(counts.name, 2);
  assert.equal(counts.phone, 1);
  assert.equal(counts.email, 1);
  assert.match(text, /\[이름\]입니다/);
});

test("[TC-202] 다양한 전화번호 형식을 모두 가린다", () => {
  const phones = [
    "010-0000-1111",
    "010.0000.3333",
    "010 1234 5678",
    "01012345678",
    "(010)0000-3333",
    "+82-10-0000-1111",
    "+82 10 0000 3333",
    "02-123-4567",
    "031-1234-5678",
  ];
  for (const phone of phones) {
    const { text, counts } = maskPersonalInfo(`연락처: ${phone} 입니다`);
    assert.equal(text, "연락처: [전화번호] 입니다", `가리지 못한 형식: ${phone}`);
    assert.equal(counts.phone, 1, phone);
  }
});

test("[TC-202] 띄어쓰기가 다른 한글 이름과 괄호 속 영문 이름도 가린다", () => {
  assert.deepEqual(new Set(findNames("이름: 피 도윤")), new Set(["피 도윤", "피도윤"]));

  const { text } = maskPersonalInfo("이름: 표지안 (Jian Pyo)\n문의: 표지안 · Jian Pyo");
  assert.ok(!/표지안|Jian Pyo/.test(text), text);
});

test("[TC-202] 숫자가 들어간 일반 문장(성과 수치, 날짜)은 가리지 않는다", () => {
  const input = "2023.04 - 2023.07 | 기록률 31% → 52%, 사용자 4,000명, 크래시율 1.8%";
  assert.equal(maskPersonalInfo(input).text, input);
});

test("[TC-201] 테스트 데이터의 가상 이력서 5개에 원래 개인정보가 남지 않는다", () => {
  const dir = path.join(process.cwd(), "data", "resumes");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  assert.ok(files.length > 0, "data/resumes에 이력서가 없습니다");

  for (const file of files) {
    const raw = readFileSync(path.join(dir, file), "utf8");
    const { text } = maskPersonalInfo(raw);

    for (const name of findNames(raw)) {
      assert.ok(!text.includes(name), `${file}: 이름 "${name}"이 남음`);
    }
    assert.ok(!/@example\.com/.test(text), `${file}: 이메일이 남음`);
    assert.ok(!/01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}/.test(text), `${file}: 전화번호가 남음`);
    assert.ok(!/\+82/.test(text), `${file}: 국제 전화번호가 남음`);
  }
});
