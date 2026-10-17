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
import { loadDeckConfig } from "./data/catalogue.ts";
import { completeSignInIfCallback } from "./auth/oidc.ts";
import { BASE } from "./base.ts";
import { startUpdateWatch } from "./deck/version.ts";

// The config names the identity providers, and a load may be the provider sending the person back:
// both are settled before the deck draws, so no module ever sees a half-signed-in state.
await loadDeckConfig();
await completeSignInIfCallback();
// A release rolled out under an open tab is announced in the lens bar (version.json on this origin only).
startUpdateWatch({ base: BASE });
const { Deck } = await import("./deck/Deck.tsx");
createRoot(document.getElementById("root")!).render(<StrictMode><Deck /></StrictMode>);
