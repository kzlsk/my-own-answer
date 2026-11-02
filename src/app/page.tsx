import PrepFlow from "@/components/PrepFlow";
import { isDemoMode } from "@/lib/openai";

export const dynamic = "force-dynamic";

export default function Home() {
  return <PrepFlow demoMode={isDemoMode()} />;
}
