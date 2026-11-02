/**
 * 붙여넣은 글이 채용공고처럼 보이는지 가볍게 판별한다 (TC-106).
 * AI를 부르기 전에 걸러서 비용과 엉뚱한 질문 생성을 막는 용도라, 일부러 느슨하게 잡는다.
 */

const SIGNALS: RegExp[] = [
  /담당\s*업무|주요\s*업무|업무\s*내용/,
  // 스타트업식 표현: "이런 일을 해요", "합류하면 함께할 업무에요", "이런 분과 함께하고 싶어요"
  /이런 일을|함께할 업무|합류하면/,
  /이런 분(?:을|과|이면|이라면)|기다리고 있어요|함께하고 싶어요|더 좋아요/,
  /포지션|모집\s*분야|모집\s*부문/,
  /자격\s*요건|지원\s*자격|필수\s*요건/,
  /우대\s*사항|우대\s*조건/,
  /채용|모집|지원\s*방법|접수/,
  /전형\s*절차|서류\s*전형|면접/,
  /경력|신입|인턴|정규직|계약직/,
  /복리\s*후생|혜택|복지|근무\s*(?:조건|지|형태)/,
  /responsibilit|what you.?ll do/i,
  /requirement|qualification|must have/i,
  /preferred|nice to have|bonus point/i,
  /benefit|perk/i,
  /apply|application|hiring|position|role\b/i,
];

export function postingSignalCount(text: string): number {
  return SIGNALS.filter((re) => re.test(text)).length;
}

export function looksLikePosting(text: string): boolean {
  return postingSignalCount(text) >= 3;
}
