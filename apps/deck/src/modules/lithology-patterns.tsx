import type { ReactNode } from "react";
import { LITHOLOGY } from "../data/force-model.ts";

/**
 * The lithology classes as geological map patterns, after the conventions of the FGDC Digital
 * Cartographic Standard for Geologic Map Symbolization: sandstone stippled, shale dashed, limestone
 * in brick, dolomite in slanted brick, halite crossed, anhydrite hatched, coal solid, basement in
 * crosses, each over its class colour. Place <LithologyPatterns /> once in an SVG; fill with
 * `lithologyFill(code)`.
 */
const INK = "rgba(20, 22, 30, .55)";
const marks: readonly ((ink: string) => ReactNode)[] = [
  // 0 Sandstone: stipple.
  (ink) => <>{[[2, 2], [7, 5], [4, 8], [9, 1], [1, 6]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r={0.7} fill={ink} />)}</>,
  // 1 Sandstone/shale: stipple with a dash.
  (ink) => <><circle cx={2} cy={2} r={0.7} fill={ink} /><circle cx={7} cy={2} r={0.7} fill={ink} /><line x1={1} x2={8} y1={7} y2={7} stroke={ink} strokeWidth={0.8} /></>,
  // 2 Shale: offset dashes.
  (ink) => <><line x1={0} x2={5} y1={2.5} y2={2.5} stroke={ink} strokeWidth={0.8} /><line x1={5} x2={10} y1={7.5} y2={7.5} stroke={ink} strokeWidth={0.8} /></>,
  // 3 Marl: dashes over a brick joint.
  (ink) => <><line x1={0} x2={10} y1={5} y2={5} stroke={ink} strokeWidth={0.6} /><line x1={1} x2={5} y1={2.5} y2={2.5} stroke={ink} strokeWidth={0.7} /><line x1={6} x2={9} y1={7.5} y2={7.5} stroke={ink} strokeWidth={0.7} /></>,
  // 4 Dolomite: brick with slanted joints.
  (ink) => <><line x1={0} x2={10} y1={5} y2={5} stroke={ink} strokeWidth={0.7} /><line x1={0} x2={10} y1={10} y2={10} stroke={ink} strokeWidth={0.7} /><line x1={3} x2={2} y1={0} y2={5} stroke={ink} strokeWidth={0.7} /><line x1={8} x2={7} y1={5} y2={10} stroke={ink} strokeWidth={0.7} /></>,
  // 5 Limestone: brick.
  (ink) => <><line x1={0} x2={10} y1={5} y2={5} stroke={ink} strokeWidth={0.7} /><line x1={0} x2={10} y1={10} y2={10} stroke={ink} strokeWidth={0.7} /><line x1={2.5} x2={2.5} y1={0} y2={5} stroke={ink} strokeWidth={0.7} /><line x1={7.5} x2={7.5} y1={5} y2={10} stroke={ink} strokeWidth={0.7} /></>,
  // 6 Chalk: open brick.
  (ink) => <><line x1={0} x2={10} y1={5} y2={5} stroke={ink} strokeWidth={0.45} /><line x1={2.5} x2={2.5} y1={0} y2={5} stroke={ink} strokeWidth={0.45} /><line x1={7.5} x2={7.5} y1={5} y2={10} stroke={ink} strokeWidth={0.45} /></>,
  // 7 Halite: crosses.
  (ink) => <><path d="M2,2 L5,5 M5,2 L2,5 M7,6 L10,9 M10,6 L7,9" stroke={ink} strokeWidth={0.7} /></>,
  // 8 Anhydrite: hatching.
  (ink) => <path d="M0,10 L10,0 M-2,2 L2,-2 M8,12 L12,8" stroke={ink} strokeWidth={0.8} />,
  // 9 Tuff: vees.
  (ink) => <path d="M1,3 L2.5,6 L4,3 M6,6 L7.5,9 L9,6" stroke={ink} strokeWidth={0.7} fill="none" />,
  // 10 Coal: solid.
  () => null,
  // 11 Basement: random plus marks.
  (ink) => <path d="M2,1.5 V4.5 M0.5,3 H3.5 M7,5.5 V8.5 M5.5,7 H8.5" stroke={ink} strokeWidth={0.8} />,
];

export const lithologyFill = (code: number) => code >= 0 && code < LITHOLOGY.length ? `url(#lith-${code})` : "var(--ink-3)";

export function LithologyPatterns() {
  return <defs>
    {LITHOLOGY.map((entry, code) => <pattern key={entry.name} id={`lith-${code}`} width={10} height={10} patternUnits="userSpaceOnUse">
      <rect width={10} height={10} fill={entry.colour} />
      {marks[code]?.(code === 10 ? "#000" : INK)}
    </pattern>)}
  </defs>;
}

/** The classes a set of wells holds, each as its pattern and name; the patterns come from a <LithologyPatterns /> already on the page. */
export function LithologyLegend({ codes }: { readonly codes: readonly number[] }) {
  if (!codes.length) return null;
  return <ul className="lith-legend" aria-label="Lithology">
    {codes.map((code) => <li key={code}><svg width={22} height={14} aria-hidden="true"><rect width={22} height={14} rx={3} fill={lithologyFill(code)} /></svg>{LITHOLOGY[code]!.name}</li>)}
  </ul>;
}
