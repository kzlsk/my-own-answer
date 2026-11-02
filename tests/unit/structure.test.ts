import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFidelity, toMarkdown, type StructuredResume } from "../../src/lib/resume-structure";

/** 테스트 이름 앞의 [TC-xxx]는 docs/qa/test-cases.md의 TC ID */

const empty: StructuredResume = {
  summary: "",
  experiences: [],
  projects: [],
  skills: [],
  activities: [],
  certificates: [],
  awards: [],
  uncategorized: [],
};

const sample: StructuredResume = {
  ...empty,
  summary: "느려지는 화면의 원인을 숫자로 찾습니다.",
  experiences: [{ org: "스텝노트", role: "프론트엔드 개발자", period: "2022.07 - 2024.03", details: ["학원 관리 SaaS 출결 대시보드 개발"] }],
  projects: [
    {
      name: "출결 대시보드 렌더링 개선",
      period: "2023.02 - 2023.05",
      role: "",
      stack: "React, react-window",
      details: ["첫 화면 4.8초 → 1.6초"],
      troubles: [{ problem: "체크 하나에 표 전체가 다시 그려짐", solution: "행 컴포넌트 memo 분리", result: "반영 지연 약 520ms → 약 40ms" }],
    },
  ],
  skills: ["TypeScript", "React"],
  certificates: [{ name: "SQLD", date: "2023.05" }],
};

test("[TC-119] 정리 결과는 항상 같은 섹션 순서의 MD가 되고, 빈 섹션은 빠진다", () => {
  const md = toMarkdown(sample);
  const headings = md.split("\n").filter((l) => l.startsWith("## "));
  assert.deepEqual(headings, ["## 경력", "## 프로젝트", "## 기술 스택", "## 자격증"]);
  assert.match(md, /### 스텝노트 \| 프론트엔드 개발자 \| 2022\.07 - 2024\.03/);
  assert.match(md, /### 출결 대시보드 렌더링 개선 \| 2023\.02 - 2023\.05\n기술: React, react-window/);
});

test("[TC-120] 트러블슈팅은 해당 프로젝트 안에 문제 → 해결 → 결과로 들어간다", () => {
  const md = toMarkdown(sample);
  const project = md.slice(md.indexOf("### 출결 대시보드"), md.indexOf("## 기술 스택"));
  assert.match(project, /트러블슈팅\n- 문제: 체크 하나에 표 전체가 다시 그려짐\n {2}- 해결: 행 컴포넌트 memo 분리\n {2}- 결과: 반영 지연 약 520ms → 약 40ms/);
});

test("[TC-121] 원문에 있는 수치만 쓰면 수치 보존 100%", () => {
  const source = "스텝노트 2022. 07 - 2024. 03\n첫 화면 4.8초 → 1.6초, 반영 지연 약 520ms → 약 40ms, 2023.02 - 2023.05, 2023.05 SQLD";
  const f = checkFidelity(source, toMarkdown(sample));
  assert.equal(f.missing.length, 0, f.missing.join(","));
  assert.equal(f.ratio, 1);
});

test("[TC-121] 원문에 없는 수치(바뀐 숫자·지어낸 숫자)를 찾아낸다", () => {
  const source = "첫 화면 4.8초 → 1.6초. 2023년에 입사.";
  const changed = "첫 화면 4.8초 → 1.2초. 2023년에 입사. 전환율 30% 상승";
  const f = checkFidelity(source, changed);
  assert.deepEqual(f.missing.sort(), ["1.2", "30"]);
  assert.ok(f.ratio < 1);
});

test("[TC-121] 쉼표 자릿수·띄어 쓴 날짜는 같은 숫자로 본다", () => {
  const f = checkFidelity("동시 접속 약 4000명, 2023. 09 - 2023. 11", "동시 접속 약 4,000명, 2023.09 - 2023.11");
  assert.equal(f.missing.length, 0, f.missing.join(","));
});
