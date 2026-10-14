/**
 * Where a rendered component goes on a well, without any renderer.
 *
 * The 3D scene and the 2D schematic both have to answer the same question — which model, at what
 * point on the path, pointing which way, at what size — and in the previous design each answered it
 * separately. This is that answer, once, headless and testable, so the two agree by construction.
 *
 * It depends on three.js nowhere. A renderer consumes a `Placement`; it does not produce one.
 */
export * from "./catalogue.ts";
export * from "./place.ts";
