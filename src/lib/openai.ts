import "server-only";
import OpenAI from "openai";

/**
 * 서버 전용 OpenAI 클라이언트.
 * 클라이언트 컴포넌트에서 import하면 빌드 에러가 나도록 "server-only"로 막아 둔다.
 */

export const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * 공고 스크린샷 판독 모델. gpt-4o-mini는 한글 스크린샷에서 비슷한 모양의 다른 단어로 바꿔 읽어서(BUG-007)
 * 판독만 더 정확한 모델을 기본으로 쓴다. 판독은 공고를 가져올 때 한 번뿐이라 비용 영향이 작다.
 */
export const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o";

/** API 키가 없으면 데모 모드 */
export function isDemoMode(): boolean {
  return !process.env.OPENAI_API_KEY;
}

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (isDemoMode()) {
    throw new Error("OPENAI_API_KEY가 없어 데모 모드로 실행 중입니다.");
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30_000 });
  }
  return client;
}
