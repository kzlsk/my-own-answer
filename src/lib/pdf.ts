import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { ApiError } from "@/lib/api-error";

/**
 * PDF에서 글자 층을 뽑는다. 손상된 PDF는 실패, 글자 층이 없으면(그림으로만 된 PDF) 빈 문자열.
 * 글자가 없을 때 어떻게 할지는 부르는 쪽이 정한다.
 */
export async function pdfToText(buffer: Uint8Array): Promise<string> {
  try {
    const pdf = await getDocumentProxy(buffer);
    const { text } = await extractText(pdf, { mergePages: true });
    return text.replace(/\s/g, "").length < 20 ? "" : text;
  } catch {
    throw new ApiError("PDF_UNREADABLE", "PDF를 읽지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.");
  }
}

/** 'Microsoft Print to PDF'처럼 페이지를 그림으로 저장하는 프린터를 쓰면 글자 층이 없다 */
export const PDF_IMAGE_ONLY_HINT =
  "이 PDF에는 글자가 없고 그림만 있어요. 인쇄 창의 대상이 'Microsoft Print to PDF'였다면 'PDF로 저장'으로 바꿔 다시 저장해 주세요.";
