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
import { Deck } from "./deck/Deck.tsx";

createRoot(document.getElementById("root")!).render(<StrictMode><Deck /></StrictMode>);
