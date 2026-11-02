import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * prompts/<target>-<version>.md 를 읽어 {{변수}}를 채운다.
 * 앱(API 라우트)과 평가 스크립트가 같은 파일을 쓰도록 한 곳에서 관리한다.
 */

export type PromptTarget = "question" | "experience" | "answer" | "interviewer" | "interview-feedback" | "posting-ocr" | "resume-structure";

export function promptPath(target: PromptTarget, version: string): string {
  return path.join(process.cwd(), "prompts", `${target}-${version}.md`);
}

export function loadPrompt(target: PromptTarget, version: string): string {
  const raw = readFileSync(promptPath(target, version), "utf8");
  // 파일 맨 위 변경 기록 주석(<!-- ... -->)은 모델에게 보내지 않는다
  return raw.replace(/<!--[\s\S]*?-->/g, "").trim();
}

export function fillPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`프롬프트 변수 {{${key}}}에 넣을 값이 없습니다.`);
    return vars[key];
  });
}
