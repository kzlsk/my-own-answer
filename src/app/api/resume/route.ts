import { NextResponse } from "next/server";
import { collapseDoubledLines, maskPersonalInfo, namesFromFileName } from "@/lib/mask";
import { ApiError, errorResponse, readJson, requireText } from "@/lib/api-error";
import { LIMITS } from "@/lib/limits";
import type { ResumeResponse } from "@/lib/flow-types";

export const runtime = "nodejs";

/**
 * 이력서 글을 받아 개인정보를 가린다 (TC-101~105, TC-201~205).
 * PDF·TXT·MD 파일은 브라우저에서 글자만 뽑아 보낸다. 원본 파일은 서버로 오지 않고,
 * 서버도 원문을 저장하지 않으며 가린 글만 돌려준다.
 *
 * body: { text, fileName?, words? }
 * - fileName: "FE_홍길동_이력서.pdf"처럼 파일 이름에 든 이름도 가리기 위해 받는다
 * - words: 사용자가 직접 가리겠다고 입력한 단어 (팀원 이름 등)
 */
export async function POST(req: Request) {
  try {
    const body = await readJson<{ text?: unknown; fileName?: unknown; words?: unknown }>(req);
    const raw = typeof body.text === "string" ? body.text.replace(/\r\n/g, "\n") : "";
    const text = requireText(collapseDoubledLines(raw), "이력서", LIMITS.resumeChars);
    const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 200) : undefined;

    const words = Array.isArray(body.words) ? body.words.filter((w): w is string => typeof w === "string") : [];
    if (words.length > LIMITS.maskWords) {
      throw new ApiError("BAD_REQUEST", `가릴 단어는 ${LIMITS.maskWords}개까지 넣을 수 있어요.`);
    }

    const masked = maskPersonalInfo(text, {
      names: fileName ? namesFromFileName(fileName) : [],
      words: words.map((w) => w.trim().slice(0, 30)),
    });
    const res: ResumeResponse = { fileName, text: masked.text, counts: masked.counts, chars: masked.text.length };
    return NextResponse.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
