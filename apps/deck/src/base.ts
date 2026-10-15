/**
 * Where the site is served from: "/" locally, "/subsurface-workbench/" on GitHub Pages. Vite sets
 * it from `base` (DECK_BASE at build time); every path to a page, a model or a data file goes
 * through it so the same build works at a domain's root or in a subfolder.
 */
export const BASE = import.meta.env.BASE_URL;
