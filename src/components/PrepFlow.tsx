"use client";

import { useRef, useState } from "react";
import { Button, ErrorBox, FieldHint, Loading, Panel, StepHeader, fieldClass } from "@/components/ui";
import MockInterview from "@/components/MockInterview";
import ExportPanel from "@/components/ExportPanel";
import type { InterviewRecord } from "@/lib/export";
import { ClientError, errorMessage, getJson, postForm, postJson } from "@/lib/client-api";
import { pdfFileToText, pdfToPageImages } from "@/lib/pdf-client";
import { prepareScreenshots, validateScreenshots } from "@/lib/image";
import { ACCEPTED_EXTENSIONS, LIMITS, extensionOf, formatNumber, isAcceptedFile, tooLargeMessage } from "@/lib/limits";
import {
  QUESTION_TYPE_LABEL,
  type AnswerResponse,
  type Draft,
  type PostingResponse,
  type ExperienceResponse,
  type Question,
  type QuestionType,
  type QuestionsResponse,
  type ResumeResponse,
  type ResumeStructureResponse,
  type SampleResponse,
} from "@/lib/flow-types";

type Step = "input" | "questions" | "interview" | "export";

const STEPS: { id: Step; label: string }[] = [
  { id: "input", label: "준비" },
  { id: "questions", label: "질문과 답변" },
  { id: "interview", label: "모의면접" },
  { id: "export", label: "결과 정리" },
];

const MASK_LABEL: Record<keyof ResumeResponse["counts"], string> = {
  name: "이름",
  birth: "생년월일",
  phone: "전화번호",
  email: "이메일",
  url: "링크",
  custom: "직접 지정한 단어",
};

const TYPES: QuestionType[] = ["resume", "role", "posting"];

export default function PrepFlow({ demoMode }: { demoMode: boolean }) {
  const [step, setStep] = useState<Step>("input");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; retry?: () => void } | null>(null);

  // 1. 준비
  const [resume, setResume] = useState<ResumeResponse | null>(null);
  const [resumeMode, setResumeMode] = useState<"file" | "paste">("file");
  const [pasted, setPasted] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  // 가릴 단어를 추가할 때 다시 가리기 위해 원문을 이 브라우저 안에만 둔다 (서버·저장소에 남기지 않음)
  const rawResume = useRef<{ text: string; fileName?: string } | null>(null);
  const [maskWords, setMaskWords] = useState("");
  // 이력서 정리 (TC-119~122): 가린 이력서를 정해진 섹션의 MD로 정리, 사용자가 확인·수정
  const [structure, setStructure] = useState<ResumeStructureResponse | null>(null);
  const [structuredText, setStructuredText] = useState("");
  const [useRawResume, setUseRawResume] = useState(false);
  const [structuring, setStructuring] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [posting, setPosting] = useState("");
  /** 샘플 이력서를 쓸 때만: 가상 인물의 경험 답변. 실제 키로도 "샘플 경험 채우기"로 바로 초안을 만들어 볼 수 있다 */
  const [sampleExperience, setSampleExperience] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const postingPdfRef = useRef<HTMLInputElement>(null);
  const postingImageRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [postingNotice, setPostingNotice] = useState<string | null>(null);
  const [postingError, setPostingError] = useState<{ message: string; retry?: () => void } | null>(null);

  // 2. 질문과 답변
  const [questions, setQuestions] = useState<Question[]>([]);
  const [demoIds, setDemoIds] = useState<string[] | undefined>();
  const [selected, setSelected] = useState<Question | null>(null);
  const [exp, setExp] = useState<ExperienceResponse | null>(null);
  const [experience, setExperience] = useState("");
  const [triedSubmit, setTriedSubmit] = useState(false);
  /** 초안이 있는 질문에서 "경험 고쳐서 다시 만들기"를 누른 상태 */
  const [rewriting, setRewriting] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [copied, setCopied] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  // 3. 모의면접 · 4. 결과 정리
  const [interviews, setInterviews] = useState<InterviewRecord[]>([]);
  const [interviewKey, setInterviewKey] = useState(0);
  const recordInterview = (r: InterviewRecord) =>
    setInterviews((prev) => [...prev.filter((x) => x.question.id !== r.question.id), r]);

  const postingTooLong = posting.length > LIMITS.postingChars;
  const canGenerate =
    !!resume && posting.trim().length > 0 && !postingTooLong && !busy && !importing && !structuring;

  /** 뒤 단계(질문·경험·답변)에 보내는 이력서: 정리된 MD(사용자가 고친 것 포함) 또는 가린 원문 */
  const resumeForAI = !resume ? "" : useRawResume || !structuredText.trim() ? resume.text : structuredText;

  const reachable: Record<Step, boolean> = {
    input: true,
    questions: questions.length > 0,
    interview: drafts.length > 0,
    export: questions.length > 0,
  };

  function goTo(next: Step) {
    if (!reachable[next]) return;
    setStep(next);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- 1-1. 이력서 정리 ----------

  async function structureResume(masked: ResumeResponse) {
    setStructuring(true);
    setStructureError(null);
    setStructure(null);
    setStructuredText("");
    try {
      const res = await postJson<ResumeStructureResponse>("/api/resume/structure", { text: masked.text });
      setStructure(res);
      setStructuredText(res.markdown);
    } catch (e) {
      setStructureError(`${errorMessage(e)} 정리하지 못하면 가린 원문을 그대로 씁니다.`);
    } finally {
      setStructuring(false);
    }
  }

  function acceptResume(res: ResumeResponse) {
    setResume(res);
    setUseRawResume(false);
    void structureResume(res);
  }

  async function run<T>(label: string, task: () => Promise<T>, retry: () => void): Promise<T | undefined> {
    setBusy(label);
    setError(null);
    try {
      return await task();
    } catch (e) {
      setError({ message: errorMessage(e), retry });
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  // ---------- 1. 이력서 ----------

  async function handleFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    // 서버에 보내기 전에 형식·용량을 먼저 막는다 (TC-104, TC-105)
    if (!isAcceptedFile(file.name)) {
      setFileError(`지원하지 않는 형식입니다. ${ACCEPTED_EXTENSIONS.join(", ")} 파일만 올릴 수 있어요.`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (file.size > LIMITS.resumeFileBytes) {
      setFileError(tooLargeMessage(LIMITS.resumeFileLabel));
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    // 원본 파일은 서버로 보내지 않고, 브라우저에서 글자만 뽑아 보낸다 (용량 제한·개인정보)
    const res = await run(
      "이력서에서 글자를 뽑고 개인정보를 가리는 중…",
      async () => {
        const text = extensionOf(file.name) === ".pdf" ? await pdfFileToText(file) : await file.text();
        if (!text.trim()) {
          throw new ClientError(
            "PDF_NO_TEXT",
            "이 PDF에는 글자가 없고 그림만 있어요. 'Microsoft Print to PDF'로 저장했다면 원본 파일을 올리거나, 이력서 내용을 직접 붙여넣어 주세요.",
          );
        }
        rawResume.current = { text, fileName: file.name };
        setSampleExperience(null);
        return maskResume();
      },
      () => handleFile(file),
    );
    if (res) acceptResume(res);
    else if (fileRef.current) fileRef.current.value = "";
  }

  /** 이 브라우저에 있는 원문을 서버에서 가린다. 가릴 단어를 추가하면 다시 부른다 */
  function maskResume(): Promise<ResumeResponse> {
    const src = rawResume.current!;
    const words = maskWords
      .split(/[,\n]/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2)
      .slice(0, LIMITS.maskWords);
    return postJson<ResumeResponse>("/api/resume", { text: src.text, fileName: src.fileName, words });
  }

  async function applyMaskWords() {
    if (!rawResume.current) return;
    const res = await run("다시 가리는 중…", maskResume, applyMaskWords);
    if (res) acceptResume({ ...res, fileName: res.fileName ?? resume?.fileName });
  }

  async function handlePaste() {
    rawResume.current = { text: pasted };
    setSampleExperience(null);
    const res = await run("개인정보를 가리는 중…", maskResume, handlePaste);
    if (res) acceptResume({ ...res, fileName: "붙여넣은 이력서" });
  }

  async function loadSample() {
    const res = await run("샘플을 불러오는 중…", () => getJson<SampleResponse>("/api/sample"), loadSample);
    if (res) {
      rawResume.current = { text: res.rawResume, fileName: res.resume.fileName };
      acceptResume(res.resume);
      setPosting(res.posting);
      setSampleExperience(res.sampleExperience || null);
      setFileError(null);
    }
  }

  function resetResume() {
    setResume(null);
    setSampleExperience(null);
    setPasted("");
    setMaskWords("");
    rawResume.current = null;
    setStructure(null);
    setStructuredText("");
    setStructureError(null);
    setUseRawResume(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  // ---------- 1-2. 복사가 막힌 공고 가져오기 (TC-108~112) ----------

  type Imported = PostingResponse & { note?: string };

  async function importPosting(label: string, task: () => Promise<Imported>, retry: () => void) {
    setImporting(label);
    setPostingError(null);
    setPostingNotice(null);
    try {
      const res = await task();
      setPosting(res.text);
      setPostingNotice(
        res.note ??
          (res.source === "pdf"
            ? "PDF에서 가져온 공고예요. 빠진 부분이 없는지 확인하고, 필요하면 직접 고친 뒤 질문을 만들어 주세요."
            : "스크린샷에서 AI가 읽은 공고예요. 잘못 읽은 글자나 빠진 줄이 없는지 꼭 확인해 주세요."),
      );
    } catch (e) {
      setPostingError({ message: errorMessage(e), retry });
    } finally {
      setImporting(null);
      if (postingPdfRef.current) postingPdfRef.current.value = "";
      if (postingImageRef.current) postingImageRef.current.value = "";
    }
  }

  function handlePostingPdf(file: File | undefined) {
    setPostingError(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setPostingError({ message: "PDF 파일만 올릴 수 있어요. 이미지라면 '스크린샷 올리기'를 써 주세요." });
      if (postingPdfRef.current) postingPdfRef.current.value = "";
      return;
    }
    if (file.size > LIMITS.fileBytes) {
      setPostingError({ message: tooLargeMessage() });
      if (postingPdfRef.current) postingPdfRef.current.value = "";
      return;
    }
    const form = new FormData();
    form.append("file", file);
    importPosting(
      "PDF에서 공고 글자를 꺼내는 중…",
      async (): Promise<Imported> => {
        try {
          return await postForm<PostingResponse>("/api/posting", form);
        } catch (e) {
          // 글자 층이 없는 PDF (예: 'Microsoft Print to PDF'로 저장) → 페이지를 이미지로 바꿔 AI가 읽는다 (TC-115)
          if (!(e instanceof ClientError && e.code === "PDF_NEEDS_OCR")) throw e;
          setImporting("PDF에 글자가 없어서 페이지를 이미지로 읽는 중… (30초 정도 걸려요)");
          const { images, totalPages } = await pdfToPageImages(file);
          const res = await postImages(images);
          const skipped = totalPages > images.length ? ` 앞 ${images.length}쪽만 읽었으니 뒷부분은 직접 붙여넣어 주세요.` : "";
          return {
            ...res,
            note: `PDF에 글자가 없어서(그림으로 저장된 PDF) AI가 페이지 이미지를 읽었어요. 잘못 읽은 글자나 빠진 줄이 없는지 꼭 확인해 주세요.${skipped} 다음에는 인쇄 창에서 'PDF로 저장'을 고르면 더 정확해요.`,
          };
        }
      },
      () => handlePostingPdf(file),
    );
  }

  async function postImages(files: File[]): Promise<PostingResponse> {
    const parts = await prepareScreenshots(files);
    const form = new FormData();
    parts.forEach((b, i) => form.append("images", b, `part-${i + 1}.jpg`));
    return postForm<PostingResponse>("/api/posting", form);
  }

  function handlePostingImages(files: File[]) {
    setPostingError(null);
    if (files.length === 0) return;
    const invalid = validateScreenshots(files);
    if (invalid) {
      setPostingError({ message: invalid });
      if (postingImageRef.current) postingImageRef.current.value = "";
      return;
    }
    importPosting(
      `스크린샷 ${files.length}장에서 공고를 읽는 중… (20초 정도 걸려요)`,
      () => postImages(files),
      () => handlePostingImages(files),
    );
  }

  // ---------- 2. 질문 ----------

  async function generateQuestions() {
    if (!resume) return;
    const res = await run(
      "예상 질문을 만드는 중… (10초 정도 걸려요)",
      () => postJson<QuestionsResponse>("/api/questions", { resume: resumeForAI, posting }),
      generateQuestions,
    );
    if (res) {
      setQuestions(res.questions);
      setDemoIds(res.demoQuestionIds);
      setSelected(null);
      setExp(null);
      setDrafts([]);
      setInterviews([]);
      setInterviewKey((k) => k + 1);
      setStep("questions");
      window.scrollTo({ top: 0 });
    }
  }

  // ---------- 2-1. 경험 ----------

  const draftOf = (q: Question | null) => (q ? drafts.find((d) => d.question.id === q.id) : undefined);
  const currentDraft = draftOf(selected);

  function showDetail() {
    // 좁은 화면에서는 질문 목록 아래에 있는 작업 영역으로 내려 준다
    requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 1023px)").matches) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function pickQuestion(q: Question) {
    setSelected(q);
    setTriedSubmit(false);
    setRewriting(false);
    setError(null);
    const draft = draftOf(q);
    // 이미 초안이 있으면 다시 묻지 않고 초안을 보여 준다
    if (draft) {
      setExp(draft.exp ?? null);
      setExperience(draft.experience);
      showDetail();
      return;
    }
    setExp(null);
    setExperience("");
    showDetail();
    const res = await run(
      "이 질문에 쓸 경험을 묻는 중…",
      () => postJson<ExperienceResponse>("/api/experience", { resume: resumeForAI, posting, question: q.question, questionId: q.id }),
      () => pickQuestion(q),
    );
    if (res) setExp(res);
  }

  async function startRewrite() {
    if (!selected || !currentDraft) return;
    setRewriting(true);
    setTriedSubmit(false);
    setExperience(currentDraft.experience);
    if (!currentDraft.exp) {
      const res = await run(
        "이 질문에 쓸 경험을 묻는 중…",
        () => postJson<ExperienceResponse>("/api/experience", { resume: resumeForAI, posting, question: selected.question, questionId: selected.id }),
        startRewrite,
      );
      if (res) setExp(res);
    }
  }

  // ---------- 2-2. 답변 초안 ----------

  const experienceEmpty = experience.trim().length === 0;
  const experienceShort = !experienceEmpty && experience.trim().length < LIMITS.experienceMinChars;
  const experienceTooLong = experience.length > LIMITS.experienceChars;

  async function generateAnswer() {
    setTriedSubmit(true);
    if (!selected || experienceEmpty || experienceShort || experienceTooLong) return;
    const q = selected;
    const res = await run(
      "내 경험으로 답변 초안을 쓰는 중…",
      () =>
        postJson<AnswerResponse>("/api/answer", {
          resume: resumeForAI,
          posting,
          question: q.question,
          questionId: q.id,
          experience,
        }),
      generateAnswer,
    );
    if (res) {
      setRewriting(false);
      setDrafts((prev) => [
        ...prev.filter((d) => d.question.id !== q.id),
        { question: q, experience, answer: res.answer, exp: exp ?? undefined },
      ]);
    }
  }

  function editAnswer(text: string) {
    if (!selected) return;
    setDrafts((prev) => prev.map((d) => (d.question.id === selected.id ? { ...d, answer: text } : d)));
  }

  async function copyAnswer() {
    if (!currentDraft) return;
    try {
      await navigator.clipboard.writeText(currentDraft.answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError({ message: "복사하지 못했습니다. 직접 선택해서 복사해 주세요." });
    }
  }

  const grouped = TYPES.map((type) => ({ type, items: questions.filter((q) => q.type === type) }));
  const showDraft = !!currentDraft && !rewriting;
  const showExperienceForm = !!selected && !!exp && !showDraft;

  return (
    <div className="min-h-dvh">
      {/* 머리글 + 진행 단계 */}
      <header className="z-20 border-b sm:sticky sm:top-0 border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <div className="flex items-baseline gap-3">
            <h1 className="font-serif text-lg font-semibold sm:text-xl tracking-[-0.02em]">my-own-answer</h1>
            <p className="hidden text-sm text-muted sm:block">내 경험으로만 쓰는 면접 답변</p>
          </div>
          <nav aria-label="진행 단계" className="-mx-1 w-full overflow-x-auto sm:mx-0 sm:w-auto">
            <ol className="flex min-w-max items-center gap-1">
              {STEPS.map((s, i) => {
                const current = step === s.id;
                const enabled = reachable[s.id];
                return (
                  <li key={s.id} className="flex items-center">
                    {i > 0 && <span aria-hidden className="mx-0.5 h-px w-2 bg-line sm:mx-1 sm:w-4" />}
                    <button
                      type="button"
                      onClick={() => goTo(s.id)}
                      disabled={!enabled}
                      aria-current={current ? "step" : undefined}
                      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[0.8125rem] transition-colors sm:gap-2 sm:px-3 sm:text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                        current ? "bg-ink font-semibold text-surface" : "text-ink hover:bg-paper"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`flex h-5 w-5 items-center justify-center rounded-full text-[0.6875rem] font-semibold ${
                          current ? "bg-surface text-ink" : "border border-line"
                        }`}
                      >
                        {i + 1}
                      </span>
                      {s.label}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
        {demoMode && (
          <p className="border-t border-line bg-warn-soft px-4 py-2 text-[0.8125rem] text-ink sm:px-6 sm:text-center">
            데모 모드로 실행 중입니다.<span className="hidden sm:inline"> 실제로 생성하려면 <code className="font-mono">.env.local</code>에 OpenAI API 키를 넣어 주세요.</span> 지금은
            &lsquo;샘플로 체험하기&rsquo;로 흐름을 볼 수 있어요.
          </p>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-8 pb-28 sm:px-6 sm:pt-10">
        {/* 1. 준비 */}
        <section id="step-input" aria-labelledby="step-input-title" hidden={step !== "input"}>
          <StepHeader
            id="step-input"
            title="이력서와 채용공고"
            description="이력서의 이름·생년월일·연락처·링크는 AI에 보내기 전에 가려지고, 이력서 형식과 상관없이 같은 섹션으로 정리됩니다."
          />

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <Panel title="이력서">
              {!resume ? (
                <div>
                  <div role="tablist" aria-label="이력서 입력 방법" className="mb-4 inline-flex rounded-lg border border-line p-1">
                    {(["file", "paste"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={resumeMode === m}
                        onClick={() => setResumeMode(m)}
                        className={`rounded-md px-3.5 py-1.5 text-sm font-medium ${resumeMode === m ? "bg-ink text-surface" : "text-muted hover:text-ink"}`}
                      >
                        {m === "file" ? "파일 올리기" : "직접 붙여넣기"}
                      </button>
                    ))}
                  </div>
                  {resumeMode === "file" ? (
                    <div>
                      <label
                        htmlFor="resume-file"
                        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-line bg-paper px-4 py-10 text-center hover:border-accent ${busy ? "pointer-events-none opacity-50" : ""}`}
                      >
                        <span className="text-[0.9375rem] font-semibold">이력서 파일 (PDF, TXT, MD · {LIMITS.resumeFileLabel} 이하)</span>
                        <span className="mt-1 text-sm text-muted">눌러서 파일을 고르세요</span>
                      </label>
                      <input
                        id="resume-file"
                        ref={fileRef}
                        type="file"
                        accept={ACCEPTED_EXTENSIONS.join(",")}
                        aria-describedby={fileError ? "resume-file-error" : undefined}
                        onChange={(e) => handleFile(e.target.files?.[0])}
                        disabled={!!busy}
                        className="sr-only"
                      />
                      {fileError && (
                        <FieldHint id="resume-file-error" tone="error">
                          {fileError}
                        </FieldHint>
                      )}
                      <FieldHint>파일은 이 브라우저 안에서 글자만 뽑아 쓰고, 원본 파일은 서버로 보내지 않아요.</FieldHint>
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="resume-text" className="sr-only">
                        이력서 내용
                      </label>
                      <textarea
                        id="resume-text"
                        value={pasted}
                        onChange={(e) => setPasted(e.target.value)}
                        rows={10}
                        className={fieldClass}
                        placeholder="이력서 내용을 붙여넣어 주세요."
                      />
                      <Button variant="secondary" onClick={handlePaste} disabled={!pasted.trim() || !!busy} className="mt-3">
                        이력서로 사용하기
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[0.9375rem] font-semibold">
                      {resume.fileName ?? "이력서"} <span className="font-normal text-muted">{formatNumber(resume.chars)}자</span>
                    </p>
                    <Button variant="ghost" onClick={resetResume} disabled={!!busy} className="h-8 px-2">
                      이력서 바꾸기
                    </Button>
                  </div>
                  <p className="mt-3 flex flex-wrap gap-1.5 text-[0.8125rem]" aria-label="가린 개인정보">
                    {(Object.keys(MASK_LABEL) as (keyof typeof MASK_LABEL)[])
                      .filter((k) => resume.counts[k] > 0)
                      .map((k) => (
                        <span key={k} className="rounded-md bg-ok-soft px-2 py-0.5 font-medium text-ok">
                          {MASK_LABEL[k]} {resume.counts[k]}개 가림
                        </span>
                      ))}
                    {Object.values(resume.counts).every((n) => n === 0) && (
                      <span className="text-muted">가릴 개인정보를 찾지 못했어요. 아래에서 AI에 보내는 내용을 확인해 주세요.</span>
                    )}
                  </p>
                  <div className="mt-4">
                    <label htmlFor="mask-words" className="block text-sm font-medium">
                      더 가릴 단어 <span className="font-normal text-muted">(팀원 이름, 사내 프로젝트명 등 · 쉼표로 구분)</span>
                    </label>
                    <div className="mt-1.5 flex gap-2">
                      <input
                        id="mask-words"
                        value={maskWords}
                        onChange={(e) => setMaskWords(e.target.value)}
                        placeholder="예: 홍길동, 사내 결제 프로젝트"
                        className={`${fieldClass} h-10 py-0`}
                      />
                      <Button variant="secondary" onClick={applyMaskWords} disabled={!!busy || !rawResume.current}>
                        가리기
                      </Button>
                    </div>
                  </div>
                  <div className="mt-5 border-t border-line pt-4" aria-label="이력서 정리">
                    <p className="text-sm font-semibold">정리된 이력서</p>
                    {structuring && <Loading label="이력서를 섹션별로 정리하는 중… (10~20초)" />}
                    {structureError && <ErrorBox message={structureError} onRetry={() => resume && structureResume(resume)} />}
                    {structure && !structure.structured && <FieldHint>데모 모드라 정리를 건너뛰고 가린 원문을 그대로 써요.</FieldHint>}
                    {structure?.structured && (
                      <>
                        <FieldHint>
                          형식이 달라도 경력·프로젝트·트러블슈팅·기술 스택·교육·자격증·수상으로 정리했어요. 빠지거나 잘못 옮긴 부분은 직접
                          고쳐 주세요. 고친 내용이 그대로 쓰여요.
                        </FieldHint>
                        <p
                          role="status"
                          className={`mt-2 rounded-md px-3 py-2 text-[0.8125rem] ${
                            structure.fidelity.missing.length ? "bg-warn-soft text-ink" : "bg-ok-soft text-ok"
                          }`}
                        >
                          수치 보존 {Math.round(structure.fidelity.ratio * 100)}% ({structure.fidelity.total - structure.fidelity.missing.length}/
                          {structure.fidelity.total})
                          {structure.fidelity.missing.length > 0 &&
                            ` · 원문에 없는 숫자: ${structure.fidelity.missing.join(", ")} — AI가 바꿨을 수 있으니 확인해 주세요.`}
                        </p>
                        <label htmlFor="structured-resume" className="sr-only">
                          정리된 이력서 (AI에 보냄)
                        </label>
                        <textarea
                          id="structured-resume"
                          value={structuredText}
                          onChange={(e) => setStructuredText(e.target.value)}
                          rows={12}
                          disabled={useRawResume}
                          className={`${fieldClass} mt-2 font-mono text-xs`}
                        />
                        <label className="mt-2 flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={useRawResume} onChange={(e) => setUseRawResume(e.target.checked)} className="accent-[var(--accent)]" />
                          정리하지 않고 가린 원문을 그대로 쓰기
                        </label>
                      </>
                    )}
                  </div>
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm text-muted hover:text-ink">가린 원문 보기 (가려지지 않은 개인정보가 없는지 확인해 주세요)</summary>
                    <pre aria-label="마스킹된 이력서" className="mt-2 max-h-64 overflow-auto rounded-lg bg-paper p-3 text-xs whitespace-pre-wrap">
                      {resume.text}
                    </pre>
                  </details>
                </div>
              )}
            </Panel>

            <Panel title="채용공고">
              <label htmlFor="posting" className="sr-only">
                채용공고 본문
              </label>
              <textarea
                id="posting"
                value={posting}
                onChange={(e) => setPosting(e.target.value)}
                rows={12}
                aria-describedby="posting-count"
                aria-invalid={postingTooLong}
                className={fieldClass}
                placeholder="담당 업무, 자격요건, 우대사항이 들어간 공고 본문을 붙여넣어 주세요."
              />
              <FieldHint id="posting-count" tone={postingTooLong ? "error" : "muted"}>
                {formatNumber(posting.length)} / {formatNumber(LIMITS.postingChars)}자
                {postingTooLong && ` · ${formatNumber(LIMITS.postingChars)}자 이하로 줄여 주세요. 회사 소개·복지는 빼도 괜찮아요.`}
              </FieldHint>

              {postingNotice && (
                <p role="status" className="mt-3 rounded-md bg-soft px-3 py-2 text-[0.8125rem]">
                  {postingNotice}
                </p>
              )}

              <div className="mt-4 border-t border-line pt-4">
                <p className="text-sm font-semibold">복사가 안 되는 공고라면</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[
                    { id: "posting-pdf", label: "공고 PDF 올리기" },
                    { id: "posting-images", label: "공고 스크린샷 올리기" },
                  ].map((b) => (
                    <label
                      key={b.id}
                      htmlFor={b.id}
                      className={`inline-flex h-10 cursor-pointer items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:border-ink/40 ${importing || busy ? "pointer-events-none opacity-50" : ""}`}
                    >
                      {b.label}
                    </label>
                  ))}
                  <input
                    id="posting-pdf"
                    ref={postingPdfRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    className="sr-only"
                    disabled={!!importing || !!busy}
                    onChange={(e) => handlePostingPdf(e.target.files?.[0])}
                  />
                  <input
                    id="posting-images"
                    ref={postingImageRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                    multiple
                    className="sr-only"
                    disabled={!!importing || !!busy}
                    onChange={(e) => handlePostingImages(Array.from(e.target.files ?? []))}
                  />
                </div>
                <details className="mt-3 text-[0.8125rem] text-muted">
                  <summary className="cursor-pointer hover:text-ink">가져오는 방법</summary>
                  <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-relaxed">
                    <li>
                      <b className="text-ink">PDF (추천, 무료)</b>: 공고 페이지에서 <kbd>Ctrl</kbd>+<kbd>P</kbd> (Mac은 <kbd>⌘</kbd>+<kbd>P</kbd>) → 대상에서
                      &lsquo;PDF로 저장&rsquo;을 골라 저장한 뒤 올려 주세요. &lsquo;Microsoft Print to PDF&rsquo;는 글자를 그림으로 바꿔 저장하니 고르지
                      마세요.
                    </li>
                    <li>
                      <b className="text-ink">스크린샷</b>: 공고 본문이 이미지이거나 PDF에 글자가 안 담길 때 쓰세요. 업무·자격요건·우대사항이 보이게
                      캡처하고, 길면 {LIMITS.postingImageFiles}장까지 나눠 올려요. AI가 글자를 읽으므로 결과를 꼭 확인해 주세요.
                    </li>
                    <li>가져온 내용은 위 칸에 채워지며, 직접 고칠 수 있어요.</li>
                  </ul>
                </details>
                {importing && <Loading label={importing} />}
                {postingError && <ErrorBox message={postingError.message} onRetry={postingError.retry} />}
              </div>
            </Panel>
          </div>

          {step === "input" && error && <ErrorBox message={error.message} onRetry={error.retry} />}

          {/* 다음 단계로 가는 버튼은 화면 아래에 붙여 둔다 */}
          <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 backdrop-blur">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-6">
              <Button size="lg" onClick={generateQuestions} disabled={!canGenerate}>
                예상 질문 만들기
              </Button>
              <Button variant="ghost" onClick={loadSample} disabled={!!busy}>
                샘플로 체험하기
              </Button>
              <div className="min-w-0 flex-1 text-sm [&_p]:mt-0">
                {busy && step === "input" ? (
                  <Loading label={busy} />
                ) : !resume || !posting.trim() ? (
                  <FieldHint>이력서와 채용공고를 모두 넣어 주세요.</FieldHint>
                ) : structuring ? (
                  <FieldHint>이력서 정리가 끝나면 질문을 만들 수 있어요.</FieldHint>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {/* 2. 질문과 답변 */}
        <section aria-labelledby="step-qa-title" hidden={step !== "questions"}>
          <StepHeader
            id="step-qa"
            title="질문과 답변"
            description="연습할 질문을 고르면 답변에 쓸 내 경험부터 물어봐요. AI는 내가 적은 경험만으로 초안을 씁니다."
            aside={
              drafts.length > 0 ? (
                <Button variant="secondary" onClick={() => goTo("interview")}>
                  초안 {drafts.length}개로 모의면접 보기
                </Button>
              ) : undefined
            }
          />

          <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
            <aside id="step-questions" aria-labelledby="questions-title" className="rounded-xl border border-line bg-surface p-4 sm:p-5 lg:sticky lg:top-28 lg:max-h-[calc(100dvh-8.5rem)] lg:overflow-y-auto">
              <h3 id="questions-title" className="text-base font-semibold">
                예상 질문
              </h3>
              <p className="mt-1 text-[0.8125rem] text-muted">
                {questions.length}개 중 초안 {drafts.length}개
                {demoIds && " · 데모 모드에서는 ★ 표시된 질문만 끝까지 체험할 수 있어요."}
              </p>
              <div className="mt-4 flex flex-col gap-5">
                {grouped.map(
                  (g) =>
                    g.items.length > 0 && (
                      <div key={g.type}>
                        <h3 className="text-[0.8125rem] font-semibold text-muted">{QUESTION_TYPE_LABEL[g.type]}</h3>
                        <ul className="mt-2 flex flex-col gap-1.5">
                          {g.items.map((q) => {
                            const locked = !!demoIds && !demoIds.includes(q.id);
                            const active = selected?.id === q.id;
                            const done = !!draftOf(q);
                            return (
                              <li key={q.id}>
                                <button
                                  type="button"
                                  onClick={() => pickQuestion(q)}
                                  disabled={locked || !!busy}
                                  aria-pressed={active}
                                  className={`w-full rounded-lg border px-3.5 py-3 text-left font-serif text-[0.9375rem] leading-relaxed transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                                    active ? "border-accent bg-soft" : "border-transparent bg-paper hover:border-line"
                                  }`}
                                >
                                  {demoIds?.includes(q.id) && <span aria-label="데모 체험 가능">★ </span>}
                                  {q.question}
                                  {done && (
                                    <span className="mt-1.5 flex items-center gap-1.5 font-sans text-xs font-semibold text-ok">
                                      <span aria-hidden className="h-2 w-2 rounded-full bg-ok" />
                                      초안 있음
                                    </span>
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ),
                )}
              </div>
            </aside>

            <div ref={detailRef} className="min-w-0 scroll-mt-28">
              {!selected ? (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
                  <p className="font-serif text-lg font-semibold">연습할 질문을 하나 고르세요</p>
                  <p className="mt-2 max-w-sm text-sm text-muted">
                    답변을 만들기 전에, 그 질문에 쓸 실제 경험을 먼저 적게 됩니다. 적은 경험만으로 초안을 만들어요.
                  </p>
                </div>
              ) : (
                <Panel>
                  <p className="text-[0.8125rem] font-semibold text-muted">{QUESTION_TYPE_LABEL[selected.type]}</p>
                  <p className="mt-1.5 font-serif text-[1.3125rem] leading-snug font-semibold">{selected.question}</p>

                  {showExperienceForm && exp && (
                    <div id="step-experience" className="mt-6 border-t border-line pt-5">
                      <h3 className="text-base font-semibold">내 경험 먼저 적기</h3>
                      <p className="mt-1 text-sm text-muted">AI가 경험을 지어내지 않도록, 답변에 쓸 실제 경험을 먼저 적어 주세요.</p>
                      <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-[0.9375rem] leading-relaxed">
                        {exp.prompts.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ol>
                      {exp.hint && <p className="mt-3 rounded-md bg-paper px-3 py-2 text-[0.8125rem] text-muted">참고: {exp.hint}</p>}

                      <label htmlFor="experience" className="mt-5 block text-sm font-semibold">
                        <span className="marker">내 경험</span>
                      </label>
                      <textarea
                        id="experience"
                        value={experience}
                        onChange={(e) => setExperience(e.target.value)}
                        rows={7}
                        aria-describedby="experience-hint"
                        aria-invalid={triedSubmit && (experienceEmpty || experienceShort || experienceTooLong)}
                        className={`${fieldClass} mt-2`}
                        placeholder="상황 → 내가 한 일 → 결과(수치) 순서로 적으면 좋아요. 관련 경험이 없으면 '없음'과 가장 가까운 경험을 적어 주세요."
                      />
                      <FieldHint id="experience-hint" tone={triedSubmit && (experienceEmpty || experienceShort || experienceTooLong) ? "error" : "muted"}>
                        {triedSubmit && experienceEmpty
                          ? "경험을 먼저 적어 주세요. 적은 내용만으로 답변을 만듭니다."
                          : triedSubmit && experienceShort
                            ? "조금 더 자세히 적어 주세요."
                            : experienceTooLong
                              ? `${formatNumber(LIMITS.experienceChars)}자 이하로 줄여 주세요.`
                              : `${formatNumber(experience.length)} / ${formatNumber(LIMITS.experienceChars)}자`}
                      </FieldHint>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button onClick={generateAnswer} disabled={!!busy}>
                          이 경험으로 답변 초안 만들기
                        </Button>
                        {(exp.sampleExperience || sampleExperience) && (
                          <Button
                            variant="ghost"
                            onClick={() => setExperience(exp.sampleExperience || sampleExperience || "")}
                            disabled={!!busy}
                          >
                            샘플 경험 채우기
                          </Button>
                        )}
                        {rewriting && (
                          <Button variant="ghost" onClick={() => setRewriting(false)} disabled={!!busy}>
                            취소
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {showDraft && currentDraft && (
                    <div id="step-answer" className="mt-6 border-t border-line pt-5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="text-base font-semibold">답변 초안</h3>
                        <span className="text-[0.8125rem] text-muted">직접 고치면 모의면접과 결과 정리에 그대로 반영돼요</span>
                      </div>
                      <textarea
                        aria-label="생성된 답변"
                        value={currentDraft.answer}
                        onChange={(e) => editAnswer(e.target.value)}
                        rows={12}
                        className={`${fieldClass} mt-3 text-base leading-[1.85]`}
                      />
                      <details className="mt-3 rounded-lg bg-paper px-4 py-3">
                        <summary className="cursor-pointer text-sm font-semibold">
                          <span className="marker">내가 적은 경험</span>
                        </summary>
                        <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-muted">{currentDraft.experience}</p>
                      </details>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={copyAnswer}>
                          {copied ? "복사했어요" : "답변 복사"}
                        </Button>
                        <Button variant="ghost" onClick={startRewrite} disabled={!!busy}>
                          경험 고쳐서 다시 만들기
                        </Button>
                      </div>
                      <p className="mt-5 border-t border-line pt-4 text-sm text-muted">
                        지금까지 만든 초안 {drafts.length}개 · 다른 질문을 고르거나, 초안을 만든 질문으로 모의면접을 볼 수 있어요.
                      </p>
                    </div>
                  )}

                  {busy && step === "questions" && <Loading label={busy} />}
                  {step === "questions" && error && <ErrorBox message={error.message} onRetry={error.retry} />}
                </Panel>
              )}
            </div>
          </div>
        </section>

        {/* 3. 모의면접 */}
        <section id="step-interview" aria-labelledby="step-interview-title" hidden={step !== "interview"}>
          <StepHeader id="step-interview" title="모의면접" description="면접관이 질문하고, 내 답을 듣고 꼬리질문을 한 뒤 질문별로 피드백을 줘요." />
          <div className="mx-auto mt-6 max-w-3xl">
            {drafts.length > 0 && (
              <MockInterview key={interviewKey} drafts={drafts} resume={resumeForAI} posting={posting} demoMode={demoMode} onRecord={recordInterview} onGoExport={() => goTo("export")} sampleAnswer={sampleExperience ?? drafts.find((d) => d.exp?.sampleExperience)?.exp?.sampleExperience ?? null} />
            )}
          </div>
        </section>

        {/* 4. 결과 정리 */}
        <section id="step-export" aria-labelledby="step-export-title" hidden={step !== "export"}>
          <StepHeader
            id="step-export"
            title="결과 정리"
            description="질문·답변 초안·모의면접 기록을 HTML 파일로 저장하거나 Notion에 붙여넣을 Markdown으로 복사해요."
          />
          <div className="mt-6">
            <ExportPanel data={{ questions, drafts, interviews }} />
          </div>
        </section>

        {demoMode && <p className="mt-10 text-center text-xs text-muted">데모 결과는 미리 만들어 둔 샘플입니다.</p>}
      </main>
    </div>
  );
}
