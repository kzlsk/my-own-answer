/**
 * 이력서 정리: AI가 분류한 JSON → 항상 같은 모양의 MD로 바꾸고, 수치가 원문에 있는지 검사한다.
 * (MD 모양은 코드가 정해서 프롬프트가 바뀌어도 뒤 단계 입력 형식이 흔들리지 않게 한다)
 */

export type StructuredResume = {
  summary: string;
  experiences: { org: string; role: string; period: string; details: string[] }[];
  projects: {
    name: string;
    period: string;
    role: string;
    stack: string;
    details: string[];
    troubles: { problem: string; solution: string; result: string }[];
  }[];
  skills: string[];
  activities: { name: string; period: string; details: string[] }[];
  certificates: { name: string; date: string }[];
  awards: { name: string; date: string }[];
  uncategorized: string[];
};

const str = { type: "string" } as const;
const strArr = { type: "array", items: str } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const STRUCTURE_SCHEMA = {
  name: "structured_resume",
  strict: true,
  schema: obj({
    summary: str,
    experiences: { type: "array", items: obj({ org: str, role: str, period: str, details: strArr }) },
    projects: {
      type: "array",
      items: obj({
        name: str,
        period: str,
        role: str,
        stack: str,
        details: strArr,
        troubles: { type: "array", items: obj({ problem: str, solution: str, result: str }) },
      }),
    },
    skills: strArr,
    activities: { type: "array", items: obj({ name: str, period: str, details: strArr }) },
    certificates: { type: "array", items: obj({ name: str, date: str }) },
    awards: { type: "array", items: obj({ name: str, date: str }) },
    uncategorized: strArr,
  }),
};

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const joinBar = (...parts: (string | undefined)[]) => parts.map(clean).filter(Boolean).join(" | ");
const bullets = (items: string[] | undefined) => (items ?? []).map(clean).filter(Boolean).map((t) => `- ${t}`);

export function toMarkdown(r: StructuredResume): string {
  const out: string[] = [];
  const section = (title: string, body: string[]) => {
    if (body.length) out.push(`## ${title}`, "", ...body, "");
  };

  if (clean(r.summary)) out.push(clean(r.summary), "");

  section(
    "경력",
    r.experiences.flatMap((e) => [`### ${joinBar(e.org, e.role, e.period) || "경력"}`, ...bullets(e.details), ""]),
  );

  section(
    "프로젝트",
    r.projects.flatMap((p) => {
      const lines = [`### ${joinBar(p.name, p.period, p.role) || "기타 프로젝트"}`];
      if (clean(p.stack)) lines.push(`기술: ${clean(p.stack)}`);
      lines.push(...bullets(p.details));
      const troubles = p.troubles.filter((t) => clean(t.problem) || clean(t.solution));
      if (troubles.length) {
        lines.push("", "트러블슈팅");
        for (const t of troubles) {
          lines.push(`- 문제: ${clean(t.problem)}`);
          if (clean(t.solution)) lines.push(`  - 해결: ${clean(t.solution)}`);
          if (clean(t.result)) lines.push(`  - 결과: ${clean(t.result)}`);
        }
      }
      return [...lines, ""];
    }),
  );

  section("기술 스택", bullets(r.skills));
  section(
    "교육·활동",
    r.activities.flatMap((a) => [`### ${joinBar(a.name, a.period) || "활동"}`, ...bullets(a.details), ""]),
  );
  section("자격증", r.certificates.filter((c) => clean(c.name)).map((c) => `- ${joinBar(c.name, c.date)}`));
  section("수상", r.awards.filter((a) => clean(a.name)).map((a) => `- ${joinBar(a.name, a.date)}`));
  section("기타", bullets(r.uncategorized));

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 숫자 표기 정규화: "2023. 03" → "2023.03", "4,000" → "4000" */
function numberTokens(text: string): string[] {
  const normalized = text.replace(/(\d)\s*([.:/~-])\s*(?=\d)/g, "$1$2").replace(/(\d),(?=\d{3}\b)/g, "$1");
  return normalized.match(/\d+(?:[.:/]\d+)*/g) ?? [];
}

export type Fidelity = {
  /** 정리 결과에 나온 숫자 중 원문에도 있는 비율 (0~1) */
  ratio: number;
  total: number;
  /** 원문에 없는 숫자 — AI가 바꿨거나 지어낸 것일 수 있음 */
  missing: string[];
};

/**
 * 수치 보존 검사: 정리 결과의 숫자가 모두 원문에 그대로 있는지 본다.
 * 부분 문자열로 비교하면 지어낸 "30"이 원문의 "2023" 안에서 찾아져 통과하므로, 숫자 단위로 정확히 비교한다.
 */
export function checkFidelity(source: string, output: string): Fidelity {
  const src = new Set(numberTokens(source));
  const out = numberTokens(output);
  const missing = out.filter((t) => !src.has(t));
  const total = out.length;
  return { ratio: total === 0 ? 1 : (total - missing.length) / total, total, missing: [...new Set(missing)] };
}
