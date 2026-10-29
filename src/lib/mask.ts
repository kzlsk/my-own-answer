/**
 * 개인정보 마스킹
 * OpenAI로 보내기 전에 이력서 텍스트에서 이름·전화번호·이메일·링크를 가린다.
 * 앱(API 라우트)과 평가 스크립트(scripts/eval.ts)가 같은 함수를 쓴다.
 */

export type MaskCounts = {
  name: number;
  phone: number;
  email: number;
  url: number;
};

export type MaskResult = {
  text: string;
  counts: MaskCounts;
};

export const MASK = {
  name: "[이름]",
  phone: "[전화번호]",
  email: "[이메일]",
  url: "[링크]",
} as const;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const URL_PATTERN = /\bhttps?:\/\/[^\s)>\]]+|\bwww\.[^\s)>\]]+/gi;

/**
 * 휴대전화: 010-0000-0000, 010.0000.0000, 010 0000 0000, 01000000000,
 * (010)0000-0000, +82-10-0000-0000, +82 10 0000 0000
 */
const MOBILE =
  /(?:\+82[\s.-]?\(?0?\)?[\s.-]?|\(?0)1[016789]\)?[\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)/g;

/** 유선전화: 02-000-0000, 031-0000-0000 */
const LANDLINE = /(?<!\d)\(?0(?:2|[3-6][1-5])\)?[\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)/g;

/** "이름: 홍길동 (Gildong Hong)" 같은 줄에서 이름 후보를 찾는다 */
const NAME_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:이름|성명|Name)(?:\*\*)?\s*[:：]\s*(.+)$/gim;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(NAME_LINE)) {
    const value = match[1].trim();
    // "표지안 (Jian Pyo)" → "표지안", "Jian Pyo"
    const [main, ...rest] = value.split(/[()（）]/);
    for (const part of [main, ...rest]) {
      const candidate = part.replace(/[|/·,].*$/, "").trim();
      if (candidate.length < 2 || candidate.length > 30) continue;
      names.add(candidate);

      // 한글 이름은 띄어쓰기만 다르게 다시 나오는 경우가 많다: "피 도윤" ↔ "피도윤"
      const compact = candidate.replace(/\s+/g, "");
      if (/^[가-힣]{2,5}$/.test(compact)) {
        names.add(compact);
        names.add(`${compact[0]} ${compact.slice(1)}`);
      }
    }
  }
  // 긴 이름부터 바꿔야 "Jian Pyo"가 "Jian"보다 먼저 처리된다
  return [...names].sort((a, b) => b.length - a.length);
}

function replaceCounting(text: string, pattern: RegExp, token: string): [string, number] {
  let count = 0;
  const out = text.replace(pattern, () => {
    count += 1;
    return token;
  });
  return [out, count];
}

export function maskPersonalInfo(input: string): MaskResult {
  const counts: MaskCounts = { name: 0, phone: 0, email: 0, url: 0 };
  let text = input;
  let n: number;

  // 이메일 → 링크 → 전화 → 이름 순서 (이메일 안의 영문 이름이 먼저 사라지도록)
  [text, n] = replaceCounting(text, EMAIL, MASK.email);
  counts.email += n;

  [text, n] = replaceCounting(text, URL_PATTERN, MASK.url);
  counts.url += n;

  [text, n] = replaceCounting(text, MOBILE, MASK.phone);
  counts.phone += n;
  [text, n] = replaceCounting(text, LANDLINE, MASK.phone);
  counts.phone += n;

  for (const name of findNames(input)) {
    [text, n] = replaceCounting(text, new RegExp(escapeRegExp(name), "g"), MASK.name);
    counts.name += n;
  }

  return { text, counts };
}
