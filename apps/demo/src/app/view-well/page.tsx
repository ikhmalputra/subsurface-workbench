import type { Metadata } from "next";
import { DemoPage } from "../../components/showcase";
import { Sheet } from "../../components/sheet";

export const metadata: Metadata = { title: "Subsurface Workbench" };

/**
 * The one page. Everything on it is a panel: the well section is the document that opens here by
 * default, `?tool=` opens another, and the ribbon, palette and command line open the rest.
 */
export default function SheetPage() {
  return <DemoPage current="/view-well/"><Sheet /></DemoPage>;
}
