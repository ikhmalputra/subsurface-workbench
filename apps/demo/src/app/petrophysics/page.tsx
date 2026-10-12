import type { Metadata } from "next";
import { Suspense } from "react";
import { ForwardToSheet } from "../../components/tools";

export const metadata: Metadata = { title: "Subsurface Workbench" };

/** This was a page; it is a document on the sheet now. The URL forwards there with its query. */
export default function ForwardPage() {
  return <Suspense fallback={null}><ForwardToSheet document="petrophysics" /></Suspense>;
}
