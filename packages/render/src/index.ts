/**
 * three.js for the subsurface packages: the frame, and the construction as objects.
 *
 * Everything about *where* a part goes was decided in `@ikhmalputra/subsurface-scene`, headless and
 * tested. This layer only turns those answers into a scene graph, so the 2D drawings and the 3D one
 * cannot drift apart — they read the same placements.
 *
 * three.js is a peer dependency: importing a 2D view must never pull a 3D runtime.
 */
export * from "./frame.ts";
export * from "./assembly.ts";
