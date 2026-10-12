import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@ikhmalputra/subsurface-react/styles.css";
import "@ikhmalputra/subsurface-react/gis.css";
import "@ikhmalputra/subsurface-shell/shell.css";
import "./showcase.css";
import { WorkspaceProvider } from "../components/workspace-provider";
import { WorkbenchFrame } from "../components/workbench-frame";

export const metadata: Metadata = {
  title: "Subsurface SDK · showcase",
  description: "Consumable well-engineering visuals: 2.5D construction, PNP well builder, 3D trajectory and curved sections.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      {/* The frame is mounted here, not inside the pages: a layout is cached across navigation,
          so the workbench, its navigation and its panel state outlive the route content. */}
      <body><WorkspaceProvider><WorkbenchFrame>{children}</WorkbenchFrame></WorkspaceProvider></body>
    </html>
  );
}
