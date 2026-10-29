import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { maskPersonalInfo } from "../../src/lib/mask";

/**
 * 평가용 테스트 세트: data/resumes (가상 이력서) × data/postings (공개 공고)
 */

export type Resume = {
  id: string; // r03-qa
  /** 마스킹한 이력서 본문 (제목·안내문·경험 답변 섹션 제외) — 모델에게 보내는 이력서 */
  text: string;
  /** "## 경험 답변" 섹션 — 경험 질문에 대한 사용자의 답을 흉내 낸 것 */
  experience: string;
};

export type Posting = {
  id: string; // p03-qa
  source: string;
  text: string;
};

export type Case = {
  id: string; // r03-qa__p05-pm
  resume: Resume;
  posting: Posting;
  /** 이력서와 공고의 번호가 같으면 직무가 맞는 조합 (r01×p01 … r05×p05) */
  roleMatch: boolean;
};

const root = () => path.join(process.cwd(), "data");

function mdFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort();
}

function splitExperience(md: string): { body: string; experience: string } {
  const marker = /^##\s*경험 답변\s*$/m;
  const m = md.match(marker);
  if (!m || m.index === undefined) return { body: md, experience: "" };
  const after = md.slice(m.index + m[0].length);
  const next = after.search(/^##\s/m);
  const experience = (next === -1 ? after : after.slice(0, next)).trim();
  const body = md.slice(0, m.index) + (next === -1 ? "" : after.slice(next));
  return { body, experience };
}

export function loadResumes(): Resume[] {
  const dir = path.join(root(), "resumes");
  return mdFiles(dir).map((file) => {
    const raw = readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n");
    const { body, experience } = splitExperience(raw);
    const cleaned = body
      .split("\n")
      .filter((line) => !/^#\s/.test(line)) // "# r03-qa (가상 인물)" 제목 줄
      .filter((line) => !/^>\s/.test(line)) // 테스트용 안내문
      .join("\n")
      .trim();
    return {
      id: file.replace(/\.md$/, ""),
      text: maskPersonalInfo(cleaned).text,
      experience: maskPersonalInfo(experience).text,
    };
  });
}

export function loadPostings(): Posting[] {
  const dir = path.join(root(), "postings");
  return mdFiles(dir).map((file) => {
    const raw = readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n");
    const source = raw.match(/출처:\s*(\S+)/)?.[1] ?? "";
    return {
      id: file.replace(/\.md$/, ""),
      source,
      text: raw.replace(/<!--[\s\S]*?-->/g, "").trim(),
    };
  });
}

const num = (id: string) => id.slice(1, 3);

/**
 * 모든 조합을 섞인 순서로 돌려준다.
 * --limit 5 처럼 앞에서 일부만 잘라도 이력서와 공고가 고루 섞이도록
 * k번째 조합 = (이력서 k mod R, 공고 (k mod R + k mod P) mod P).
 * R=5, P=6처럼 서로소이면 모든 조합이 한 번씩 나온다.
 */
export function buildCases(): Case[] {
  const resumes = loadResumes();
  const postings = loadPostings();
  if (resumes.length === 0 || postings.length === 0) {
    throw new Error("data/resumes 또는 data/postings가 비어 있습니다. make-test-data 스킬을 먼저 쓰세요.");
  }
  const total = resumes.length * postings.length;
  const seen = new Set<string>();
  const cases: Case[] = [];

  for (let k = 0; cases.length < total && k < total * 4; k++) {
    const r = k % resumes.length;
    const p = (r + (k % postings.length)) % postings.length;
    const resume = resumes.at(r)!;
    const posting = postings.at(p)!;
    const id = `${resume.id}__${posting.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    cases.push({ id, resume, posting, roleMatch: num(resume.id) === num(posting.id) });
  }
  return cases;
}
