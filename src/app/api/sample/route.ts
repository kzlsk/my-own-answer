import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { maskPersonalInfo } from "@/lib/mask";
import { errorResponse } from "@/lib/api-error";
import { demoInput } from "@/lib/demo";
import type { SampleResponse } from "@/lib/flow-types";

export const runtime = "nodejs";

/** "샘플로 체험하기": 가상 이력서(r03)와 공개 공고(p03)를 입력 칸에 채운다 */
export function GET() {
  try {
    const dir = path.join(process.cwd(), "data");
    const resumeFile = readFileSync(path.join(dir, "resumes", `${demoInput.resumeId}.md`), "utf8").replace(/\r\n/g, "\n");
    const experience = resumeFile.match(/^##\s*경험 답변\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1].trim() ?? "";
    const resumeRaw = resumeFile
      .replace(/^##\s*경험 답변[\s\S]*$/m, "") // 경험 답변은 사용자가 직접 입력하는 단계라 뺀다
      .split("\n")
      .filter((l) => !/^#\s/.test(l) && !/^>\s/.test(l))
      .join("\n")
      .trim();
    const posting = readFileSync(path.join(dir, "postings", `${demoInput.postingId}.md`), "utf8")
      .replace(/\r\n/g, "\n")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();
    const masked = maskPersonalInfo(resumeRaw);
    const res: SampleResponse = {
      resume: { fileName: "샘플 이력서 (가상 인물, QA)", text: masked.text, counts: masked.counts, chars: masked.text.length },
      rawResume: resumeRaw,
      posting,
      label: "가상 QA 이력서 × 우아한형제들 QA 공고",
      sampleExperience: maskPersonalInfo(experience).text,
    };
    return NextResponse.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
