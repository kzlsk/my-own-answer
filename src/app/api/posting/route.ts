import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/openai";
import { generateFromImages } from "@/lib/ai";
import { ApiError, errorResponse } from "@/lib/api-error";
import { loadPrompt } from "@/lib/prompts";
import { PDF_IMAGE_ONLY_HINT, pdfToText } from "@/lib/pdf";
import { LIMITS, extensionOf, tooLargeMessage } from "@/lib/limits";
import { PROMPT_VERSION } from "@/lib/config";
import type { PostingResponse } from "@/lib/flow-types";

export const runtime = "nodejs";
export const maxDuration = 60;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * 복사가 막힌 채용공고를 가져온다 (TC-108~112).
 * - file: 공고를 "PDF로 저장"한 파일 → 글자 층 추출 (AI 없음, 무료)
 * - images: 공고 스크린샷 조각들 (브라우저에서 줄이고 잘라 보냄) → AI가 글자를 옮겨 적음
 * 결과는 바로 쓰지 않고 화면의 공고 칸에 채워서 사용자가 확인·수정한다.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData().catch(() => {
      throw new ApiError("BAD_REQUEST", "파일을 받지 못했습니다. 다시 올려 주세요.");
    });
    const file = form.get("file");
    const images = form.getAll("images").filter((v): v is File => v instanceof File && v.size > 0);

    if (file instanceof File && file.size > 0) {
      if (extensionOf(file.name) !== ".pdf") throw new ApiError("UNSUPPORTED_FILE", "PDF 파일만 올릴 수 있어요.", 415);
      if (file.size > LIMITS.fileBytes) throw new ApiError("FILE_TOO_LARGE", tooLargeMessage(), 413);
      const text = await pdfToText(new Uint8Array(await file.arrayBuffer()));
      if (!text) {
        // 글자 층이 없는 PDF: 키가 있으면 화면이 페이지를 이미지로 바꿔 다시 보내도록 알린다 (TC-115)
        if (!isDemoMode()) {
          throw new ApiError("PDF_NEEDS_OCR", "PDF에 글자가 없어 페이지를 이미지로 읽어야 합니다.", 422);
        }
        throw new ApiError("PDF_NO_TEXT", `${PDF_IMAGE_ONLY_HINT} 데모 모드에서는 이미지 읽기를 쓸 수 없어요.`);
      }
      const res: PostingResponse = { text: tidy(text), source: "pdf" };
      return NextResponse.json(res);
    }

    if (images.length === 0) throw new ApiError("EMPTY_INPUT", "공고 PDF나 스크린샷을 선택해 주세요.");
    if (images.length > LIMITS.postingImageParts) {
      throw new ApiError("TOO_MANY_FILES", `스크린샷이 너무 많습니다. ${LIMITS.postingImageFiles}장 이하로 올려 주세요.`);
    }
    if (images.some((f) => !IMAGE_TYPES.includes(f.type))) {
      throw new ApiError("UNSUPPORTED_FILE", "PNG, JPG, WEBP 이미지만 올릴 수 있어요.", 415);
    }
    if (images.reduce((n, f) => n + f.size, 0) > LIMITS.fileBytes) throw new ApiError("FILE_TOO_LARGE", tooLargeMessage(), 413);

    if (isDemoMode()) {
      throw new ApiError(
        "DEMO_UNAVAILABLE",
        "데모 모드에서는 스크린샷 읽기를 쓸 수 없어요. 공고를 붙여넣거나 PDF로 저장해 올려 주세요.",
        403,
      );
    }

    const dataUrls = await Promise.all(
      images.map(async (f) => `data:${f.type};base64,${Buffer.from(await f.arrayBuffer()).toString("base64")}`),
    );
    const text = await generateFromImages(loadPrompt("posting-ocr", PROMPT_VERSION.postingOcr), dataUrls);
    if (/^NOT_A_POSTING\b/.test(text.trim())) {
      throw new ApiError("NOT_POSTING", "채용공고 화면으로 보이지 않습니다. 공고 본문이 보이게 캡처해 주세요.", 422);
    }
    const res: PostingResponse = { text: tidy(text), source: "image" };
    return NextResponse.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}

/** 추출한 글의 공백 정리: 줄 끝 공백, 3줄 이상 빈 줄, 코드 블록 표시 제거 */
function tidy(text: string): string {
  return text
    .replace(/^```[a-z]*\n?|```$/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
