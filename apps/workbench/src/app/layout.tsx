import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
// The SDK stylesheet supplies the --sw-* token layer and the shared control chrome that the
// shell's CommandButton relies on; shell.css adds only workbench layout.
import "@ikhmalputra/subsurface-react/styles.css";
import "@ikhmalputra/subsurface-shell/shell.css";
import "./workbench.css";

export const metadata: Metadata = {
  title: "Subsurface Workbench",
  description: "Front-end visualization for subsurface records the host already owns.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en"><body>{children}</body></html>;
}
