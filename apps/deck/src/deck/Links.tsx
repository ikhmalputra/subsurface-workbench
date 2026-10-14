import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { ModuleId, Signal } from "../modules/registry.ts";
import { moduleById, signalColour, signalName } from "../modules/registry.ts";
import type { Origin, Pulse } from "./store.ts";
import { actions, openIds, useDeck } from "./store.ts";
import { TRAVEL_MS } from "./Tile.tsx";

interface Point { readonly x: number; readonly y: number }

/** Where a signal leaves or lands: a tile's centre, or the deck chrome that sent it. */
function anchor(origin: Origin): Point | null {
  const element = document.querySelector(origin === "rail" || origin === "clock" || origin === "bar" ? `[data-origin='${origin}']` : `[data-module='${origin}']`);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  if (origin === "rail" || origin === "clock") return { x: box.left + box.width / 2, y: box.top };
  if (origin === "bar") return { x: box.left + box.width / 2, y: box.bottom };
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** A gentle curve between two points, bowed to one side; lanes keep parallel signals apart. */
function arc(p: Point, q: Point, lane = 0) {
  const dx = q.x - p.x, dy = q.y - p.y, distance = Math.hypot(dx, dy) || 1;
  const bow = distance * 0.12 + lane * 14;
  const mx = (p.x + q.x) / 2 - dy / distance * bow, my = (p.y + q.y) / 2 + dx / distance * bow;
  return `M${p.x.toFixed(1)},${p.y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${q.x.toFixed(1)},${q.y.toFixed(1)}`;
}

/** A dot that runs the path once, then the stroke fades: SMIL, started when it mounts. */
function Traveller({ d, colour }: { readonly d: string; readonly colour: string }) {
  const motionRef = useRef<SVGAnimateMotionElement>(null);
  useEffect(() => { motionRef.current?.beginElement(); }, []);
  return <motion.circle r={4.5} fill={colour} className="link-dot" style={{ color: colour }} initial={{ opacity: 1 }} animate={{ opacity: [1, 1, 0] }} transition={{ duration: 0.7, times: [0, TRAVEL_MS / 700, 1] }}>
    <animateMotion ref={motionRef} dur={`${TRAVEL_MS}ms`} begin="indefinite" fill="freeze" path={d} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.3 0 0.2 1" />
  </motion.circle>;
}

function PulseLinks({ pulse }: { readonly pulse: Pulse }) {
  const [paths, setPaths] = useState<readonly { to: ModuleId; d: string }[]>([]);
  useLayoutEffect(() => {
    const from = anchor(pulse.from);
    if (!from) return;
    setPaths(pulse.to.flatMap((to) => { const end = anchor(to); return end ? [{ to, d: arc(from, end) }] : []; }));
  }, [pulse]);
  const colour = signalColour[pulse.signal];
  return <g data-pulse={pulse.signal} data-from={pulse.from}>
    {paths.map(({ to, d }) => <g key={to}>
      <motion.path d={d} stroke={colour} style={{ color: colour }} className="link-stroke" initial={{ pathLength: 0, opacity: 0.95 }} animate={{ pathLength: [0, 1, 1], opacity: [0.95, 0.95, 0] }} transition={{ duration: 0.9, times: [0, TRAVEL_MS / 900, 1], ease: "easeOut" }} />
      <Traveller d={d} colour={colour} />
    </g>)}
  </g>;
}

/** Every live connection between open modules: what each sends that another listens to. */
function PatchBay() {
  const tiles = useDeck((deck) => deck.tiles);
  const [links, setLinks] = useState<readonly { key: string; d: string; signal: Signal; both: boolean }[]>([]);
  const [nodes, setNodes] = useState<readonly { id: ModuleId; at: Point }[]>([]);
  useLayoutEffect(() => {
    const open = openIds(tiles);
    const lanes: Signal[] = ["place", "object", "depth", "view", "time", "whatif"];
    // One line per pair and signal; a signal that flows both ways is one line, not two.
    const pairs = new Map<string, { a: ModuleId; b: ModuleId; signal: Signal; both: boolean }>();
    for (const from of open) for (const signal of moduleById[from].emits) for (const to of open) {
      if (to === from || !moduleById[to].listens.includes(signal)) continue;
      const [a, b] = from < to ? [from, to] : [to, from];
      const key = `${a}-${b}-${signal}`;
      const known = pairs.get(key);
      pairs.set(key, known ? { ...known, both: known.both || known.a !== from } : { a: from, b: to, signal, both: false });
    }
    const at = new Map(open.map((id) => [id, anchor(id)] as const));
    setNodes(open.flatMap((id) => { const point = at.get(id); return point ? [{ id, at: point }] : []; }));
    setLinks([...pairs.entries()].flatMap(([key, link]) => {
      const p = at.get(link.a), q = at.get(link.b);
      return p && q ? [{ key, d: arc(p, q, lanes.indexOf(link.signal) - 1), signal: link.signal, both: link.both }] : [];
    }));
  }, [tiles]);
  return <g className="patch">
    {links.map((link) => <path key={link.key} d={link.d} stroke={signalColour[link.signal]} className="patch-stroke" data-link={link.key} data-both={link.both || undefined} />)}
    {nodes.map((node) => <g key={node.id} className="patch-node" transform={`translate(${node.at.x.toFixed(1)} ${node.at.y.toFixed(1)})`}>
      <circle r={5} /><text y={-12} textAnchor="middle">{moduleById[node.id].title}</text>
    </g>)}
  </g>;
}

/** What the patch bay is showing, counted by signal. */
function PatchLegend() {
  const tiles = useDeck((deck) => deck.tiles);
  const open = openIds(tiles);
  const counts: Partial<Record<Signal, number>> = {};
  const seen = new Set<string>();
  for (const from of open) for (const signal of moduleById[from].emits) for (const to of open) {
    if (to === from || !moduleById[to].listens.includes(signal)) continue;
    const key = `${from < to ? from : to}-${from < to ? to : from}-${signal}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[signal] = (counts[signal] ?? 0) + 1;
  }
  return <div className="patch-legend" role="status">
    <b>Patch bay</b><span>{seen.size} live links between {open.length} modules</span>
    {(Object.keys(counts) as Signal[]).map((signal) => <span key={signal} className="patch-key" style={{ ["--dot" as string]: signalColour[signal] }}><i />{signalName[signal]} {counts[signal]}</span>)}
    <span className="patch-hint">release ⌥</span>
  </div>;
}

/**
 * The deck shows its own causality. A signal leaving a module travels to every module that listens,
 * as a pulse in the signal's colour; holding ⌥ shows every connection at once, like a patch bay.
 */
export function Links() {
  const pulses = useDeck((deck) => deck.pulses);
  const patch = useDeck((deck) => deck.patch);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    const onKey = (event: KeyboardEvent) => { if (event.key === "Alt") { event.preventDefault(); actions.setPatch(event.type === "keydown"); } };
    const off = () => actions.setPatch(false);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", off);
    return () => { window.removeEventListener("resize", onResize); window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKey); window.removeEventListener("blur", off); };
  }, []);
  return <>
    <svg className="links" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true" data-patch={patch || undefined}>
      {pulses.map((pulse) => <PulseLinks key={pulse.id} pulse={pulse} />)}
      {patch && <PatchBay />}
    </svg>
    {patch && <PatchLegend />}
  </>;
}
