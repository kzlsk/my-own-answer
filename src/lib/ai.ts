import "server-only";
import OpenAI from "openai";
import { getOpenAI, MODEL, VISION_MODEL } from "@/lib/openai";
import { ApiError } from "@/lib/api-error";

/** OpenAI 호출 + 에러를 화면용 코드로 바꾸기 */

function toApiError(e: unknown): ApiError {
  if (e instanceof OpenAI.APIConnectionTimeoutError) {
    return new ApiError("AI_TIMEOUT", "AI 응답이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요.", 504);
  }
  if (e instanceof OpenAI.AuthenticationError) {
    return new ApiError("AI_AUTH", "OpenAI API 키가 올바르지 않습니다. .env.local의 키를 확인해 주세요.", 500);
  }
  if (e instanceof OpenAI.RateLimitError) {
    return new ApiError("AI_FAILED", "요청이 너무 많거나 사용 한도를 넘었습니다. 잠시 후 다시 시도해 주세요.", 429);
  }
  return new ApiError("AI_FAILED", "AI 응답을 받지 못했습니다. 다시 시도해 주세요.", 502);
}

export async function generateText(prompt: string): Promise<string> {
  try {
    const res = await getOpenAI().chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.choices[0]?.message?.content?.trim() ?? "";
    if (!text) throw new ApiError("AI_FAILED", "AI가 빈 답변을 보냈습니다. 다시 시도해 주세요.", 502);
    return text;
  } catch (e) {
    throw e instanceof ApiError ? e : toApiError(e);
  }
}

export async function generateJson<T>(
  prompt: string,
  schema: { name: string; strict: boolean; schema: Record<string, unknown> },
): Promise<T> {
  let content = "";
  try {
    const res = await getOpenAI().chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: schema },
    });
    content = res.choices[0]?.message?.content ?? "";
  } catch (e) {
    throw toApiError(e);
  }
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new ApiError("AI_FAILED", "AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.", 502);
  }
}

/** 이미지(공고 스크린샷)를 보고 글자를 옮겨 적게 한다. images는 data URL */
export async function generateFromImages(prompt: string, images: string[]): Promise<string> {
  try {
    const res = await getOpenAI().chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...images.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "high" as const } })),
          ],
        },
      ],
    });
    const text = res.choices[0]?.message?.content?.trim() ?? "";
    if (!text) throw new ApiError("AI_FAILED", "이미지에서 글자를 읽지 못했습니다. 더 선명한 스크린샷으로 다시 시도해 주세요.", 502);
    return text;
  } catch (e) {
    throw e instanceof ApiError ? e : toApiError(e);
  }
}
