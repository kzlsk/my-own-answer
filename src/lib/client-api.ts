"use client";

import type { ApiErrorBody } from "@/lib/flow-types";

/**
 * 화면에서 API를 부르는 공통 함수.
 * - 서버 에러(4xx/5xx)는 서버가 보낸 안내 문구를 그대로 쓴다 (TC-701)
 * - 연결 끊김·시간 초과는 따로 안내한다 (TC-702)
 * - JSON이 아닌 응답은 화면이 깨지지 않게 오류로 바꾼다 (TC-703)
 */

export class ClientError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 60_000;

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ClientError("TIMEOUT", "응답 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.");
    }
    throw new ClientError("NETWORK", "서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.");
  } finally {
    clearTimeout(timer);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ClientError("BAD_RESPONSE", "서버 응답을 읽지 못했습니다. 다시 시도해 주세요.");
  }

  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ClientError(err?.code ?? "UNKNOWN", err?.message ?? "요청을 처리하지 못했습니다. 다시 시도해 주세요.");
  }
  if (body === null || typeof body !== "object") {
    throw new ClientError("BAD_RESPONSE", "서버 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.");
  }
  return body as T;
}

export function postJson<T>(url: string, data: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}


export function postForm<T>(url: string, form: FormData): Promise<T> {
  return request<T>(url, { method: "POST", body: form });
}

export function getJson<T>(url: string): Promise<T> {
  return request<T>(url, { method: "GET" });
}

export function errorMessage(e: unknown): string {
  return e instanceof ClientError ? e.message : "알 수 없는 오류가 발생했습니다. 다시 시도해 주세요.";
}
