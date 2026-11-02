"use client";

import { ClientError } from "@/lib/client-api";

/**
 * 글자 층이 없는 PDF(예: 'Microsoft Print to PDF'로 저장한 공고)를 브라우저에서 페이지 이미지로 바꾼다.
 * 결과는 스크린샷과 같은 경로(prepareScreenshots → /api/posting images)로 보낸다.
 */

export const PDF_OCR_MAX_PAGES = 4;

export async function pdfToPageImages(file: File): Promise<{ images: File[]; totalPages: number }> {
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new ClientError("PDF_UNREADABLE", "PDF를 열지 못했습니다. 스크린샷으로 올려 주세요.");
  }
  const totalPages = pdf.numPages;
  const images: File[] = [];
  for (let n = 1; n <= Math.min(totalPages, PDF_OCR_MAX_PAGES); n++) {
    try {
      const png = await renderPageAsImage(pdf, n, { width: 1400 });
      images.push(new File([png], `page-${n}.png`, { type: "image/png" }));
    } catch {
      throw new ClientError("PDF_UNREADABLE", "PDF 페이지를 이미지로 바꾸지 못했습니다. 스크린샷으로 올려 주세요.");
    }
  }
  return { images, totalPages };
}

/** PDF의 글자 층을 브라우저에서 뽑는다. 글자가 없으면(그림으로만 된 PDF) 빈 문자열 */
export async function pdfFileToText(file: File): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });
    return text.replace(/\s/g, "").length < 20 ? "" : text;
  } catch {
    throw new ClientError("PDF_UNREADABLE", "PDF를 열지 못했습니다. 파일이 손상되지 않았는지 확인하거나 내용을 붙여넣어 주세요.");
  }
}
