"use client";

import { useState } from "react";
import { Button, FieldHint, Panel } from "@/components/ui";
import { exportFileName, toHtml, toMarkdown, type ExportData } from "@/lib/export";
import { QUESTION_TYPE_LABEL } from "@/lib/flow-types";

/** 결과 정리: HTML 파일 저장, Notion용 Markdown 복사 (TC-601~605) */
export default function ExportPanel({ data }: { data: Omit<ExportData, "date"> }) {
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const ready = data.drafts.length > 0;

  const withDate = (): ExportData => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return { ...data, date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
  };

  function saveHtml() {
    const d = withDate();
    const url = URL.createObjectURL(new Blob([toHtml(d)], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName(d.date);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`${a.download} 파일을 저장했어요.`);
  }

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(toMarkdown(withDate()));
      setCopied(true);
      setNotice("Notion 페이지에 붙여넣으면 제목·목록 구조 그대로 들어가요.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setNotice("복사하지 못했습니다. HTML로 저장한 뒤 내용을 복사해 주세요.");
    }
  }

  const prepared = data.questions.filter(
    (q) => data.drafts.some((d) => d.question.id === q.id) || data.interviews.some((x) => x.question.id === q.id),
  );

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <Panel title="문서에 들어가는 질문">
        {prepared.length === 0 ? (
          <p className="text-sm text-muted">아직 준비한 질문이 없어요.</p>
        ) : (
          <ul className="divide-y divide-line">
            {prepared.map((q) => {
              const interview = data.interviews.find((x) => x.question.id === q.id);
              return (
                <li key={q.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-xs font-semibold text-muted">{QUESTION_TYPE_LABEL[q.type]}</p>
                  <p className="mt-1 font-serif text-[0.9375rem] leading-relaxed font-semibold">{q.question}</p>
                  <p className="mt-1 text-[0.8125rem] text-muted">
                    {data.drafts.some((d) => d.question.id === q.id) ? "답변 초안" : "초안 없음"}
                    {interview && (interview.feedback ? " · 모의면접 피드백" : " · 모의면접 대화")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {data.questions.length > prepared.length && (
          <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] text-muted">
            준비하지 않은 질문 {data.questions.length - prepared.length}개는 문서 맨 아래에 목록으로 들어가요.
          </p>
        )}
      </Panel>

      <Panel className="lg:sticky lg:top-28">
        <p className="font-serif text-lg font-semibold">면접 준비 노트</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          예상 질문 {data.questions.length}개 · 답변 초안 {data.drafts.length}개 · 모의면접 {data.interviews.length}문항을 한 문서로 정리해요. 이력서
          내용은 넣지 않아요.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Button size="lg" onClick={saveHtml} disabled={!ready}>
            HTML로 저장
          </Button>
          <Button variant="secondary" size="lg" onClick={copyMarkdown} disabled={!ready}>
            {copied ? "복사했어요" : "Notion용 Markdown 복사"}
          </Button>
        </div>
        {!ready && <FieldHint>답변 초안을 하나 이상 만들어 주세요. 초안이 있어야 저장할 수 있어요.</FieldHint>}
        {notice && (
          <p role="status" className="mt-3 text-sm text-muted">
            {notice}
          </p>
        )}
      </Panel>
    </div>
  );
}
