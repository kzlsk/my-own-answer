import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { maskPersonalInfo, findNames, namesFromFileName, collapseDoubledLines } from "../../src/lib/mask";

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

// ---------- 실제 이력서에서 발견한 형식 (BUG-005). 실제 이력서는 넣지 않고 같은 구조의 가상 데이터로 재현 ----------

const HEADLINE_RESUME = [
  "IntroIntro",
  "Frontend Developer 피도윤Frontend Developer 피도윤",
  "2001. 05. 17 | pidoyun@example.com | 010-0000-0000 | https://github.com/pidoyun2001. 05. 17 | pidoyun@example.com | 010-0000-0000 | https://github.com/pidoyun",
  "사용자 흐름까지 책임지는 개발자입니다.",
  "",
  "책갈피 | 2023. 09 - 2023. 11 | FE (피도윤 / 견태오)",
  "스텝노트 | 2022.07.01 - 2024.03.31",
].join("\n");

test("[TC-203] '이름:' 표시가 없어도 제목 줄(직무 + 이름)의 이름을 찾아 모두 가린다", () => {
  const { text, counts } = maskPersonalInfo(collapseDoubledLines(HEADLINE_RESUME));
  assert.ok(!text.includes("피도윤"), text);
  assert.equal(counts.name, 2); // 제목 줄 1 + 프로젝트 역할 1 (겹친 줄을 합친 뒤)
  assert.match(text, /Frontend Developer \[이름\]/);
});

test("[TC-203] 파일 이름에 든 이름도 찾는다", () => {
  assert.deepEqual(namesFromFileName("FE_피도윤_이력서.pdf"), ["피도윤"]);
  assert.deepEqual(namesFromFileName("이력서_최종_수정.pdf"), []);
  assert.deepEqual(namesFromFileName("resume (1).pdf"), []);
  const { text } = maskPersonalInfo("소개: 저는 백엔드를 공부했습니다. 견태오", { names: namesFromFileName("BE_견태오_경력기술서.pdf") });
  assert.ok(!text.includes("견태오"));
});

test("[TC-203] 제목 줄의 '개발자입니다' 같은 말은 이름으로 착각하지 않는다", () => {
  const { counts } = maskPersonalInfo("백엔드 개발자 입니다.\n프론트엔드 개발자 지원자");
  assert.equal(counts.name, 0);
});

test("[TC-204] 첫머리의 생년월일은 가리고, 경력 기간 날짜는 남긴다", () => {
  const { text, counts } = maskPersonalInfo(collapseDoubledLines(HEADLINE_RESUME));
  assert.ok(!text.includes("2001. 05. 17"), text);
  assert.equal(counts.birth, 1);
  assert.ok(text.includes("2023. 09 - 2023. 11"));
  assert.ok(text.includes("2022.07.01 - 2024.03.31"), "기간으로 쓴 연·월·일 날짜는 생년월일이 아니다");
});

test("[TC-204] '생년월일:' 표시가 있으면 위치와 상관없이 가린다", () => {
  const body = "가".repeat(500) + "\n생년월일: 1999년 3월 2일\n";
  const { text, counts } = maskPersonalInfo(body);
  assert.ok(text.includes("생년월일: [생년월일]"));
  assert.equal(counts.birth, 1);
});

test("[TC-205] 사용자가 입력한 단어(팀원 이름 등)를 가린다", () => {
  const { text, counts } = maskPersonalInfo(collapseDoubledLines(HEADLINE_RESUME), { words: ["견태오", "x"] });
  assert.ok(!text.includes("견태오"));
  assert.equal(counts.custom, 1);
});

test("[TC-117] 글자 층이 겹쳐 두 번 붙은 줄은 한 번으로 줄인다", () => {
  assert.equal(collapseDoubledLines("IntroIntro\n안녕하세요\nabab"), "Intro\n안녕하세요\nab");
  assert.equal(collapseDoubledLines("2023 2023"), "2023 2023", "띄어 쓴 반복은 그대로 둔다");
});

test("[TC-206] 피그마·노션·원티드 형식의 가상 이력서 3종에서 이름·연락처·생년월일이 남지 않는다", () => {
  const dir = path.join(process.cwd(), "data", "resumes-raw");
  const cases: [string, string[]][] = [
    ["f01-figma.txt", ["피도윤", "1998. 04. 12", "pidoyun@example.com", "010-0000-0000", "github.com/pidoyun"]],
    ["f02-notion.md", ["견태오", "taeo.gyeon@example.com", "010 1234 5678", "github.com/taeo-gyeon"]],
    ["f03-wanted.txt", ["표지안", "jian.pyo@example.com", "010.0000.3333", "jianpyo.example.com"]],
  ];
  for (const [file, secrets] of cases) {
    const raw = readFileSync(path.join(dir, file), "utf8");
    const { text } = maskPersonalInfo(collapseDoubledLines(raw));
    for (const secret of secrets) assert.ok(!text.includes(secret), `${file}: "${secret}"가 남음`);
  }
});

test("[TC-206] 경력 기간·성과 수치는 마스킹 후에도 남는다", () => {
  const raw = readFileSync(path.join(process.cwd(), "data", "resumes-raw", "f03-wanted.txt"), "utf8");
  const { text } = maskPersonalInfo(raw);
  for (const kept of ["2022.01 - 재직 중", "31% → 52%", "8.2% → 6.1%", "2013.03 - 2018.02"]) assert.ok(text.includes(kept), kept);
});

test("[TC-206] 직무명 다음 줄의 단어는 이름으로 보지 않는다 (원티드 형식 'PM\\n복약 관리 앱')", () => {
  const { text, counts } = maskPersonalInfo("경력\n온새미헬스\nPM\n복약 관리 앱 알림·기록 기능 담당");
  assert.equal(counts.name, 0);
  assert.ok(text.includes("복약 관리 앱"));
});
