"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ErrorBox, FieldHint, Loading, Panel, fieldClass } from "@/components/ui";
import { errorMessage, postJson } from "@/lib/client-api";
import { formatNumber } from "@/lib/limits";
import { MAX_ANSWER_CHARS, MAX_FOLLOWUPS, type InterviewResponse, type InterviewTurn } from "@/lib/interview";
import type { InterviewRecord } from "@/lib/export";
import type { Draft } from "@/lib/flow-types";

type Props = {
  drafts: Draft[];
  resume: string;
  posting: string;
  demoMode: boolean;
  onRecord: (record: InterviewRecord) => void;
  /** 면접을 마친 뒤 결과 정리 단계로 */
  onGoExport?: () => void;
  /** 샘플로 체험할 때만: 면접 답 칸을 가상 인물의 경험으로 채우는 버튼 (발표·시연용으로 끝까지 빠르게) */
  sampleAnswer?: string | null;
};

/** 가상 인물의 경험 답변("- [제목] 상황: … / 내가 한 일: … / 결과: …")을 말하는 듯한 짧은 답 여러 개로 나눈다 */
function toSampleAnswers(text: string): string[] {
  const items = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) =>
      l
        .replace(/^-\s*/, "")
        .replace(/^\[[^\]]+\]\s*/, "")
        .replace(/(상황|내가 한 일|결과)\s*:\s*/g, "")
        .replace(/\s*\/\s*/g, " ")
        .trim(),
    )
    .filter(Boolean);
  return items.length ? items : [text.trim()];
}

type Phase = "ready" | "running" | "done";

/** 텍스트 모의면접: 질문 → 내 답 → 꼬리질문(최대 2개) → 질문별 피드백 (TC-501~510) */
export default function MockInterview({ drafts, resume, posting, demoMode, onRecord, onGoExport, sampleAnswer }: Props) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [queue, setQueue] = useState<Draft[]>([]);
  const [index, setIndex] = useState(0);
  const [turns, setTurns] = useState<InterviewTurn[]>([]);
  const [finished, setFinished] = useState(false);
  const [feedback, setFeedback] = useState<InterviewRecord["feedback"]>(null);
  const [input, setInput] = useState("");
  const [triedSend, setTriedSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  const [sampleIndex, setSampleIndex] = useState(0);
  const sampleAnswers = sampleAnswer ? toSampleAnswers(sampleAnswer) : [];
  const logEnd = useRef<HTMLLIElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const current = queue[index];
  const followups = turns.filter((t) => t.kind === "followup").length;
  const empty = input.trim().length === 0;
  const tooLong = input.length > MAX_ANSWER_CHARS;

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length]);

  function startQuestion(list: Draft[], i: number) {
    setIndex(i);
    setTurns([{ role: "interviewer", kind: "question", text: list[i].question.question }]);
    setFinished(false);
    setFeedback(null);
    setInput("");
    setTriedSend(false);
    setError(null);
  }

  function start() {
    const list = [...drafts];
    setQueue(list);
    setDoneCount(0);
    setPhase("running");
    startQuestion(list, 0);
  }

  async function send() {
    setTriedSend(true);
    if (!current || busy || finished || empty || tooLong) return;
    const next: InterviewTurn[] = [...turns, { role: "candidate", kind: "answer", text: input.trim() }];
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<InterviewResponse>("/api/interview", {
        resume,
        posting,
        question: current.question.question,
        questionId: current.question.id,
        draft: current.answer,
        turns: next,
      });
      const kind = res.action === "feedback" ? "closing" : res.action;
      const updated: InterviewTurn[] = [...next, { role: "interviewer", kind, text: res.message }];
      setTurns(updated);
      // 성공했을 때만 입력을 비운다. 실패하면 적은 답이 남아 있어 그대로 다시 보낼 수 있다 (TC-509)
      setInput("");
      setTriedSend(false);
      if (res.action === "feedback") {
        setFinished(true);
        setFeedback(res.feedback);
        setDoneCount((n) => n + 1);
      }
      onRecord({ question: current.question, turns: updated, feedback: res.action === "feedback" ? res.feedback : null });
      if (res.action !== "feedback") inputRef.current?.focus();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    setPhase("done");
    setError(null);
  }

  if (phase === "ready") {
    return (
      <Panel>
        <p className="font-serif text-lg font-semibold">준비한 질문 {drafts.length}개로 면접을 봐요</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[0.9375rem] leading-relaxed text-muted">
          <li>질문마다 꼬리질문이 최대 {MAX_FOLLOWUPS}개 나오고, 끝나면 잘한 점과 보완할 점을 알려 드려요.</li>
          <li>초안은 보지 말고 면접에서 말하듯이 답해 보세요.</li>
          <li>&lsquo;모르겠어요&rsquo;라고 답해도 괜찮아요. 비슷한 경험으로 다시 답할 기회를 드려요.</li>
        </ul>
        {demoMode && <FieldHint>데모 모드에서는 미리 정해 둔 꼬리질문과 피드백이 나와요.</FieldHint>}
        <Button size="lg" onClick={start} className="mt-5">
          모의면접 시작
        </Button>
      </Panel>
    );
  }

  if (phase === "done") {
    return (
      <Panel>
        <p role="status" className="font-serif text-lg font-semibold">
          모의면접을 마쳤어요. 피드백까지 받은 질문 {doneCount}개
        </p>
        <p className="mt-2 text-sm text-muted">대화와 피드백은 결과 정리에서 HTML이나 Markdown으로 저장할 수 있어요.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {onGoExport && <Button onClick={onGoExport}>결과 정리로 가기</Button>}
          <Button variant="secondary" onClick={start}>
            처음부터 다시 하기
          </Button>
        </div>
      </Panel>
    );
  }

  const isLast = index === queue.length - 1;

  return (
    <Panel className="p-0 sm:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3 sm:px-6">
        <p className="text-sm font-semibold" aria-live="polite">
          질문 {index + 1} / {queue.length} · 꼬리질문 {followups} / {MAX_FOLLOWUPS}
        </p>
        {!finished && (
          <Button variant="ghost" onClick={stop} disabled={busy} className="h-8 px-2">
            면접 그만하기
          </Button>
        )}
      </div>

      {/* 면접 대화는 대본처럼: 면접관의 말은 명조, 내 답은 고딕 */}
      <ol role="log" aria-label="면접 대화" className="flex max-h-[32rem] flex-col gap-5 overflow-y-auto px-5 py-6 sm:px-6">
        {turns.map((t, i) => (
          <li key={i} className={t.role === "candidate" ? "pl-4 sm:pl-10" : ""}>
            <span className={`block text-xs font-semibold ${t.role === "candidate" ? "text-accent" : "text-muted"}`}>
              {t.role === "candidate" ? "나" : t.kind === "followup" ? "면접관 · 꼬리질문" : "면접관"}
            </span>
            <p
              className={
                t.role === "candidate"
                  ? "mt-1 border-l-2 border-accent pl-3 text-[0.9375rem] leading-relaxed whitespace-pre-wrap"
                  : "mt-1 font-serif text-[1.0625rem] leading-relaxed font-semibold whitespace-pre-wrap"
              }
            >
              {t.text}
            </p>
          </li>
        ))}
        <li ref={logEnd} aria-hidden />
      </ol>

      <div className="border-t border-line px-5 py-5 sm:px-6">
        {!finished ? (
          <div>
            <label htmlFor="interview-answer" className="block text-sm font-semibold">
              내 답변
            </label>
            <textarea
              id="interview-answer"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
              }}
              rows={4}
              aria-describedby="interview-answer-hint"
              aria-invalid={triedSend && (empty || tooLong)}
              className={`${fieldClass} mt-2`}
              placeholder="면접에서 말하듯이 적어 주세요. (Ctrl+Enter로 보내기)"
            />
            <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
              <FieldHint id="interview-answer-hint" tone={triedSend && (empty || tooLong) ? "error" : "muted"}>
                {triedSend && empty
                  ? "답변을 입력해 주세요."
                  : tooLong
                    ? `${formatNumber(MAX_ANSWER_CHARS)}자 이하로 줄여 주세요.`
                    : `${formatNumber(input.length)} / ${formatNumber(MAX_ANSWER_CHARS)}자`}
              </FieldHint>
              <div className="flex gap-2">
                {sampleAnswer && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setInput(sampleAnswers[sampleIndex % sampleAnswers.length]);
                      setSampleIndex((i) => i + 1);
                    }}
                    disabled={busy}
                  >
                    샘플 답 채우기
                  </Button>
                )}
                <Button onClick={send} disabled={busy}>
                  답변 보내기
                </Button>
              </div>
            </div>
            {busy && <Loading label="면접관이 듣고 있어요…" />}
            {error && <ErrorBox message={error} onRetry={send} />}
          </div>
        ) : (
          <div>
            <div aria-label="질문별 피드백" className="rounded-lg bg-paper px-4 py-4 text-[0.9375rem] leading-relaxed">
              <p className="font-semibold">이 질문 피드백</p>
              {feedback && feedback.good.length > 0 && (
                <>
                  <p className="mt-3 text-sm font-semibold text-ok">잘한 점</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {feedback.good.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </>
              )}
              {feedback && feedback.improve.length > 0 && (
                <>
                  <p className="mt-3 text-sm font-semibold text-danger">보완할 점</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {feedback.improve.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </>
              )}
              {feedback?.tip && (
                <p className="mt-3 border-t border-line pt-3">
                  <b>다음엔</b> {feedback.tip}
                </p>
              )}
              {!feedback && <p className="mt-2">피드백을 받지 못했어요.</p>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {!isLast ? (
                <Button onClick={() => startQuestion(queue, index + 1)}>다음 질문</Button>
              ) : (
                <Button onClick={stop}>면접 마치기</Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
