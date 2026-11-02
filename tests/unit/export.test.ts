import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, toHtml, toMarkdown, type ExportData } from "../../src/lib/export";

const q1 = { id: "q1", type: "resume" as const, question: "자동화 경험을 말해 주세요." };
const q2 = { id: "q2", type: "posting" as const, question: "커머스 QA에서 중요한 점은?" };

const data: ExportData = {
  date: "2026-11-01",
  questions: [q2, q1],
  drafts: [{ question: q1, experience: "스모크 45개 중 30개 자동화\n- 3시간 → 25분", answer: "Appium으로 30개를 자동화했습니다." }],
  interviews: [
    {
      question: q1,
      turns: [
        { role: "interviewer", kind: "question", text: q1.question },
        { role: "candidate", kind: "answer", text: "Appium으로 30개를 자동화했습니다." },
        { role: "interviewer", kind: "closing", text: "답변 잘 들었습니다." },
      ],
      feedback: { good: ["수치로 말함"], improve: ["기준을 말하지 않음"], tip: "기준부터 말하세요." },
    },
  ],
};

test("[TC-602] Markdown: 준비한 질문은 유형별 제목 → 질문 → 경험(인용)·초안·면접·피드백, 준비 안 한 질문은 맨 아래 목록", () => {
  const md = toMarkdown(data);
  assert.ok(md.startsWith("# 면접 준비 노트 (2026-11-01)"));
  assert.match(md, /## 이력서 기반/);
  assert.doesNotMatch(md, /## 공고 기반/); // 공고 기반 질문(q2)은 준비하지 않았으므로 유형 제목이 없다
  assert.match(md, /### Q\. 자동화 경험을 말해 주세요\./);
  assert.match(md, /> 스모크 45개 중 30개 자동화\n> \\- 3시간 → 25분/); // 사용자 글의 "- "는 목록으로 바뀌지 않게
  assert.match(md, /- \*\*나\*\*: Appium으로/);
  assert.match(md, /- 보완할 점: 기준을 말하지 않음/);
  assert.match(md, /## 아직 준비하지 않은 질문 \(1개\)\n\n- \[공고 기반\] 커머스 QA에서 중요한 점은\?/);
  assert.ok(md.indexOf("## 이력서 기반") < md.indexOf("## 아직 준비하지 않은 질문"));
});

test("[TC-604] HTML: 사용자·AI가 쓴 글의 태그는 실행되지 않고 글자로 보인다", () => {
  const evil = '<script>alert(1)</script><img src=x onerror="alert(2)">';
  const html = toHtml({
    ...data,
    drafts: [{ question: q1, experience: evil, answer: evil }],
    questions: [{ ...q1, question: evil }],
  });
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.equal(escapeHtml(`"'&`), "&quot;&#39;&amp;");
});

test("[TC-605] HTML: 면접 대화와 피드백이 들어간다", () => {
  const html = toHtml(data);
  assert.match(html, /<h4>모의면접<\/h4>/);
  assert.match(html, /<b>나<\/b> Appium으로 30개를 자동화했습니다\./);
  assert.match(html, /잘한 점<\/b><ul><li>수치로 말함/);
  assert.match(html, /<b>다음엔<\/b> 기준부터 말하세요\./);
});
