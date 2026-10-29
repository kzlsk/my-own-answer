import { NextResponse } from "next/server";
import { isDemoMode, MODEL } from "@/lib/openai";

/** 실행 상태 확인용: 데모 모드 여부와 모델명 (키 값은 절대 내보내지 않음) */
export function GET() {
  return NextResponse.json({ demo: isDemoMode(), model: MODEL });
}
