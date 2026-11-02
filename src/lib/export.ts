import { QUESTION_TYPE_LABEL, type Draft, type Question, type QuestionType } from "@/lib/flow-types";
import type { InterviewFeedback, InterviewTurn } from "@/lib/interview";

/**
 * 결과 내보내기 (TC-601~605): HTML 파일과 Notion에 붙여넣을 Markdown.
 * 화면 상태만으로 만들고 서버를 거치지 않는다. 이력서 원문·가린 이력서는 넣지 않는다.
 */

export type InterviewRecord = { question: Question; turns: InterviewTurn[]; feedback: InterviewFeedback | null };

export type ExportData = { date: string; questions: Question[]; drafts: Draft[]; interviews: InterviewRecord[] };

const TYPES: QuestionType[] = ["resume", "role", "posting"];

const isPrepared = (d: ExportData, q: Question) =>
  d.drafts.some((x) => x.question.id === q.id) || d.interviews.some((x) => x.question.id === q.id);

/** 준비한 질문(초안·면접 기록 있음)만 유형별로. 준비하지 않은 질문은 맨 아래 한 목록으로 (unprepared) */
function sections(d: ExportData) {
  return TYPES.map((type) => ({
    type,
    label: QUESTION_TYPE_LABEL[type],
    items: d.questions
      .filter((q) => q.type === type && isPrepared(d, q))
      .map((q) => ({
        question: q,
        draft: d.drafts.find((x) => x.question.id === q.id),
        interview: d.interviews.find((x) => x.question.id === q.id),
      })),
  })).filter((s) => s.items.length > 0);
}

function unprepared(d: ExportData): Question[] {
  return TYPES.flatMap((type) => d.questions.filter((q) => q.type === type && !isPrepared(d, q)));
}

const UNPREPARED_TITLE = "아직 준비하지 않은 질문";

const speaker = (t: InterviewTurn) => (t.role === "interviewer" ? "면접관" : "나");

// ---------- Markdown (Notion에 붙여넣으면 제목·목록·인용·토글 없이도 구조가 유지되는 문법만 사용) ----------

/** 줄 맨 앞의 #, -, > 같은 기호가 Markdown 문법으로 읽히지 않게 막는다 */
function mdText(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => line.replace(/^(\s*)([#>*+-]|\d+\.)(\s)/, "$1\\$2$3"))
    .join("\n");
}

const quote = (text: string) => mdText(text).split("\n").map((l) => `> ${l}`).join("\n");

export function toMarkdown(d: ExportData): string {
  const out: string[] = [`# 면접 준비 노트 (${d.date})`, ""];
  out.push(`예상 질문 ${d.questions.length}개 · 답변 초안 ${d.drafts.length}개 · 모의면접 ${d.interviews.length}문항`, "");
  for (const s of sections(d)) {
    out.push(`## ${s.label}`, "");
    for (const { question, draft, interview } of s.items) {
      out.push(`### Q. ${mdText(question.question)}`, "");
      if (draft) {
        out.push("**내 경험**", "", quote(draft.experience), "", "**답변 초안**", "", mdText(draft.answer), "");
      }
      if (interview) {
        out.push("**모의면접**", "");
        for (const t of interview.turns) out.push(`- **${speaker(t)}**: ${mdText(t.text).replace(/\n/g, " ")}`);
        out.push("");
        if (interview.feedback) {
          const f = interview.feedback;
          out.push("**피드백**", "");
          for (const g of f.good) out.push(`- 잘한 점: ${mdText(g)}`);
          for (const i of f.improve) out.push(`- 보완할 점: ${mdText(i)}`);
          if (f.tip) out.push(`- 다음엔: ${mdText(f.tip)}`);
          out.push("");
        }
      }
    }
  }
  const rest = unprepared(d);
  if (rest.length) {
    out.push(`## ${UNPREPARED_TITLE} (${rest.length}개)`, "");
    for (const q of rest) out.push(`- [${QUESTION_TYPE_LABEL[q.type]}] ${mdText(q.question).replace(/\n/g, " ")}`);
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ---------- HTML (한 파일로 열리고 인쇄해도 보기 좋게) ----------

/** 사용자·AI가 쓴 글은 모두 이스케이프해서 태그가 실행되지 않게 한다 (TC-604) */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const para = (text: string) =>
  escapeHtml(text.trim())
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

const list = (cls: string, label: string, items: string[]) =>
  items.length ? `<div class="${cls}"><b>${label}</b><ul>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>` : "";

export function toHtml(d: ExportData): string {
  const body = sections(d)
    .map(
      (s) => `<section><h2>${escapeHtml(s.label)}</h2>${s.items
        .map(({ question, draft, interview }) => {
          let html = `<article><h3>Q. ${escapeHtml(question.question)}</h3>`;
          if (draft) {
            html += `<h4>내 경험</h4><blockquote>${para(draft.experience)}</blockquote><h4>답변 초안</h4><div class="answer">${para(draft.answer)}</div>`;
          }
          if (interview) {
            html += `<h4>모의면접</h4><ol class="chat">${interview.turns
              .map((t) => `<li class="${t.role}"><b>${speaker(t)}</b> ${escapeHtml(t.text)}</li>`)
              .join("")}</ol>`;
            const f = interview.feedback;
            if (f) {
              html += `<div class="feedback"><h4>피드백</h4>${list("good", "잘한 점", f.good)}${list("improve", "보완할 점", f.improve)}${
                f.tip ? `<p><b>다음엔</b> ${escapeHtml(f.tip)}</p>` : ""
              }</div>`;
            }
          }
          return html + "</article>";
        })
        .join("")}</section>`,
    )
    .join("");
  const rest = unprepared(d);
  const restHtml = rest.length
    ? `<section class="rest"><h2>${UNPREPARED_TITLE} (${rest.length}개)</h2><ul>${rest
        .map((q) => `<li><span class="tag">${escapeHtml(QUESTION_TYPE_LABEL[q.type])}</span> ${escapeHtml(q.question)}</li>`)
        .join("")}</ul></section>`
    : "";

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>면접 준비 노트 (${escapeHtml(d.date)})</title>
<style>
  :root { --fg:#1c2433; --muted:#5b6573; --line:#d9dee6; --accent:#2457d6; --soft:#f3f5f8; --warn:#f3f5f8; --marker:#ffe58a; }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px 16px; font:16px/1.7 "Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; color:var(--fg); background:#fff; word-break:keep-all; }
  h1, h3, .chat .interviewer { font-family:"Noto Serif KR", "Apple Myungjo", "Batang", serif; }
  main { max-width:760px; margin:0 auto; }
  h1 { font-size:26px; margin:0 0 4px; } .summary { color:var(--muted); margin:0 0 32px; }
  h2 { font-size:15px; color:var(--muted); border-bottom:1px solid var(--line); padding-bottom:6px; margin:40px 0 16px; }
  h3 { font-size:17px; margin:0 0 12px; } h4 { font-size:14px; margin:18px 0 6px; }
  article { border:1px solid var(--line); border-radius:12px; padding:20px; margin:0 0 16px; break-inside:avoid; }
  blockquote { margin:0; padding:8px 14px; border-left:3px solid var(--marker); color:#444; }
  .answer { background:var(--soft); border-radius:8px; padding:10px 14px; } p { margin:0 0 8px; } p:last-child { margin:0; }
  .chat { list-style:none; padding:0; margin:0; } .chat li { padding:6px 0; border-bottom:1px dashed var(--line); }
  .chat li b { display:block; color:var(--muted); font-size:12px; font-family:-apple-system, "Malgun Gothic", sans-serif; } .chat .candidate { padding-left:24px; } .chat .candidate b { color:var(--accent); }
  .feedback { background:var(--warn); border-radius:8px; padding:4px 14px 12px; margin-top:12px; } .feedback ul { margin:4px 0 8px; padding-left:20px; }
  .rest ul { padding-left:0; list-style:none; } .rest li { padding:8px 0; border-bottom:1px solid var(--line); }
  .tag { display:inline-block; font-size:12px; color:var(--muted); border:1px solid var(--line); border-radius:4px; padding:0 6px; margin-right:6px; }
  @media print { body { padding:0; } article { border-color:#ccc; } }
</style>
</head>
<body>
<main>
<h1>면접 준비 노트</h1>
<p class="summary">${escapeHtml(d.date)} · 예상 질문 ${d.questions.length}개 · 답변 초안 ${d.drafts.length}개 · 모의면접 ${d.interviews.length}문항</p>
${body}
${restHtml}
</main>
</body>
</html>
`;
}

/** 파일 이름은 영문으로 둔다. 한글 이름은 브라우저·환경에 따라 "download"로 바뀌어 저장되는 경우가 있음 (E2E에서 확인) */
export function exportFileName(date: string): string {
  return `my-own-answer_${date}.html`;
}
