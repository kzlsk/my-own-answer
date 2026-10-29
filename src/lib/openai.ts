import "server-only";
import OpenAI from "openai";

/**
 * 서버 전용 OpenAI 클라이언트.
 * 클라이언트 컴포넌트에서 import하면 빌드 에러가 나도록 "server-only"로 막아 둔다.
 */

export const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

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
