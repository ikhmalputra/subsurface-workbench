import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@ikhmalputra/subsurface-react/styles.css";
import "../landing/landing.css";
import "./developers.css";
import { Developers } from "./Developers.tsx";

createRoot(document.getElementById("root")!).render(<StrictMode><Developers /></StrictMode>);
