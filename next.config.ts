import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // API 라우트가 실행 중에 읽는 파일을 배포 번들에 포함시킨다 (Vercel)
  outputFileTracingIncludes: {
    "/api/**": ["./prompts/**/*", "./data/resumes/r03-qa.md", "./data/postings/p03-qa.md"],
  },
};

export default nextConfig;
