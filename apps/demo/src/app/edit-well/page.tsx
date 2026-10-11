import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoPage } from "../../components/showcase";
import { EditWellDemo } from "../../components/edit-well-demo";

export const metadata: Metadata = { title: "Edit well · Subsurface SDK" };

export default function EditWellPage() {
  return <DemoPage current="/edit-well/">
    <Suspense fallback={<p role="status">Loading well editor...</p>}>
      <EditWellDemo />
    </Suspense>
  </DemoPage>;
}
