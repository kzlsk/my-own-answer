import { isDemoMode } from "@/lib/openai";

export const dynamic = "force-dynamic";

const steps = [
  "이력서 업로드 + 채용공고 붙여넣기",
  "개인정보 자동 마스킹",
  "예상 질문 생성",
  "내 경험 먼저 묻기",
  "내 경험만으로 답변 초안",
  "텍스트 모의면접",
  "HTML · Notion용 Markdown 내보내기",
];

export default function Home() {
  const demo = isDemoMode();

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-bold">my-own-answer</h1>
      <p className="mt-2 text-lg opacity-80">
        AI가 지어낸 답이 아니라, 내 경험으로 준비하는 면접
      </p>

      {demo && (
        <p className="mt-6 rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          데모 모드로 실행 중입니다. 실제로 생성하려면 <code>.env.local</code>에 OpenAI API 키를 넣어 주세요.
        </p>
      )}

      <ol className="mt-10 space-y-3">
        {steps.map((step, i) => (
          <li key={step} className="flex items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
