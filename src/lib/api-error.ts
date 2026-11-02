import { NextResponse } from "next/server";

/** 화면이 코드별로 안내 문구를 고를 수 있게 에러를 코드로 통일한다 */
export type ErrorCode =
  | "EMPTY_INPUT"
  | "UNSUPPORTED_FILE"
  | "FILE_TOO_LARGE"
  | "TEXT_TOO_LONG"
  | "TEXT_TOO_SHORT"
  | "NOT_POSTING"
  | "PDF_NO_TEXT"
  | "PDF_NEEDS_OCR"
  | "PDF_UNREADABLE"
  | "DEMO_UNAVAILABLE"
  | "TOO_MANY_FILES"
  | "AI_TIMEOUT"
  | "AI_AUTH"
  | "AI_FAILED"
  | "BAD_REQUEST";

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function errorResponse(e: unknown) {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
  console.error(e);
  return NextResponse.json(
    { error: { code: "AI_FAILED", message: "알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." } },
    { status: 500 },
  );
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError("BAD_REQUEST", "요청 형식이 올바르지 않습니다.");
  }
}

export function requireText(value: unknown, label: string, max: number, min = 1): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) throw new ApiError("EMPTY_INPUT", `${label}을(를) 입력해 주세요.`);
  if (text.length < min) throw new ApiError("TEXT_TOO_SHORT", `${label}을(를) 조금 더 자세히 적어 주세요.`);
  if (text.length > max) {
    throw new ApiError("TEXT_TOO_LONG", `${label}은(는) ${max.toLocaleString("ko-KR")}자 이하로 줄여 주세요.`);
  }
  return text;
}
