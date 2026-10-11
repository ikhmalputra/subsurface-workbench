import type { Metadata } from "next";
import { DemoPage } from "../../components/showcase";
import { AnalysisWorkspace } from "../../components/analysis-workspace";

export const metadata: Metadata = { title: "Analysis studies · Subsurface Workbench" };

export default function AnalysisPage() {
  return <DemoPage current="/analysis/"><AnalysisWorkspace /></DemoPage>;
}
