/** 화면과 서버가 같은 기준으로 검사하도록 한 곳에 모은 입력 제한 */

export const LIMITS = {
  // Vercel 함수는 요청 본문이 4.5MB를 넘으면 거부하므로 업로드는 4MB로 맞춘다
  fileBytes: 4 * 1024 * 1024,
  fileLabel: "4MB",
  // 이력서는 브라우저에서 글자만 뽑아 보내므로(원본 파일은 서버로 가지 않음) Vercel 한도와 무관하다
  resumeFileBytes: 10 * 1024 * 1024,
  resumeFileLabel: "10MB",
  maskWords: 20,
  resumeChars: 15_000,
  postingChars: 8_000, // TC-107
  postingMinChars: 100,
  experienceChars: 3_000,
  experienceMinChars: 10,
  // 공고 스크린샷: 브라우저에서 줄이고 잘라서 보낸 조각 수
  postingImageFiles: 5,
  postingImageParts: 16, // 조각 높이를 768px로 낮춰(BUG-007) 조각 수가 늘었다. A4 4쪽 = 12조각
} as const;

export const ACCEPTED_EXTENSIONS = [".pdf", ".txt", ".md"] as const;
export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;

export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i === -1 ? "" : fileName.slice(i).toLowerCase();
}

export function isAcceptedFile(fileName: string): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

export function isImageFile(fileName: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

export const tooLargeMessage = (label: string = LIMITS.fileLabel) => `파일이 너무 큽니다. ${label} 이하로 올려 주세요.`;

export const formatNumber = (n: number) => n.toLocaleString("ko-KR");
