"use client";

import { LIMITS, isImageFile } from "@/lib/limits";
import { ClientError } from "@/lib/client-api";

/**
 * 공고 스크린샷을 보내기 전에 브라우저에서 줄이고 자른다.
 * - 가로를 최대 1,400px로 줄여 용량을 낮춘다 (Vercel 요청 크기 제한)
 * - 세로로 긴 캡처는 768px 높이로 잘라서 보낸다. OpenAI는 detail:high 이미지의 짧은 변을 768px로 줄이므로,
 *   조각 높이가 768px를 넘으면 조각 전체가 다시 줄어 글자가 작아진다 (1,400×1,800 조각은 글자가 55% 크기가 됨, BUG-007)
 * - 자른 경계의 줄이 잘리지 않게 조각끼리 60px씩 겹친다 (중복 줄은 OCR 프롬프트에서 한 번만 적게 함)
 * - 거의 흰 조각은 빼서 비용과 조각 수를 아낀다
 */

const MAX_WIDTH = 1400;
/** OpenAI가 짧은 변을 줄이는 기준. 조각 높이를 이 이하로 두면 보낸 크기 그대로 읽는다 */
export const PART_HEIGHT = 768;
const OVERLAP = 60;
const QUALITY = 0.85;

/** 거의 흰 조각(페이지 아래 여백 등)은 보내지 않는다. 어두운 픽셀이 0.5% 미만이면 빈 조각으로 본다 */
function isMostlyBlank(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = ctx.getImageData(0, 0, width, height);
  let dark = 0;
  const step = 16; // 4픽셀마다 하나씩만 본다 (RGBA 4바이트 × 4)
  for (let i = 0; i < data.length; i += step) {
    if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) dark++;
  }
  return dark / (data.length / step) < 0.005;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", QUALITY),
  );
}

export function validateScreenshots(files: File[]): string | null {
  if (files.length === 0) return "스크린샷을 선택해 주세요.";
  if (files.length > LIMITS.postingImageFiles) return `스크린샷은 ${LIMITS.postingImageFiles}장까지 올릴 수 있어요.`;
  if (files.some((f) => !isImageFile(f.name))) return "PNG, JPG, WEBP 이미지만 올릴 수 있어요.";
  return null;
}

export async function prepareScreenshots(files: File[]): Promise<Blob[]> {
  const parts: Blob[] = [];
  for (const file of files) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new ClientError("BAD_IMAGE", `이미지를 열지 못했습니다: ${file.name}`);
    }
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    for (let top = 0; top < height; top += PART_HEIGHT - OVERLAP) {
      const h = Math.min(PART_HEIGHT, height - top);
      if (top > 0 && h <= OVERLAP) break; // 겹침 부분만 남은 조각은 버린다
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new ClientError("BAD_IMAGE", "이미지를 처리하지 못했습니다.");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, h);
      // 원본 좌표 기준으로 잘라서 줄인 크기로 그린다
      ctx.drawImage(bitmap, 0, top / scale, bitmap.width, h / scale, 0, 0, width, h);
      if (!isMostlyBlank(ctx, width, h)) parts.push(await toBlob(canvas));
      if (top + h >= height) break;
    }
    bitmap.close();
  }

  if (parts.length === 0) throw new ClientError("BAD_IMAGE", "이미지에서 내용을 찾지 못했습니다. 공고 본문이 보이게 다시 캡처해 주세요.");
  if (parts.length > LIMITS.postingImageParts) {
    throw new ClientError("TOO_MANY_FILES", "공고가 너무 깁니다. 핵심 부분(업무·자격요건·우대사항)만 캡처해 주세요.");
  }
  if (parts.reduce((n, b) => n + b.size, 0) > LIMITS.fileBytes) {
    throw new ClientError("FILE_TOO_LARGE", "스크린샷 용량이 너무 큽니다. 장수를 줄여 주세요.");
  }
  return parts;
}
