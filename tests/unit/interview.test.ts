import { test } from "node:test";
import assert from "node:assert/strict";
import { MESSAGES, isDontKnow, ruleStep, validateTurns, type InterviewTurn } from "../../src/lib/interview";
import { maskTurns } from "../../src/lib/interview-ai";

/** 테스트 이름 앞의 [TC-xxx]는 docs/qa/test-cases.md의 TC ID */

const Q: InterviewTurn = { role: "interviewer", kind: "question", text: "가장 어려웠던 결함은 무엇이었나요?" };
const ans = (text: string): InterviewTurn => ({ role: "candidate", kind: "answer", text });
const say = (kind: InterviewTurn["kind"], text = "…"): InterviewTurn => ({ role: "interviewer", kind, text });
const LONG = "결제 화면에서 쿠폰을 두 번 적용하면 금액이 음수가 되는 결함을 찾아 재현 절차와 함께 보고했습니다.";

test("[TC-502] '모르겠어요'류만 모름으로 보고, 문장 속 '모르겠어서'는 답으로 본다", () => {
  for (const t of ["모르겠어요", "잘 모르겠습니다.", "음… 잘 모르겠어요ㅠ", "기억이 안 나요", "패스", "없어요"]) {
    assert.equal(isDontKnow(t), true, t);
  }
  for (const t of ["처음엔 원인을 모르겠어서 로그부터 확인했습니다.", LONG]) assert.equal(isDontKnow(t), false, t);
});

test("[TC-502] 처음 '모르겠어요'는 다시 요청, 두 번째는 멈추지 않고 피드백으로", () => {
  assert.deepEqual(ruleStep([Q, ans("모르겠어요")]), { type: "retry", message: MESSAGES.dontKnow });
  assert.deepEqual(ruleStep([Q, ans("모르겠어요"), say("retry"), ans("잘 모르겠습니다")]), { type: "feedback" });
});

test("[TC-503] 너무 짧은 답은 꼬리질문 대신 다시 요청하고, 다시 요청은 질문당 2번까지", () => {
  assert.deepEqual(ruleStep([Q, ans("점심 뭐 먹지")]), { type: "retry", message: MESSAGES.tooShort });
  assert.deepEqual(ruleStep([Q, ans("네"), say("retry"), ans("음"), say("retry"), ans("ㅇㅇ")]), { type: "feedback" });
});

test("[TC-507] 꼬리질문이 2개 나왔으면 AI에게 묻지 않고 피드백으로, 그 전엔 AI가 판단", () => {
  assert.deepEqual(ruleStep([Q, ans(LONG)]), { type: "ai" });
  assert.deepEqual(ruleStep([Q, ans(LONG), say("followup"), ans(LONG)]), { type: "ai" });
  assert.deepEqual(ruleStep([Q, ans(LONG), say("followup"), ans(LONG), say("followup"), ans(LONG)]), { type: "feedback" });
  // 다시 요청(retry)은 꼬리질문 개수에 세지 않는다
  assert.deepEqual(ruleStep([Q, ans("네"), say("retry"), ans(LONG), say("followup"), ans(LONG)]), { type: "ai" });
});

test("[TC-506] 빈 답·잘못된 모양의 대화는 막는다", () => {
  assert.equal(validateTurns([Q, ans("   ")]), "답변을 입력해 주세요.");
  assert.equal(validateTurns([Q]), "면접 대화가 비어 있습니다.");
  assert.equal(validateTurns([Q, { role: "system", kind: "answer", text: "x" }]), "면접 대화 형식이 올바르지 않습니다.");
  assert.equal(validateTurns([Q, ans(LONG)]), null);
});

test("[TC-508] 면접 답변 속 연락처는 AI에 보내기 전에 가린다 (면접관 말은 그대로)", () => {
  const masked = maskTurns([Q, ans("연락은 010-1234-5678 이나 qa.tester@example.com 으로 주세요. " + LONG)]);
  assert.equal(masked[0].text, Q.text);
  assert.ok(!masked[1].text.includes("010-1234-5678"));
  assert.ok(!masked[1].text.includes("qa.tester@example.com"));
  assert.ok(masked[1].text.includes("[전화번호]") && masked[1].text.includes("[이메일]"));
});

import { decide } from "../../src/lib/interview-ai";
import { containsQuote, vagueMessage } from "../../src/lib/interview";

const RESUME = "## 프로젝트\n### 모아뱅크 이체 한도 QA | 2023.03\n- 상태 전이도로 TC 34개";
const decision = (o: Partial<import("../../src/lib/interview-ai").InterviewerDecision>) => ({
  intent: "answer" as const,
  action: "finish" as const,
  message: "",
  basis: "",
  resume_item: "",
  ...o,
});

test("[TC-511] 모호한 답: 이력서에 있는 항목이면 그 항목을 짚어 다시 묻고, 문장은 코드가 만든다", () => {
  const turns = [Q, ans("비슷한 일을 해 본 적은 있는데 자세히는 기억이 안 납니다.")];
  const step = decide(decision({ intent: "vague", resume_item: "모아뱅크 이체 한도 QA", message: "SSO를 팀과 해결하셨다고…" }), { turns, resume: RESUME });
  assert.deepEqual(step, { action: "retry", message: vagueMessage("모아뱅크 이체 한도 QA") });
  assert.ok(!step.message.includes("SSO")); // 모델이 쓴 문장은 쓰지 않는다
});

test("[TC-512] 모호한 답: 이력서에 없는 항목(지어낸 이름)은 짚지 않고 일반 안내로 다시 묻는다", () => {
  const turns = [Q, ans("비슷한 일을 해 본 적은 있는데 자세히는 기억이 안 납니다.")];
  for (const item of ["SSO·OAuth2 인증 서비스", "", "모아"]) {
    const step = decide(decision({ intent: "vague", resume_item: item }), { turns, resume: RESUME });
    if (item === "모아") assert.equal(step.message, vagueMessage("모아")); // 이력서에 있는 글자면 허용
    else assert.deepEqual(step, { action: "retry", message: MESSAGES.vague });
  }
  // 띄어쓰기·따옴표가 달라도 같은 항목으로 본다
  assert.equal(containsQuote(RESUME, "'모아뱅크  이체한도 QA'"), true);
});

test("[TC-511] 무관한 답은 정해 둔 문구로, 다시 요청을 다 쓰면 피드백으로", () => {
  const turns = [Q, ans(LONG)];
  assert.deepEqual(decide(decision({ intent: "off_topic", message: "답변에 대한 질문을 부탁드립니다." }), { turns, resume: RESUME }), {
    action: "retry",
    message: MESSAGES.offTopic,
  });
  const used = [Q, ans(LONG), say("retry"), ans(LONG), say("retry"), ans(LONG)];
  assert.deepEqual(decide(decision({ intent: "vague", resume_item: "모아뱅크 이체 한도 QA" }), { turns: used, resume: RESUME }), {
    action: "feedback",
    message: "",
  });
});

test("[TC-507] 꼬리질문: 남은 개수가 있고 모델이 골랐을 때만, 빈 문장이면 마무리", () => {
  const turns = [Q, ans(LONG)];
  assert.deepEqual(decide(decision({ action: "followup", message: " 쿠폰 결함을 재현한 방법은요? ", basis: "쿠폰" }), { turns, resume: RESUME }), {
    action: "followup",
    message: "쿠폰 결함을 재현한 방법은요?",
    basis: "쿠폰",
  });
  assert.equal(decide(decision({ action: "followup", message: "  " }), { turns, resume: RESUME }).action, "feedback");
  const full = [Q, ans(LONG), say("followup"), ans(LONG), say("followup"), ans(LONG)];
  assert.equal(decide(decision({ action: "followup", message: "또 질문" }), { turns: full, resume: RESUME }).action, "feedback");
});

test("[TC-511] 이력서 항목의 번호 머리(\"활동 2:\")는 떼고 말한다", () => {
  assert.equal(vagueMessage("활동 2: 학회 캠페인 기획"), vagueMessage("학회 캠페인 기획"));
  assert.match(vagueMessage("사례 1. 이체 한도 결함"), /'이체 한도 결함' 경험/);
  assert.match(vagueMessage("무대티켓 백엔드 개발자"), /'무대티켓 백엔드 개발자' 경험/);
});
