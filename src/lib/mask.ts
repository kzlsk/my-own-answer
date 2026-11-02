/**
 * 개인정보 마스킹
 * OpenAI로 보내기 전에 이력서 텍스트에서 이름·생년월일·전화번호·이메일·링크를 가린다.
 * 앱(API 라우트)과 평가 스크립트(scripts/eval.ts)가 같은 함수를 쓴다.
 */

export type MaskCounts = {
  name: number;
  birth: number;
  phone: number;
  email: number;
  url: number;
  custom: number;
};

export type MaskResult = {
  text: string;
  counts: MaskCounts;
};

export type MaskOptions = {
  /** 파일 이름 등 다른 곳에서 찾은 이름 후보 */
  names?: string[];
  /** 사용자가 직접 가리겠다고 입력한 단어 (팀원 이름, 회사 내부 프로젝트명 등) */
  words?: string[];
};

export const MASK = {
  name: "[이름]",
  birth: "[생년월일]",
  phone: "[전화번호]",
  email: "[이메일]",
  url: "[링크]",
  custom: "[가림]",
} as const;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const URL_PATTERN = /\bhttps?:\/\/[^\s)>\]|]+|\bwww\.[^\s)>\]|]+/gi;

/**
 * 휴대전화: 010-0000-0000, 010.0000.0000, 010 0000 0000, 01000000000,
 * (010)0000-0000, +82-10-0000-0000, +82 10 0000 0000
 */
const MOBILE =
  /(?:\+82[\s.-]?\(?0?\)?[\s.-]?|\(?0)1[016789]\)?[\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)/g;

/** 유선전화: 02-000-0000, 031-0000-0000 */
const LANDLINE = /(?<!\d)\(?0(?:2|[3-6][1-5])\)?[\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)/g;

/** "이름: 홍길동 (Gildong Hong)" 같은 줄 */
const NAME_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:이름|성명|Name)(?:\*\*)?\s*[:：]\s*(.+)$/gim;

/** 이력서 첫머리의 "Frontend Developer 홍길동", "백엔드 개발자 홍길동" 같은 제목 줄 (같은 줄 안에서만 — 줄을 넘으면 "PM\n복약 관리" 같은 오탐이 생긴다) */
const HEADLINE_NAME =
  /(?:Developer|Engineer|Designer|Manager|Marketer|Planner|QA|PM|개발자|엔지니어|디자이너|마케터|기획자)[ \t]*[|·,/]?[ \t]*([가-힣]{2,4}?)(?=입니다|이에요|예요|(?![가-힣]))/g;

/** 이름으로 착각하기 쉬운 단어 */
const NOT_NAMES = new Set([
  "입니다", "이며", "로서", "으로서", "으로", "에서", "경력", "신입", "지원", "지원자",
  "이력서", "경력기술서", "포트폴리오", "자기소개서", "자소서", "최종", "수정", "제출", "제출용",
  "프론트", "프론트엔드", "백엔드", "풀스택", "개발자", "개발", "디자이너", "기획자", "마케터", "엔지니어",
  "소개", "프로필", "연락처", "학력", "경험", "역량", "기술", "프로젝트", "사본", "원본", "양식",
]);

/** 생년월일: "생년월일: 1999. 03. 02", "생일 1999년 3월 2일" */
const BIRTH_LABELED =
  /((?:생년월일|생일|Birth(?:day|\s*date)?)\s*[:：]?\s*)((?:19|20)\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?)/gi;

/** 첫머리에 표시 없이 나오는 연·월·일 날짜 (예: "2002. 01. 01 | 이메일 | 전화") — 경력 기간처럼 일이 없는 날짜는 건드리지 않는다 */
const BIRTH_BARE = /(?<![\d.])(?<![-~]\s*)(?:19[5-9]\d|20[01]\d)\s*[.\-/]\s*(?:0?[1-9]|1[0-2])\s*[.\-/]\s*(?:0?[1-9]|[12]\d|3[01])(?![\d.]*\s*[-~])(?!\d)/g;
const HEAD_CHARS = 400;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isNameLike(word: string): boolean {
  return /^[가-힣]{2,4}$/.test(word) && !NOT_NAMES.has(word);
}

/** 한글 이름은 띄어쓰기만 다르게 다시 나오는 경우가 많다: "피 도윤" ↔ "피도윤" */
function withSpacingVariants(name: string): string[] {
  const compact = name.replace(/\s+/g, "");
  if (!/^[가-힣]{2,5}$/.test(compact)) return [name];
  return [name, compact, `${compact[0]} ${compact.slice(1)}`];
}

export function findNames(text: string): string[] {
  const names = new Set<string>();

  for (const match of text.matchAll(NAME_LINE)) {
    // "표지안 (Jian Pyo)" → "표지안", "Jian Pyo"
    const [main, ...rest] = match[1].trim().split(/[()（）]/);
    for (const part of [main, ...rest]) {
      const candidate = part.replace(/[|/·,].*$/, "").trim();
      if (candidate.length < 2 || candidate.length > 30) continue;
      withSpacingVariants(candidate).forEach((v) => names.add(v));
    }
  }

  for (const match of text.slice(0, HEAD_CHARS).matchAll(HEADLINE_NAME)) {
    if (isNameLike(match[1])) withSpacingVariants(match[1]).forEach((v) => names.add(v));
  }

  // 원티드 이력서처럼 첫머리에 이름만 한 줄로 있는 경우 (처음 5줄 안)
  const firstLines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 5);
  for (const line of firstLines) {
    if (isNameLike(line)) withSpacingVariants(line).forEach((v) => names.add(v));
  }

  // 긴 이름부터 바꿔야 "Jian Pyo"가 "Jian"보다 먼저 처리된다
  return [...names].sort((a, b) => b.length - a.length);
}

/** "FE_홍길동_이력서.pdf" 같은 파일 이름에서 이름 후보를 찾는다 */
export function namesFromFileName(fileName: string): string[] {
  return fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[\s_\-.()[\]]+/)
    .filter(isNameLike);
}

function replaceCounting(text: string, pattern: RegExp, token: string): [string, number] {
  let count = 0;
  const out = text.replace(pattern, () => {
    count += 1;
    return token;
  });
  return [out, count];
}

export function maskPersonalInfo(input: string, options: MaskOptions = {}): MaskResult {
  const counts: MaskCounts = { name: 0, birth: 0, phone: 0, email: 0, url: 0, custom: 0 };
  let text = input;
  let n: number;

  // 생년월일 → 이메일 → 링크 → 전화 → 이름 → 직접 입력한 단어
  // (날짜를 먼저 가려야 전화번호 패턴과 섞이지 않고, 이메일을 먼저 가려야 이메일 속 영문 이름이 남지 않는다)
  text = text.replace(BIRTH_LABELED, (_, label: string) => {
    counts.birth += 1;
    return label + MASK.birth;
  });
  const head = text.slice(0, HEAD_CHARS);
  const maskedHead = head.replace(BIRTH_BARE, () => {
    counts.birth += 1;
    return MASK.birth;
  });
  text = maskedHead + text.slice(HEAD_CHARS);

  [text, n] = replaceCounting(text, EMAIL, MASK.email);
  counts.email += n;

  [text, n] = replaceCounting(text, URL_PATTERN, MASK.url);
  counts.url += n;

  [text, n] = replaceCounting(text, MOBILE, MASK.phone);
  counts.phone += n;
  [text, n] = replaceCounting(text, LANDLINE, MASK.phone);
  counts.phone += n;

  const names = new Set(findNames(input));
  for (const extra of options.names ?? []) {
    if (isNameLike(extra.replace(/\s+/g, ""))) withSpacingVariants(extra).forEach((v) => names.add(v));
  }
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    [text, n] = replaceCounting(text, new RegExp(escapeRegExp(name), "g"), MASK.name);
    counts.name += n;
  }

  const words = (options.words ?? []).map((w) => w.trim()).filter((w) => w.length >= 2);
  for (const word of words.sort((a, b) => b.length - a.length)) {
    [text, n] = replaceCounting(text, new RegExp(escapeRegExp(word), "g"), MASK.custom);
    counts.custom += n;
  }

  return { text, counts };
}

/**
 * PDF에서 뽑은 글 정리: 디자인 도구로 만든 PDF는 글자 층이 겹쳐 같은 줄이 두 번 붙어 나온다
 * ("IntroIntro", "Frontend Developer 홍길동Frontend Developer 홍길동"). 이런 줄은 한 번으로 줄인다.
 */
export function collapseDoubledLines(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (t.length >= 4 && t.length % 2 === 0) {
        const half = t.length / 2;
        if (t.slice(0, half) === t.slice(half)) return t.slice(0, half);
      }
      return line;
    })
    .join("\n");
}
