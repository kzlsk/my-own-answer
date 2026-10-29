import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "my-own-answer — 내 경험으로 준비하는 면접",
  description:
    "이력서와 채용공고로 예상 질문을 만들고, 내 경험만으로 답변을 준비하는 면접 준비 서비스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
