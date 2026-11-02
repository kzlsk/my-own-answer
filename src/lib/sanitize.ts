/**
 * 모델 출력을 화면에 보여 주기 전에 정리한다.
 * - BUG-001: 마스킹 토큰([이름] 등)이 답변에 새어 나오면 지운다
 * - 말로 하는 답변이라 마크다운 굵게·제목 표시를 지운다
 */

const MASK_TOKEN = /\s*\[(?:이름|전화번호|이메일|링크)\]\s*/g;

export function stripMaskTokens(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => {
      // "저는 [이름]입니다." 처럼 자기소개 문장은 통째로 뺀다
      if (/^(?:안녕하세요[,.]?\s*)?(?:저는\s*)?\[이름\]\s*(?:입니다|이라고 합니다)[.!]?$/.test(sentence.trim())) return "";
      return sentence.replace(MASK_TOKEN, " ").replace(/\s{2,}/g, " ");
    })
    .filter((s) => s.trim() !== "")
    .join(" ")
    .trim();
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .trim();
}

export function cleanAnswer(text: string): string {
  return stripMaskTokens(stripMarkdown(text));
}

export function hasMaskToken(text: string): boolean {
  return /\[(?:이름|전화번호|이메일|링크)\]/.test(text);
}
