import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@ikhmalputra/subsurface-react/styles.css";
import "@ikhmalputra/subsurface-react/gis.css";
import "./styles/deck.css";
import "./styles/frame-drilling-integrity.css";
import "./styles/frame-production.css";
import "./styles/frame-engineering.css";
import "./styles/frame-petro-rig.css";
import "./styles/frame-design.css";
import { Deck } from "./deck/Deck.tsx";

createRoot(document.getElementById("root")!).render(<StrictMode><Deck /></StrictMode>);
