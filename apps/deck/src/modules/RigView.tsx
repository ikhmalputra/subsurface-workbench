import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { findPipe, mdAtTvd, pressureAt, tvdAtMd } from "@ikhmalputra/subsurface-core/well-design";
import { computeMinimumCurvature } from "@ikhmalputra/subsurface-core/trajectory";
import type { ComputedStation } from "@ikhmalputra/subsurface-core";
import type { DrillingSimulator, DrillReading } from "@ikhmalputra/subsurface-core/simulation";

/**
 * The rig and the hole, animated on a canvas from the simulator's readings.
 *
 * Motion is physical, not decorative: mud travels down the string and up the annulus at its real
 * velocity for the flow rate and each section's area, times the simulation speed, so at 1× the
 * annulus creeps at about a metre a second and at 600× it races; cuttings ride the annulus slower
 * than the mud (they slip) and fall back when the pumps stop; gas bubbles grow by Boyle's law as
 * the pressure on them falls; the string comes off bottom for a connection and out of the hole on
 * a trip. Rig motions (pump strokes, rotation) run at their real rate up to what the eye can follow.
 * Diameters are exaggerated against depth so the annulus can be seen; depths are to scale, and the
 * well is drawn straight (the real path is inset on the right).
 */

const GPM_TO_M3S = 6.309e-5, IN = 0.0254;
const CUTTING_SLIP_MS = 0.12, GAS_SLIP_MS = 0.3;
const steelGradient = (ctx: CanvasRenderingContext2D, x0: number, x1: number, light = 1) => {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, `rgb(${70 * light}, ${78 * light}, ${92 * light})`); g.addColorStop(0.3, `rgb(${205 * light}, ${213 * light}, ${226 * light})`);
  g.addColorStop(0.55, `rgb(${150 * light}, ${160 * light}, ${176 * light})`); g.addColorStop(1, `rgb(${55 * light}, ${62 * light}, ${76 * light})`);
  return g;
};
/** Seeded value noise on the line, smooth between integer knots. */
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const noise = (x: number) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };

type Lithology = "sand" | "shale" | "clay" | "lime" | "granite" | "other";
const lithologyOf = (words: string): Lithology => /granite|basement|igneous|metamorph/i.test(words) ? "granite" : /lime|carbonate|dolom|chalk/i.test(words) ? "lime" : /sand/i.test(words) ? "sand" : /clay|unconsolidated/i.test(words) ? "clay" : /shale|mud/i.test(words) ? "shale" : "other";
const LITHOLOGY_BASE: Readonly<Record<Lithology, string>> = { sand: "#6e5a36", shale: "#3c4656", clay: "#5a4535", lime: "#4c6676", granite: "#5e5560", other: "#454b57" };
/** A geological fill pattern: dots for sand, dashes for shale, lines for clay, bricks for limestone, crosses for granite. */
function lithologyPattern(ctx: CanvasRenderingContext2D, kind: Lithology): CanvasPattern | null {
  const size = 36, tile = document.createElement("canvas"); tile.width = tile.height = size;
  const t = tile.getContext("2d"); if (!t) return null;
  t.fillStyle = LITHOLOGY_BASE[kind]; t.fillRect(0, 0, size, size);
  const ink = "rgba(255, 245, 225, 0.22)", dark = "rgba(0, 0, 0, 0.25)";
  t.strokeStyle = ink; t.fillStyle = ink; t.lineWidth = 1;
  if (kind === "sand") for (let i = 0; i < 26; i++) { t.fillStyle = i % 3 ? ink : dark; t.beginPath(); t.arc(hash(i) * size, hash(i + 50) * size, 0.6 + hash(i + 9) * 0.7, 0, Math.PI * 2); t.fill(); }
  else if (kind === "shale") for (let row = 0; row < 6; row++) for (let col = 0; col < 3; col++) { const x = col * 12 + (row % 2) * 6, y = row * 6 + 3; t.beginPath(); t.moveTo(x, y); t.lineTo(x + 7, y); t.stroke(); }
  else if (kind === "clay") for (let row = 0; row < 9; row++) { t.globalAlpha = row % 2 ? 0.5 : 1; t.beginPath(); t.moveTo(0, row * 4 + 2); t.lineTo(size, row * 4 + 2); t.stroke(); t.globalAlpha = 1; }
  else if (kind === "lime") for (let row = 0; row < 3; row++) { const y = row * 12; t.beginPath(); t.moveTo(0, y + 0.5); t.lineTo(size, y + 0.5); for (let col = 0; col < 3; col++) { const x = col * 12 + (row % 2) * 6 + 0.5; t.moveTo(x, y); t.lineTo(x, y + 12); } t.stroke(); }
  else if (kind === "granite") for (let i = 0; i < 9; i++) { const x = hash(i + 3) * size, y = hash(i + 70) * size; t.beginPath(); if (i % 2) { t.moveTo(x - 2.5, y); t.lineTo(x + 2.5, y); t.moveTo(x, y - 2.5); t.lineTo(x, y + 2.5); } else { t.moveTo(x - 2.5, y - 2); t.lineTo(x, y + 2); t.lineTo(x + 2.5, y - 2); } t.stroke(); }
  else for (let i = 0; i < 8; i++) { const x = hash(i + 1) * size, y = hash(i + 30) * size; t.beginPath(); t.moveTo(x, y); t.lineTo(x + 5, y); t.stroke(); }
  return ctx.createPattern(tile, "repeat");
}

interface Tracer { md: number; side: -1 | 1; radial: number; kind: "annulus" | "pipe" | "cutting"; active: boolean; size: number; spin: number; settled: boolean }
interface Fall { x: number; y: number; vy: number; life: number; colour: string }

export function RigView({ simRef, running, zoomed, rate }: { readonly simRef: RefObject<DrillingSimulator | null>; readonly running: boolean; readonly zoomed: boolean; readonly rate: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ running, zoomed, rate });
  live.current = { running, zoomed, rate };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d");
    if (!context) return;
    const ctx = context;
    let width = 0, height = 0, frame = 0, last = performance.now(), clockS = 0;
    const resize = () => {
      const box = element.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(200, box.width); height = Math.max(260, box.height);
      element.width = Math.round(width * dpr); element.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    const patterns = new Map<Lithology, CanvasPattern | null>();
    const patternFor = (kind: Lithology) => { if (!patterns.has(kind)) patterns.set(kind, lithologyPattern(ctx, kind)); return patterns.get(kind) ?? null; };
    const cement = (() => { const tile = document.createElement("canvas"); tile.width = tile.height = 16; const t = tile.getContext("2d")!; t.fillStyle = "#8d929c"; t.fillRect(0, 0, 16, 16); for (let i = 0; i < 14; i++) { t.fillStyle = i % 2 ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)"; t.fillRect(hash(i + 5) * 16, hash(i + 40) * 16, 1.2, 1.2); } return ctx.createPattern(tile, "repeat"); })();

    const tracers: Tracer[] = [];
    const falls: Fall[] = [];
    const shown = { bit: 0, hole: 0, spp: 0, casing: 0, hook: 0, torque: 0, pit: 0, rams: 0, top: 0, bottom: 1, plume: 0, angle: 0, strokes: 0, drum: 0, cuttings: 0, flare: 0, bubblePhase: 0, blockY: 0 };
    let lastSim: DrillingSimulator | null = null, lastZoom: boolean | null = null;
    let path: readonly ComputedStation[] = [];
    let rugosity = new Float32Array(1);

    const reset = (sim: DrillingSimulator) => {
      path = sim.brief.trajectory?.length ? computeMinimumCurvature(sim.brief.trajectory) : [];
      // The open-hole wall: a little rough everywhere, washed out in soft rock (clay, loose sand).
      const length = Math.ceil(sim.targetMdM + 100); rugosity = new Float32Array(length);
      for (let md = 0; md < length; md++) {
        const soft = lithologyOf(formationAt(sim, md)?.lithology ?? "");
        const washout = soft === "clay" ? 0.12 : soft === "sand" ? 0.06 : 0;
        rugosity[md] = 0.035 * (noise(md / 3.1) - 0.5) + 0.03 * (noise(md / 0.9 + 40) - 0.5) + washout * noise(md / 17 + 9);
      }
      tracers.length = 0; falls.length = 0;
      for (let i = 0; i < 260; i++) tracers.push({ md: 0, side: i % 2 ? 1 : -1, radial: hash(i * 3.3), kind: "annulus", active: true, size: 1, spin: 0, settled: false });
      for (let i = 0; i < 70; i++) tracers.push({ md: 0, side: 1, radial: hash(i * 5.7), kind: "pipe", active: true, size: 1, spin: 0, settled: false });
      for (let i = 0; i < 220; i++) tracers.push({ md: 0, side: i % 2 ? 1 : -1, radial: hash(i * 7.1), kind: "cutting", active: false, size: 0.7 + hash(i * 2.9) * 0.9, spin: hash(i) * 6, settled: false });
      Object.assign(shown, { bit: 0, hole: 0, top: 0, bottom: 1, rams: 0, plume: 0, cuttings: 0, flare: 0, blockY: 0 });
      lastZoom = null;
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const sim = simRef.current;
      if (!sim) return;
      if (sim !== lastSim) { lastSim = sim; reset(sim); }
      const r: DrillReading = sim.now;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const moving = live.current.running && r.mode !== "section-td" && r.mode !== "blowout";
      const rate = moving ? live.current.rate : 0;
      const simDt = rate * dt;
      clockS += dt;

      // ---- where the string is: on bottom, picked up for a connection, or out of the hole on a trip ----
      const pickup = r.connectionProgress !== null ? 5 * Math.min(1, r.connectionProgress / 0.15, (1 - r.connectionProgress) / 0.15) : 0;
      const tripOut = r.tripProgress !== null ? 1 - Math.abs(1 - 2 * r.tripProgress) : 0;
      const bitTarget = Math.max(0, r.bitMdM - pickup - tripOut * (r.bitMdM - 5));
      const k = 1 - Math.exp(-dt * 8);
      shown.bit = shown.bit === 0 ? bitTarget : ease(shown.bit, bitTarget, k);
      shown.hole = shown.hole === 0 ? r.holeMdM : ease(shown.hole, r.holeMdM, k);
      shown.spp = ease(shown.spp, r.sppPsi, k); shown.casing = ease(shown.casing, Math.max(r.casingPsi, r.chokePsi), k);
      shown.hook = ease(shown.hook, r.hookloadKlb, k); shown.torque = ease(shown.torque, r.torqueKftLbf, k); shown.pit = ease(shown.pit, r.pitGainBbl, k);
      shown.rams = ease(shown.rams, r.mode === "shut-in" || r.mode === "killing" ? 1 : 0, 1 - Math.exp(-dt * 2.5));
      shown.plume = ease(shown.plume, r.mode === "blowout" ? 1 : 0, 1 - Math.exp(-dt * 1.2));
      // Rotation and pump strokes at their real rate, held to what the eye can follow (about 2.5 per second).
      const visible = (perSecond: number) => Math.min(perSecond * Math.max(1, rate), 2.5);
      if (moving && r.rotating) shown.angle += dt * visible(r.rpm / 60) * Math.PI * 2;
      const spm = r.flowInGpm / 8.4; // two triplex pumps, about 4.2 gal a stroke each
      if (moving && r.flowInGpm > 0) shown.strokes += dt * visible(spm / 60);
      // How full of cuttings the annulus is: drilling fast at low flow loads it.
      const loading = r.onBottom && r.flowInGpm > 0 ? Math.min(0.55, (r.ropMh / 25) * (500 / Math.max(200, r.flowInGpm)) * 0.6) : 0;
      shown.cuttings = ease(shown.cuttings, loading, 1 - Math.exp(-dt * 0.8));

      // ---- layout ----
      const rigH = Math.max(150, Math.min(250, height * 0.3));
      const surfaceY = rigH;
      const gutter = 58, panelX = Math.max(gutter + 170, width * 0.66), wellW = panelX - gutter - 14;
      const cx = gutter + wellW / 2;
      const td = Math.max(sim.targetMdM, r.holeMdM) + 40;
      const zoom = live.current.zoomed;
      const top = zoom ? Math.max(0, shown.bit - 170) : 0, bottom = zoom ? Math.max(top + 120, shown.bit + 40) : td;
      shown.top = ease(shown.top || top, top, k); shown.bottom = ease(shown.bottom === 1 ? bottom : shown.bottom, bottom, k);
      const plotH = height - surfaceY - 10;
      const y = (md: number) => surfaceY + (md - shown.top) / (shown.bottom - shown.top) * plotH;
      const mdAtY = (yy: number) => shown.top + (yy - surfaceY) / plotH * (shown.bottom - shown.top);
      const metresPerPx = (shown.bottom - shown.top) / plotH;
      const sections = [...sim.brief.sections].sort((a, b) => a.shoeMdM - b.shoeMdM);
      const set = sections.slice(0, sim.sectionIndex);
      const widest = zoom ? Math.max(sim.holeIn, sim.casingIdIn) * 1.35 : Math.max(...sections.map((s) => s.holeSizeIn), sim.holeIn);
      const inch = Math.min(wellW * 0.6, 170) / widest;
      const rad = (diameterIn: number) => Math.max(1.5, diameterIn / 2 * inch);
      const pipeR = Math.max(2.5, rad(sim.string.pipeOdIn)), pipeBore = Math.max(1, rad(sim.string.pipeIdIn)), bhaR = Math.max(pipeR + 1, rad(sim.string.bhaOdIn)), bhaBore = Math.max(0.8, rad(sim.string.bhaIdIn));
      const holeR = rad(sim.holeIn), casingIdR = rad(sim.casingIdIn);
      const wall = (md: number) => md < sim.shoeMdM ? casingIdR : holeR * (1 + (rugosity[Math.max(0, Math.min(rugosity.length - 1, Math.round(md)))] ?? 0));
      const bhaTop = shown.bit - sim.string.bhaLengthM;
      const stringR = (md: number) => md > bhaTop ? bhaR : pipeR;
      const viewTop = Math.max(0, shown.top), viewBottom = Math.min(shown.bottom, shown.hole);
      const flowing = moving && r.pumpsOn && r.flowInGpm > 0;
      const q = flowing ? r.flowInGpm * GPM_TO_M3S : 0;
      const returns = r.flowInGpm > 0 ? Math.max(0, r.flowOutGpm / r.flowInGpm) : 0;
      const annulusV = (md: number) => { const outer = md < sim.shoeMdM ? sim.casingIdIn : sim.holeIn, inner = md > bhaTop ? sim.string.bhaOdIn : sim.string.pipeOdIn; return q / (Math.PI / 4 * (outer ** 2 - inner ** 2) * IN * IN); };
      const pipeV = q / (Math.PI / 4 * (sim.string.pipeIdIn * IN) ** 2);

      ctx.clearRect(0, 0, width, height);
      ctx.save(); ctx.beginPath(); ctx.rect(gutter - 50, surfaceY, wellW + 64, height - surfaceY); ctx.clip();

      // ---- the rock, in its geological patterns, anchored to depth ----
      ctx.fillStyle = "#1a1d26"; ctx.fillRect(gutter - 50, surfaceY, wellW + 64, height - surfaceY);
      const formations = [...sim.brief.geology.formations].sort((a, b) => a.topTvdM - b.topTvdM);
      const elevation = sim.brief.datum.elevationAboveMslM ?? 0, water = sim.brief.location.waterDepthM ?? 0;
      const seaMd = water > 0 ? mdAtTvd(sim.brief, elevation) : 0, seabedMd = water > 0 ? mdAtTvd(sim.brief, elevation + water) : 0;
      const anchor = new DOMMatrix().translateSelf(0, (surfaceY - shown.top / metresPerPx) % 36);
      formations.forEach((f, i) => {
        const fromMd = Math.max(seabedMd, mdAtTvd(sim.brief, f.topTvdM)), toMd = formations[i + 1] ? mdAtTvd(sim.brief, formations[i + 1]!.topTvdM) : td + 1000;
        const y0 = Math.max(surfaceY, y(fromMd)), y1 = Math.min(height, y(toMd));
        if (y1 <= y0) return;
        const pattern = patternFor(lithologyOf(f.lithology));
        pattern?.setTransform(anchor);
        ctx.fillStyle = pattern ?? LITHOLOGY_BASE.other; ctx.fillRect(gutter - 50, y0, wellW + 64, y1 - y0);
        ctx.fillStyle = "rgba(8, 11, 20, 0.35)"; ctx.fillRect(gutter - 50, y0, wellW + 64, y1 - y0);
        ctx.strokeStyle = "rgba(0, 0, 0, 0.5)"; ctx.beginPath(); ctx.moveTo(gutter - 50, y0); ctx.lineTo(gutter + wellW + 14, y0); ctx.stroke();
        if (y1 - y0 > 15) { ctx.fillStyle = f.reservoir ? "#fbbf24" : "rgba(226, 232, 240, 0.8)"; ctx.font = "500 10.5px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "left"; ctx.fillText(f.name, cx + Math.max(holeR, rad(set[0]?.holeSizeIn ?? sim.holeIn)) + 16, y0 + 13); }
      });
      // Sea water, the seabed and the platform's jacket, offshore.
      if (water > 0 && y(seabedMd) > surfaceY) {
        const s0 = Math.max(surfaceY, y(seaMd)), s1 = y(seabedMd);
        const sea = ctx.createLinearGradient(0, s0, 0, s1); sea.addColorStop(0, "#12406a"); sea.addColorStop(1, "#071a30");
        ctx.fillStyle = sea; ctx.fillRect(gutter - 50, s0, wellW + 64, s1 - s0);
        if (sim.brief.location.environment === "offshore-platform") {
          ctx.strokeStyle = "#6b7790"; ctx.lineWidth = 2;
          const legs = [-1, 1].map((side) => cx + side * Math.max(60, holeR * 3));
          for (const x of legs) { ctx.beginPath(); ctx.moveTo(x, Math.max(surfaceY, y(0))); ctx.lineTo(x + Math.sign(x - cx) * 14, s1); ctx.stroke(); }
          ctx.lineWidth = 1; for (let i = 0; i < 4; i++) { const ya = s0 + (s1 - s0) * i / 4, yb = s0 + (s1 - s0) * (i + 1) / 4; ctx.beginPath(); ctx.moveTo(legs[0]!, ya); ctx.lineTo(legs[1]!, yb); ctx.moveTo(legs[1]!, ya); ctx.lineTo(legs[0]!, yb); ctx.stroke(); }
        }
        ctx.strokeStyle = "rgba(150, 200, 240, 0.55)"; ctx.lineWidth = 1; ctx.beginPath();
        for (let x = gutter - 50; x < gutter + wellW + 14; x += 4) ctx.lineTo(x, s0 + Math.sin(x / 11 + clockS * 1.3) * 1.4 + Math.sin(x / 4 - clockS * 2.1) * 0.5);
        ctx.stroke();
        ctx.fillStyle = "#3a2e22"; ctx.fillRect(gutter - 50, s1 - 1, wellW + 64, 3);
      }

      // ---- the hole: each casing string as set, with its cement; then today's open hole ----
      const mudColour = "#5c4c3b";
      for (const [index, s] of set.entries()) {
        const fromMd = index ? set[index - 1]!.shoeMdM : 0;
        const holeHere = rad(s.holeSizeIn), od = rad(s.odIn), id = Math.max(1, od - Math.max(1.2, (s.odIn - (findPipe(s.odIn, s.weightLbFt)?.idIn ?? s.odIn - 0.8)) / 2 * inch));
        const y0 = Math.max(surfaceY, y(Math.max(fromMd, seabedMd))), y1 = Math.min(height, y(s.shoeMdM));
        if (y1 > y0) { ctx.fillStyle = mudColour; ctx.fillRect(cx - holeHere, y0, holeHere * 2, y1 - y0); }
        const toc = Math.max(0, s.cement?.topMdM ?? s.shoeMdM);
        const c0 = Math.max(surfaceY, y(toc)), c1 = Math.min(height, y(s.shoeMdM));
        if (c1 > c0 && cement) {
          cement.setTransform(anchor);
          ctx.fillStyle = cement;
          for (let yy = c0; yy < c1; yy += 2) { const md = mdAtY(yy), outer = md < fromMd ? rad(index ? set[index - 1]!.odIn : s.holeSizeIn) - 1 : holeHere; ctx.fillRect(cx - outer, yy, outer - od, 2.2); ctx.fillRect(cx + od, yy, outer - od, 2.2); }
        }
        const t0 = Math.max(surfaceY, y(0)), t1 = Math.min(height, y(s.shoeMdM));
        if (t1 > t0) {
          ctx.fillStyle = steelGradient(ctx, cx - od, cx - id, 0.85); ctx.fillRect(cx - od, t0, od - id, t1 - t0);
          ctx.fillStyle = steelGradient(ctx, cx + id, cx + od, 0.85); ctx.fillRect(cx + id, t0, od - id, t1 - t0);
          const coupling = 12.2 / metresPerPx;
          if (coupling > 6) for (let md = Math.ceil(mdAtY(t0) / 12.2) * 12.2; md < s.shoeMdM; md += 12.2) { const yy = y(md); ctx.fillStyle = "#c9d1de"; ctx.fillRect(cx - od - 1.5, yy, 1.5, Math.max(1, 0.25 / metresPerPx)); ctx.fillRect(cx + od, yy, 1.5, Math.max(1, 0.25 / metresPerPx)); }
          if (y(s.shoeMdM) < height) { ctx.fillStyle = "#d8dee9"; const ys = y(s.shoeMdM); ctx.beginPath(); ctx.moveTo(cx - od - 2, ys - 6); ctx.lineTo(cx - id, ys); ctx.lineTo(cx - od - 2, ys); ctx.fill(); ctx.beginPath(); ctx.moveTo(cx + od + 2, ys - 6); ctx.lineTo(cx + id, ys); ctx.lineTo(cx + od + 2, ys); ctx.fill(); }
        }
      }
      // Inside the casing and the open hole: mud. The open-hole wall is rough, washed out in soft rock.
      const openTop = Math.max(surfaceY, y(sim.shoeMdM)), openBottom = Math.min(height, y(shown.hole));
      ctx.fillStyle = mudColour;
      ctx.fillRect(cx - casingIdR, Math.max(surfaceY, y(0)), casingIdR * 2, Math.max(0, Math.min(height, y(sim.shoeMdM)) - Math.max(surfaceY, y(0))));
      if (openBottom > openTop) {
        ctx.beginPath(); ctx.moveTo(cx - wall(sim.shoeMdM + 1), openTop);
        for (let yy = openTop; yy <= openBottom; yy += 2) ctx.lineTo(cx - wall(mdAtY(yy)), yy);
        ctx.lineTo(cx - holeR * 0.9, openBottom + 3); ctx.lineTo(cx + holeR * 0.9, openBottom + 3);
        for (let yy = openBottom; yy >= openTop; yy -= 2) ctx.lineTo(cx + wall(mdAtY(yy)), yy);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "rgba(0, 0, 0, 0.55)"; ctx.lineWidth = 1.2; ctx.stroke();
      }
      // Kill mud coming up the annulus from the bit.
      if (r.kill && r.kill.annulusFraction > 0) {
        const front = shown.bit * (1 - r.kill.annulusFraction);
        ctx.fillStyle = "rgba(193, 135, 58, 0.85)";
        for (let yy = Math.max(surfaceY, y(front)); yy < Math.min(height, y(shown.bit)); yy += 2) { const md = mdAtY(yy), w = wall(md); ctx.fillRect(cx - w, yy, w * 2, 2.2); }
      }

      // ---- the mud moving: tracers at the real annular velocity, cuttings slipping, both stopping with the pumps ----
      if (zoom !== lastZoom) { lastZoom = zoom; for (const t of tracers) { t.md = viewTop + hash(t.radial * 91 + t.size) * Math.max(1, Math.min(viewBottom, shown.bit) - viewTop); t.settled = false; if (t.kind === "cutting") t.active = false; } }
      const span = Math.max(1, Math.min(viewBottom, shown.bit) - viewTop);
      const activeCuttings = tracers.filter((t) => t.kind === "cutting" && t.active && t.md >= viewTop && t.md <= shown.bit).length;
      const wantCuttings = Math.round(shown.cuttings * 220);
      for (const t of tracers) {
        const before = t.md;
        if (t.kind === "annulus") { t.md -= annulusV(t.md) * returns * simDt; if (t.md < viewTop) t.md += span; }
        else if (t.kind === "pipe") { t.md += pipeV * simDt; if (t.md > Math.min(viewBottom, shown.bit)) t.md -= span; }
        else if (t.active) {
          if (flowing) { t.settled = false; t.md -= Math.max(0, annulusV(t.md) * returns - CUTTING_SLIP_MS) * simDt; }
          else if (!t.settled) { t.md += CUTTING_SLIP_MS * simDt; }
          if (t.md >= shown.bit - 0.3) { t.md = shown.bit - 0.3 - hash(t.size * 13) * 1.5 * (zoom ? 1 : 4); t.settled = !flowing; }
          if (t.md < viewTop) { t.active = false; if (viewTop <= 0.5) falls.push({ x: 0, y: 0, vy: 0, life: 1, colour: "#b08d4f" }); }
          t.spin += dt * 3;
        } else if (activeCuttings < wantCuttings && flowing && hash(clockS * 1000 + t.radial) < 0.08) {
          t.active = true; t.settled = false; t.md = shown.bit <= viewBottom + 1 ? shown.bit - 0.5 : viewBottom; t.radial = Math.random(); t.side = Math.random() < 0.5 ? -1 : 1;
        }
        if (t.kind === "cutting" && !t.active) continue;
        if (t.md < viewTop || t.md > shown.bottom || t.md > shown.bit) continue;
        const yy = y(t.md);
        if (t.kind === "pipe") {
          const bore = t.md > bhaTop ? bhaBore : pipeBore;
          const moved = Math.abs(t.md - before), streak = moved < span / 2 ? Math.min(40, moved / metresPerPx) : 0;
          const killed = r.kill && t.md < shown.bit * r.kill.stringFraction;
          ctx.fillStyle = killed ? "rgba(242, 180, 92, 0.7)" : "rgba(228, 212, 180, 0.4)";
          ctx.fillRect(cx - bore * 0.8 + t.radial * bore * 1.6 - 0.5, yy - streak, 1, Math.max(1.5, streak));
          continue;
        }
        const inner = stringR(t.md) + 1, outer = wall(t.md) - 1;
        if (outer <= inner) continue;
        const x = cx + t.side * (inner + t.radial * (outer - inner));
        if (t.kind === "annulus") {
          const moved = Math.abs(t.md - before), streak = moved < span / 2 ? Math.min(40, moved / metresPerPx) : 0;
          ctx.fillStyle = r.kill && t.md > shown.bit * (1 - r.kill.annulusFraction) ? "rgba(250, 200, 120, 0.45)" : "rgba(222, 205, 170, 0.32)";
          ctx.fillRect(x - 0.5, yy, 1, Math.max(1.5, streak));
        } else {
          // Cuttings are a few millimetres: about a quarter of an inch, never less than a pixel.
          const size = Math.max(1, t.size * 0.24 * inch);
          ctx.save(); ctx.translate(x, yy); ctx.rotate(t.spin); ctx.fillStyle = "#a8834a";
          ctx.beginPath(); ctx.moveTo(-size, -size * 0.4); ctx.lineTo(size * 0.2, -size * 0.8); ctx.lineTo(size, size * 0.3); ctx.lineTo(-size * 0.3, size * 0.7); ctx.closePath(); ctx.fill(); ctx.restore();
        }
      }

      // ---- gas: bubbles from the rock where it is let in, rising through the mud and swelling as the pressure falls ----
      const truth = r.truth;
      shown.bubblePhase += simDt * GAS_SLIP_MS;
      if (truth.influxMdM !== null && truth.influxLengthM > 0) {
        const entering = truth.influxSourceMdM !== null && truth.influxRateBblMin > 0.02;
        const base = entering ? Math.max(truth.influxMdM, truth.influxSourceMdM!) : truth.influxMdM, topMd = Math.max(0, truth.influxMdM - truth.influxLengthM), length = Math.max(1, base - topMd);
        const entryTvd = tvdAtMd(sim.brief, Math.min(sim.targetMdM, truth.influxSourceMdM ?? truth.influxMdM)) + 15;
        const count = Math.min(520, Math.round(50 + truth.influxLengthM * 9));
        ctx.fillStyle = truth.influxGas ? "rgba(236, 244, 255, 0.85)" : "rgba(60, 40, 18, 0.9)";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.35)"; ctx.lineWidth = 0.6;
        for (let i = 0; i < count; i++) {
          const md = topMd + (((hash(i * 1.37) - shown.bubblePhase / length) % 1) + 1) % 1 * length;
          if (md < viewTop || md > shown.bottom || md > shown.bit) continue;
          const inner = stringR(md) + 1.5, outer = wall(md) - 1.5;
          if (outer <= inner) continue;
          const side = hash(i * 2.11) < 0.5 ? -1 : 1, swell = truth.influxGas ? Math.cbrt(entryTvd / (tvdAtMd(sim.brief, md) + 15)) : 1;
          // Dispersed bubbles a few millimetres across where the gas comes in, growing as they rise.
          const radius = Math.min((outer - inner) * 0.42, Math.max(0.7, (1.5 + hash(i * 4.3) * 4.5) * inch / 25.4 * swell));
          const x = cx + side * (inner + radius + hash(i * 3.71) * Math.max(0, outer - inner - radius * 2)) + Math.sin(clockS * 2.4 + i) * 0.6;
          ctx.beginPath(); ctx.arc(x, y(md), radius, 0, Math.PI * 2); ctx.fill(); if (radius > 3) ctx.stroke();
        }
        if (entering && truth.influxSourceMdM !== null) {
          // Gas out of the pores: bubbles leaving the wall and heading into the hole.
          const yy = y(truth.influxSourceMdM), w = wall(truth.influxSourceMdM);
          for (let i = 0; i < 14; i++) {
            const phase = ((hash(i * 9.1) + clockS * 0.8) % 1), side = i % 2 ? 1 : -1;
            const x = cx + side * (w + 22 * (1 - phase)), radius = 1 + hash(i) * 1.6;
            ctx.beginPath(); ctx.arc(x, yy + (hash(i * 5.3) - 0.5) * 18, radius, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = "rgba(255, 240, 200, 0.95)"; ctx.font = "600 10.5px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "left";
          ctx.fillText(truth.influxGas ? "gas entering from the formation" : "formation fluid entering", cx + w + 28, yy - 12);
        }
      }
      // ---- losses: fractures opening from the wall, mud running into them ----
      if (truth.lossMdM !== null) {
        const yy = y(truth.lossMdM), w = wall(truth.lossMdM), reach = Math.min(90, 20 + r.lossRateBblMin * 12);
        ctx.strokeStyle = "rgba(92, 76, 59, 0.95)"; ctx.lineWidth = 2.4;
        for (const side of [-1, 1]) for (let f = 0; f < 3; f++) {
          ctx.beginPath(); ctx.moveTo(cx + side * w, yy + (f - 1) * 6);
          for (let s = 1; s <= 6; s++) ctx.lineTo(cx + side * (w + reach * s / 6), yy + (f - 1) * 6 + (hash(f * 11 + s + side) - 0.5) * 10);
          ctx.stroke();
          const phase = (clockS * 0.9 + f / 3) % 1; ctx.fillStyle = "#c4a77a"; ctx.fillRect(cx + side * (w + reach * phase) - 1, yy + (f - 1) * 6 - 1, 2, 2);
        }
        ctx.fillStyle = "rgba(254, 202, 202, 0.95)"; ctx.font = "600 10.5px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "right";
        ctx.fillText(`losing ${r.lossRateBblMin.toFixed(1)} bbl/min to the rock`, cx - w - reach - 6, yy + 3);
      }

      // ---- the drill string: drill pipe with tool joints, the BHA with stabilisers turning, the bit ----
      const bitY = y(shown.bit);
      if (bitY > surfaceY - 40) {
        const p0 = Math.max(surfaceY, y(0)), p1 = Math.min(height, y(Math.max(0, bhaTop)));
        if (p1 > p0) {
          ctx.fillStyle = steelGradient(ctx, cx - pipeR, cx + pipeR); ctx.fillRect(cx - pipeR, p0, pipeR * 2, p1 - p0);
          ctx.fillStyle = r.kill && r.kill.stringFraction > 0 ? "#5c4c3b" : "#4a3d30"; ctx.fillRect(cx - pipeBore, p0, pipeBore * 2, p1 - p0);
          const joint = 9.5 / metresPerPx;
          if (joint > 5) for (let md = bhaTop - Math.floor((bhaTop - mdAtY(p0)) / 9.5) * 9.5; md >= mdAtY(p0) - 1 && md <= bhaTop; md += 9.5) {
            const yy = y(md), h = Math.max(2, 0.45 / metresPerPx); if (yy < p0 || yy > p1) continue;
            ctx.fillStyle = steelGradient(ctx, cx - pipeR * 1.28, cx + pipeR * 1.28, 1.05); ctx.fillRect(cx - pipeR * 1.28, yy - h / 2, pipeR * 2.56, h);
          }
        }
        const b0 = Math.max(surfaceY, y(Math.max(0, bhaTop))), b1 = Math.min(height, bitY - 6);
        if (b1 > b0) {
          ctx.fillStyle = steelGradient(ctx, cx - bhaR, cx + bhaR, 0.9); ctx.fillRect(cx - bhaR, b0, bhaR * 2, b1 - b0);
          ctx.fillStyle = "#4a3d30"; ctx.fillRect(cx - bhaBore, b0, bhaBore * 2, b1 - b0);
          // MWD collar, a little lighter, 3–12 m above the bit.
          const m0 = Math.max(b0, y(shown.bit - 12)), m1 = Math.min(b1, y(shown.bit - 3));
          if (m1 > m0) { ctx.fillStyle = steelGradient(ctx, cx - bhaR, cx + bhaR, 1.1); ctx.fillRect(cx - bhaR, m0, bhaR * 2, m1 - m0); ctx.fillStyle = "#4a3d30"; ctx.fillRect(cx - bhaBore, m0, bhaBore * 2, m1 - m0); }
          // Stabilisers: three blades each, turning with the string.
          // Stabilisers: near-gauge bodies whose spiral blades sweep round as the string turns.
          for (const above of [1.5, 18]) {
            const yc = y(shown.bit - above), h = Math.max(5, 1.5 / metresPerPx), gauge = holeR * 0.96;
            if (yc + h / 2 < b0 || yc - h / 2 > b1 + 6) continue;
            ctx.fillStyle = steelGradient(ctx, cx - gauge, cx + gauge, 0.75); ctx.fillRect(cx - gauge, yc - h / 2, gauge * 2, h);
            ctx.save(); ctx.beginPath(); ctx.rect(cx - gauge, yc - h / 2, gauge * 2, h); ctx.clip();
            for (let blade = 0; blade < 3; blade++) {
              const a = shown.angle + blade * Math.PI * 2 / 3;
              for (let edge = 0; edge < 2; edge++) {
                const a0 = a + edge * 0.5, front = Math.cos(a0);
                if (front < 0) continue;
                ctx.strokeStyle = `rgba(230, 236, 246, ${0.35 + front * 0.6})`; ctx.lineWidth = Math.max(1.5, gauge * 0.12);
                ctx.beginPath(); ctx.moveTo(cx + Math.sin(a0) * gauge, yc + h / 2); ctx.lineTo(cx + Math.sin(a0 + 0.7) * gauge, yc - h / 2); ctx.stroke();
              }
            }
            ctx.restore();
          }
        }
        if (bitY < height + 30) {
          // A PDC bit: the body, its blades turning, and nozzles jetting mud when the pumps are on.
          const bodyTop = bitY - 7, w = holeR * 0.94;
          ctx.fillStyle = steelGradient(ctx, cx - w, cx + w, 1.1);
          ctx.beginPath(); ctx.moveTo(cx - bhaR, bodyTop - 4); ctx.lineTo(cx + bhaR, bodyTop - 4); ctx.lineTo(cx + w, bodyTop + 2); ctx.lineTo(cx + w * 0.8, bitY + 1); ctx.lineTo(cx - w * 0.8, bitY + 1); ctx.lineTo(cx - w, bodyTop + 2); ctx.closePath(); ctx.fill();
          for (let blade = 0; blade < 5; blade++) {
            const a = shown.angle + blade * Math.PI * 2 / 5, front = Math.cos(a);
            if (front < -0.2) continue;
            const x = cx + Math.sin(a) * w * 0.82;
            ctx.fillStyle = `rgba(30, 36, 48, ${0.5 + front * 0.5})`; ctx.fillRect(x - 1.2, bodyTop + 2, 2.4, bitY - bodyTop - 1);
            ctx.fillStyle = "#e5c45a"; ctx.fillRect(x - 1, bitY - 1, 2, 2);
          }
          if (flowing) {
            ctx.strokeStyle = "rgba(230, 214, 180, 0.6)"; ctx.lineWidth = 1;
            for (let n = 0; n < 4; n++) { const x = cx + (n - 1.5) * w * 0.4, flick = (clockS * 7 + n * 0.3) % 1; ctx.beginPath(); ctx.moveTo(x, bitY - 3); ctx.lineTo(x + (n - 1.5) * 2, bitY + 1 + flick * 3); ctx.stroke(); }
          }
          if (r.onBottom && moving) { ctx.fillStyle = "#b08d4f"; for (let i = 0; i < 6; i++) { const a = clockS * 11 + i * 1.9; ctx.fillRect(cx + Math.cos(a) * w * 0.9, bitY - 2 - ((a * 5) % 7), 1.6, 1.6); } }
        }
        // Kill mud inside the string, down to its front.
        if (r.kill && r.kill.stringFraction > 0) { const front = Math.min(height, y(shown.bit * r.kill.stringFraction)); ctx.fillStyle = "rgba(193, 135, 58, 0.75)"; ctx.fillRect(cx - pipeBore, Math.max(surfaceY, y(0)), pipeBore * 2, Math.max(0, front - Math.max(surfaceY, y(0)))); }
      }
      ctx.restore();

      // ---- the rig floor and everything above it ----
      drawRig({ ctx, r, cx, surfaceY, rigH, left: gutter - 50, right: panelX - 6, pipeR: Math.min(pipeR, 7), shown, clockS, dt, flowing, moving, falls, rate });

      // ---- depth ticks and the bit ----
      ctx.fillStyle = "rgba(163, 171, 198, 0.85)"; ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.textAlign = "right";
      const stepM = [10, 25, 50, 100, 250, 500, 1000].find((s) => s / metresPerPx > 46) ?? 1000;
      for (let md = Math.ceil(shown.top / stepM) * stepM; md <= shown.bottom; md += stepM) { const yy = y(md); if (yy < surfaceY + 6) continue; ctx.fillText(`${md}`, gutter - 6, yy + 3); }
      if (bitY > surfaceY && bitY < height) {
        ctx.strokeStyle = "rgba(226, 232, 240, 0.5)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(gutter, bitY); ctx.lineTo(cx - holeR - 4, bitY); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "#e2e8f0"; ctx.font = "600 10.5px 'IBM Plex Mono', monospace"; ctx.textAlign = "left"; ctx.fillText(`${Math.round(shown.bit)} m`, gutter + 2, bitY - 4);
      }
      ctx.fillStyle = "rgba(163, 171, 198, 0.7)"; ctx.font = "9.5px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "left";
      ctx.fillText(`${zoom ? "MD, m · near the bit" : "MD, m"} · drawn straight · ${rate ? `${rate}× real time` : "paused"}`, 4, surfaceY + 12);

      // ---- the panel: pits, gauges, the window at the bit, the real path ----
      const panelW = width - panelX - 10;
      if (panelW > 110) {
        const pitsY = 14, pitsH = Math.min(84, height * 0.14);
        ctx.fillStyle = "rgba(226, 232, 240, 0.75)"; ctx.font = "600 10.5px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "left"; ctx.fillText("Active pits", panelX, pitsY);
        ctx.strokeStyle = "#4b5672"; ctx.lineWidth = 1.2; ctx.strokeRect(panelX, pitsY + 6, panelW, pitsH);
        const level = Math.max(0.05, Math.min(0.98, 0.5 + shown.pit / 60));
        const alarmed = shown.pit > 5 || shown.pit < -8;
        ctx.fillStyle = alarmed ? "rgba(239, 68, 68, 0.55)" : "rgba(125, 106, 82, 0.75)";
        const surfaceWave = Math.sin(clockS * 2) * 1.5;
        ctx.fillRect(panelX + 1, pitsY + 6 + pitsH * (1 - level) + surfaceWave, panelW - 2, pitsH * level - surfaceWave - 1);
        ctx.strokeStyle = "rgba(226, 232, 240, 0.35)"; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(panelX, pitsY + 6 + pitsH * 0.5); ctx.lineTo(panelX + panelW, pitsY + 6 + pitsH * 0.5); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = alarmed ? "#fecaca" : "#e2e8f0"; ctx.font = "600 12px 'IBM Plex Mono', monospace";
        ctx.fillText(`${shown.pit >= 0 ? "+" : ""}${shown.pit.toFixed(1)} bbl`, panelX + 6, pitsY + 22);

        const gauges: readonly [string, number, number, string][] = [["Standpipe", shown.spp, 5000, "psi"], [r.mode === "killing" ? "Choke" : "Casing", shown.casing, 2000, "psi"], ["Hookload", shown.hook, 400, "klb"], ["Torque", shown.torque, 30, "kft·lbf"]];
        const g0 = pitsY + pitsH + 22, gw = (panelW - 8) / 2, gr = Math.min(gw / 2 - 6, 40), rowH = gr * 2 + 26;
        gauges.forEach(([name, value, max, unit], i) => {
          const gx = panelX + (i % 2) * (gw + 8) + gw / 2, gy = g0 + Math.floor(i / 2) * rowH + gr + 4;
          ctx.strokeStyle = "#2f3a55"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(gx, gy, gr, Math.PI * 0.8, Math.PI * 2.2); ctx.stroke();
          const fraction = Math.max(0, Math.min(1, value / max));
          ctx.strokeStyle = name === "Casing" || name === "Choke" ? (value > 1 ? "#ef4444" : "#4b5672") : "#94a3b8"; ctx.beginPath(); ctx.arc(gx, gy, gr, Math.PI * 0.8, Math.PI * (0.8 + 1.4 * fraction)); ctx.stroke();
          const a = Math.PI * (0.8 + 1.4 * fraction);
          ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + Math.cos(a) * (gr - 7), gy + Math.sin(a) * (gr - 7)); ctx.stroke();
          ctx.fillStyle = "#e2e8f0"; ctx.font = "600 12px 'IBM Plex Mono', monospace"; ctx.textAlign = "center"; ctx.fillText(value >= 100 ? `${Math.round(value)}` : value.toFixed(1), gx, gy + gr * 0.55 + 6);
          ctx.fillStyle = "rgba(163, 171, 198, 0.9)"; ctx.font = "10px 'IBM Plex Sans', sans-serif"; ctx.fillText(`${name}, ${unit}`, gx, gy + gr * 0.55 + 20);
        });

        const wy = g0 + 2 * rowH + 14;
        if (wy + 48 < height) {
          const plan = pressureAt(sim.brief, tvdAtMd(sim.brief, shown.bit));
          const low = plan.porePressureSg - 0.15, high = plan.fractureGradientSg + 0.1;
          const wx = (sg: number) => panelX + (sg - low) / (high - low) * panelW;
          ctx.fillStyle = "rgba(226, 232, 240, 0.75)"; ctx.font = "600 10.5px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "left"; ctx.fillText("Window at the bit, SG", panelX, wy);
          ctx.fillStyle = "rgba(96, 165, 250, 0.25)"; ctx.fillRect(panelX, wy + 8, wx(plan.porePressureSg) - panelX, 16);
          ctx.fillStyle = "rgba(52, 211, 153, 0.18)"; ctx.fillRect(wx(plan.porePressureSg), wy + 8, wx(plan.fractureGradientSg) - wx(plan.porePressureSg), 16);
          ctx.fillStyle = "rgba(245, 158, 11, 0.25)"; ctx.fillRect(wx(plan.fractureGradientSg), wy + 8, panelX + panelW - wx(plan.fractureGradientSg), 16);
          const ecdX = Math.max(panelX, Math.min(panelX + panelW, wx(r.ecdBitSg)));
          const danger = r.ecdBitSg < plan.porePressureSg + 0.01 || r.ecdBitSg > plan.fractureGradientSg - 0.02;
          ctx.fillStyle = danger ? "#ef4444" : "#e2e8f0"; ctx.fillRect(ecdX - 1.5, wy + 4, 3, 24);
          ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.fillStyle = "rgba(163, 171, 198, 0.9)";
          ctx.textAlign = "left"; ctx.fillText(`pore ${plan.porePressureSg.toFixed(2)}`, panelX, wy + 38);
          ctx.textAlign = "right"; ctx.fillText(`frac ${plan.fractureGradientSg.toFixed(2)}`, panelX + panelW, wy + 38);
          ctx.textAlign = "center"; ctx.fillStyle = danger ? "#fecaca" : "#e2e8f0"; ctx.fillText(`ECD ${r.ecdBitSg.toFixed(2)}`, ecdX, wy + 50);
        }
        if (path.length > 1) {
          const py = Math.min(height - 120, height * 0.72), ph = height - py - 18;
          if (ph > 60) {
            const departure = (s: ComputedStation) => Math.hypot(s.northingM, s.eastingM);
            const maxD = Math.max(1, ...path.map(departure)), maxT = Math.max(1, ...path.map((s) => s.tvdM));
            const k2 = Math.min(panelW / maxD, ph / maxT);
            const px = (s: ComputedStation) => panelX + departure(s) * k2, pyy = (s: ComputedStation) => py + 14 + s.tvdM * k2;
            ctx.fillStyle = "rgba(226, 232, 240, 0.75)"; ctx.font = "600 10.5px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "left"; ctx.fillText("The real path (vertical section)", panelX, py + 6);
            ctx.lineWidth = 2;
            ctx.strokeStyle = "rgba(148, 163, 184, 0.35)"; ctx.beginPath(); path.forEach((s, i) => i ? ctx.lineTo(px(s), pyy(s)) : ctx.moveTo(px(s), pyy(s))); ctx.stroke();
            ctx.strokeStyle = "#e2e8f0"; ctx.beginPath(); let started = false;
            for (const s of path) { if (s.mdM > shown.hole) break; if (started) ctx.lineTo(px(s), pyy(s)); else { ctx.moveTo(px(s), pyy(s)); started = true; } }
            ctx.stroke();
            const near = path.reduce((best, s) => Math.abs(s.mdM - shown.bit) < Math.abs(best.mdM - shown.bit) ? s : best, path[0]!);
            ctx.fillStyle = "#e2e8f0"; ctx.beginPath(); ctx.arc(px(near), pyy(near), 3.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "rgba(163, 171, 198, 0.9)"; ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.fillText(`inc ${near.inclinationDeg.toFixed(0)}° · ${Math.round(departure(near))} m out`, panelX, height - 6);
          }
        }
      }
      element.setAttribute("aria-label", `Rig and hole: ${r.mode}, bit at ${Math.round(r.bitMdM)} m, standpipe ${Math.round(r.sppPsi)} psi, pit gain ${r.pitGainBbl.toFixed(1)} bbl${truth.influxMdM !== null ? ", influx in the annulus" : ""}${truth.lossMdM !== null ? ", losing mud" : ""}.`);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [simRef]);

  return <canvas ref={canvas} className="rig-view" role="img" />;
}

const ease = (from: number, to: number, k: number) => from + (to - from) * k;
const formationAt = (sim: DrillingSimulator, md: number) => [...sim.brief.geology.formations].sort((a, b) => a.topTvdM - b.topTvdM).filter((f) => f.topTvdM <= tvdAtMd(sim.brief, md)).at(-1);

interface RigArgs {
  readonly ctx: CanvasRenderingContext2D; readonly r: DrillReading; readonly cx: number; readonly surfaceY: number; readonly rigH: number;
  readonly left: number; readonly right: number; readonly pipeR: number; readonly clockS: number; readonly dt: number; readonly flowing: boolean; readonly moving: boolean; readonly rate: number;
  readonly shown: { angle: number; strokes: number; drum: number; rams: number; plume: number; flare: number; blockY: number; cuttings: number };
  readonly falls: Fall[];
}

/**
 * The rig as a technical illustration: derrick, crown and travelling block on the drill line, top
 * drive, racked stands, drawworks, two triplex pumps, standpipe and rotary hose, the BOP stack with
 * its annular and rams, the flowline to the shale shaker, the choke line to the gas buster and the
 * flare boom. Everything that moves on a rig moves here, driven by the readings.
 */
function drawRig({ ctx, r, cx, surfaceY, rigH, left, right, pipeR, clockS, dt, flowing, moving, rate, shown, falls }: RigArgs) {
  const s = rigH / 220;
  const bopH = 46 * s, floorY = surfaceY - bopH - 6 * s;
  const crownY = 8 * s, mastH = floorY - crownY, mastW = 34 * s;
  const sky = ctx.createLinearGradient(0, 0, 0, surfaceY); sky.addColorStop(0, "#0b1222"); sky.addColorStop(1, "#151e34");
  ctx.fillStyle = sky; ctx.fillRect(left, 0, right - left, surfaceY);

  // Substructure and rig floor.
  ctx.fillStyle = "#222a3d"; ctx.fillRect(cx - 90 * s, floorY, 180 * s, 6 * s);
  ctx.strokeStyle = "#3a4560"; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) { const x = cx - 80 * s + i * 54 * s; ctx.beginPath(); ctx.moveTo(x, floorY + 6 * s); ctx.lineTo(x + 26 * s, surfaceY); ctx.moveTo(x + 26 * s, floorY + 6 * s); ctx.lineTo(x, surfaceY); ctx.stroke(); }

  // The derrick.
  ctx.strokeStyle = "#5c6a86"; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(cx - mastW, floorY); ctx.lineTo(cx - 5 * s, crownY + 8 * s); ctx.moveTo(cx + mastW, floorY); ctx.lineTo(cx + 5 * s, crownY + 8 * s); ctx.stroke();
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 10; i++) {
    const y0 = floorY - mastH * i / 10, y1 = floorY - mastH * (i + 1) / 10;
    const w0 = mastW - (mastW - 5 * s) * i / 10, w1 = mastW - (mastW - 5 * s) * (i + 1) / 10;
    ctx.beginPath(); ctx.moveTo(cx - w0, y0); ctx.lineTo(cx + w1, y1); ctx.moveTo(cx + w0, y0); ctx.lineTo(cx - w1, y1); ctx.moveTo(cx - w1, y1); ctx.lineTo(cx + w1, y1); ctx.stroke();
  }
  // Crown block with its sheaves.
  ctx.fillStyle = "#3b4560"; ctx.fillRect(cx - 9 * s, crownY, 18 * s, 8 * s);
  for (let i = 0; i < 3; i++) { ctx.strokeStyle = "#8a96ad"; ctx.beginPath(); ctx.arc(cx - 5 * s + i * 5 * s, crownY + 4 * s, 2 * s, 0, Math.PI * 2); ctx.stroke(); }
  // Racked stands in the fingerboard.
  ctx.strokeStyle = "rgba(160, 170, 190, 0.6)"; ctx.lineWidth = 1.4 * s;
  for (let i = 0; i < 6; i++) { const x = cx + mastW * 0.42 + i * 2.6 * s; ctx.beginPath(); ctx.moveTo(x, floorY - 1); ctx.lineTo(x + 6 * s, floorY - mastH * 0.78); ctx.stroke(); }

  // The travelling block and top drive ride the stand being drilled; during a connection they go back up for the next.
  const standTop = crownY + 22 * s, standBottom = floorY - 26 * s;
  const drilled = Math.max(0, Math.min(1, r.standDrilledM / 28.5));
  const c = r.connectionProgress;
  const tripping = r.tripProgress !== null;
  const blockTarget = tripping ? standTop + (standBottom - standTop) * (0.5 + 0.5 * Math.sin(clockS * 1.4)) : c !== null ? (c < 0.15 ? standBottom - (standBottom - standTop) * 0.18 * (c / 0.15) : c < 0.6 ? standBottom - (standBottom - standTop) * (0.18 + 0.82 * (c - 0.15) / 0.45) : standTop) : standTop + (standBottom - standTop) * drilled;
  const before = shown.blockY || blockTarget;
  shown.blockY = ease(before, blockTarget, 1 - Math.exp(-dt * 6));
  shown.drum += (shown.blockY - before) * 0.4;
  const by = shown.blockY;
  ctx.strokeStyle = "#9aa6bc"; ctx.lineWidth = 0.7;
  for (let i = 0; i < 4; i++) { const x = cx - 4.5 * s + i * 3 * s; ctx.beginPath(); ctx.moveTo(x, crownY + 8 * s); ctx.lineTo(x, by); ctx.stroke(); }
  ctx.fillStyle = "#c9a227"; ctx.fillRect(cx - 8 * s, by, 16 * s, 9 * s);
  ctx.fillStyle = "#38425c"; ctx.fillRect(cx - 11 * s, by + 9 * s, 22 * s, 14 * s);
  if (r.rotating) { ctx.fillStyle = "rgba(255, 255, 255, 0.5)"; for (let i = 0; i < 3; i++) { const x = cx - 10 * s + (((shown.angle * 3 + i * 2.1) % 6.28) / 6.28) * 20 * s; ctx.fillRect(x, by + 11 * s, 1.2, 10 * s); } }
  // The pipe from the top drive down through the rotary table.
  ctx.fillStyle = steelGradient(ctx, cx - pipeR * 0.8, cx + pipeR * 0.8);
  ctx.fillRect(cx - pipeR * 0.8, by + 23 * s, pipeR * 1.6, Math.max(0, floorY - by - 23 * s));
  if (c !== null && c > 0.6) { // the new stand swung in from the fingerboard
    const swing = Math.min(1, (c - 0.6) / 0.25);
    ctx.strokeStyle = "rgba(190, 198, 214, 0.9)"; ctx.lineWidth = pipeR * 1.2;
    ctx.beginPath(); ctx.moveTo(cx + (1 - swing) * mastW * 0.5, standTop + 24 * s); ctx.lineTo(cx + (1 - swing) * mastW * 0.6, floorY - 4 * s); ctx.stroke();
  }

  // Drawworks: the drum turns as the block moves.
  const dx = cx - 62 * s, dy = floorY - 9 * s;
  ctx.fillStyle = "#2b344c"; ctx.fillRect(dx - 13 * s, dy - 7 * s, 26 * s, 16 * s);
  ctx.strokeStyle = "#8a96ad"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(dx, dy, 6 * s, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 3; i++) { const a = shown.drum + i * Math.PI / 1.5; ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx + Math.cos(a) * 6 * s, dy + Math.sin(a) * 6 * s); ctx.stroke(); }
  ctx.strokeStyle = "#9aa6bc"; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(dx, dy - 6 * s); ctx.lineTo(cx - 5 * s, crownY + 4 * s); ctx.stroke();

  // Two triplex mud pumps: pistons stroking, a third of a turn apart.
  const px = Math.max(left + 40 * s, cx - 140 * s), pyy = floorY - 4 * s;
  for (let pump = 0; pump < 2; pump++) {
    const x0 = px + pump * 34 * s;
    ctx.fillStyle = "#2f3b5c"; ctx.fillRect(x0 - 14 * s, pyy - 14 * s, 28 * s, 14 * s);
    for (let piston = 0; piston < 3; piston++) {
      const stroke = flowing ? Math.sin((shown.strokes + piston / 3 + pump * 0.17) * Math.PI * 2) : 0;
      ctx.fillStyle = "#a8b3c7"; ctx.fillRect(x0 - 11 * s + piston * 8 * s, pyy - 22 * s + stroke * 3 * s, 3 * s, 9 * s);
    }
  }
  // Standpipe up the derrick, rotary hose to the top drive; dashes travel with the flow.
  ctx.lineWidth = 1.8; ctx.strokeStyle = flowing ? "#60a5fa" : "#47536d"; ctx.setLineDash(flowing ? [5, 4] : []); ctx.lineDashOffset = -clockS * Math.min(60, 8 * Math.max(1, Math.log2(1 + rate)));
  ctx.beginPath(); ctx.moveTo(px + 17 * s, pyy - 14 * s); ctx.lineTo(cx - mastW * 0.62, pyy - 14 * s); ctx.lineTo(cx - mastW * 0.32, crownY + 40 * s);
  ctx.quadraticCurveTo(cx - mastW * 0.6, (crownY + 40 * s + by) / 2 + 20 * s, cx - 11 * s, by + 14 * s); ctx.stroke(); ctx.setLineDash([]);

  // The BOP stack under the floor: annular on top, two ram preventers, on the wellhead.
  const bopTop = floorY + 6 * s, bopW = 30 * s;
  ctx.fillStyle = "#4b2633"; ctx.beginPath(); ctx.ellipse(cx, bopTop + 8 * s, bopW * 0.85, 8 * s, 0, 0, Math.PI * 2); ctx.fill();
  for (let ram = 0; ram < 2; ram++) {
    const ry = bopTop + 16 * s + ram * 13 * s;
    const closed = shown.rams;
    ctx.fillStyle = closed > 0.5 ? "#7f1d1d" : "#3a1f2a"; ctx.fillRect(cx - bopW, ry, bopW * 2, 11 * s);
    ctx.strokeStyle = closed > 0.5 ? "#ef4444" : "#7c5a6a"; ctx.lineWidth = 1; ctx.strokeRect(cx - bopW, ry, bopW * 2, 11 * s);
    if (ram === 0) { // the pipe rams close on the drill pipe
      const travel = (bopW - pipeR - 3) * closed;
      ctx.fillStyle = closed > 0.5 ? "#fca5a5" : "#9f7a8a";
      ctx.fillRect(cx - bopW - 10 * s + travel, ry + 2 * s, 10 * s, 7 * s); ctx.fillRect(cx + bopW - travel, ry + 2 * s, 10 * s, 7 * s);
      ctx.fillStyle = "#5a6478"; ctx.fillRect(cx - bopW - 18 * s, ry + 4 * s, 8 * s + travel, 3 * s); ctx.fillRect(cx + bopW + 10 * s - travel, ry + 4 * s, 8 * s + travel, 3 * s);
    }
  }
  ctx.fillStyle = steelGradient(ctx, cx - pipeR * 0.8, cx + pipeR * 0.8); ctx.fillRect(cx - pipeR * 0.8, floorY, pipeR * 1.6, surfaceY - floorY);
  ctx.fillStyle = "rgba(226, 232, 240, 0.7)"; ctx.font = `${Math.max(8.5, 9.5 * s)}px 'IBM Plex Mono', monospace`; ctx.textAlign = "left"; ctx.fillText("BOP", cx + bopW + 22 * s, bopTop + 28 * s);

  // Returns: flowline from the bell nipple to the shale shaker, where cuttings come off the screen.
  const shakerX = Math.min(right - 60 * s, cx + 120 * s), shakerY = floorY - 4 * s;
  const returning = r.flowOutGpm > 1 && r.mode !== "killing" && r.mode !== "shut-in";
  const influxAlarm = (r.flowInGpm > 0 && r.flowOutGpm > r.flowInGpm * 1.1) || (!r.pumpsOn && r.flowOutGpm > 5);
  ctx.lineWidth = 2.4; ctx.strokeStyle = influxAlarm ? "#ef4444" : returning ? "#a8906c" : "#3d475e";
  ctx.setLineDash(returning ? [5, 4] : []); ctx.lineDashOffset = -clockS * Math.min(60, 8 * Math.max(1, Math.log2(1 + rate)));
  ctx.beginPath(); ctx.moveTo(cx + bopW * 0.6, bopTop + 2 * s); ctx.lineTo(shakerX - 26 * s, bopTop + 2 * s); ctx.lineTo(shakerX - 22 * s, shakerY - 12 * s); ctx.stroke(); ctx.setLineDash([]);
  const shake = returning && moving ? Math.sin(clockS * 60) * 0.8 : 0;
  ctx.save(); ctx.translate(shakerX + shake, shakerY - 12 * s); ctx.rotate(-0.12);
  ctx.fillStyle = "#2b344c"; ctx.fillRect(-24 * s, 0, 48 * s, 7 * s); ctx.strokeStyle = "#8a96ad"; ctx.lineWidth = 0.8; for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(-22 * s + i * 6 * s, 1); ctx.lineTo(-20 * s + i * 6 * s, 6 * s); ctx.stroke(); }
  ctx.restore();
  ctx.fillStyle = "#3a3226"; ctx.fillRect(shakerX - 26 * s, shakerY - 4 * s, 52 * s, 8 * s); // the pit under it
  // Cuttings falling off the end of the screen into the skip.
  if (returning && shown.cuttings > 0.02 && moving && Math.random() < shown.cuttings * 0.9) falls.push({ x: shakerX + 22 * s, y: shakerY - 16 * s, vy: 0, life: 1, colour: "#b08d4f" });
  for (let i = falls.length - 1; i >= 0; i--) {
    const f = falls[i]!;
    if (f.x === 0) { f.x = shakerX + 22 * s; f.y = shakerY - 16 * s; }
    f.vy += 240 * dt * s; f.y += f.vy * dt; f.x += 10 * dt * s; f.life -= dt * 1.4;
    if (f.life <= 0 || f.y > shakerY + 10 * s) { falls.splice(i, 1); continue; }
    ctx.fillStyle = f.colour; ctx.fillRect(f.x, f.y, 1.8, 1.8);
  }
  if (falls.length > 300) falls.splice(0, falls.length - 300);

  // Choke line to the gas buster and the flare: gas out through the choke burns at the flare boom.
  const killing = r.mode === "killing";
  ctx.lineWidth = 1.8; ctx.strokeStyle = killing ? "#f2b45c" : "#3d475e"; ctx.setLineDash(killing ? [4, 4] : []); ctx.lineDashOffset = -clockS * 30;
  ctx.beginPath(); ctx.moveTo(cx + bopW, bopTop + 21 * s); ctx.lineTo(cx + bopW + 40 * s, bopTop + 21 * s); ctx.lineTo(cx + bopW + 40 * s, floorY - 30 * s); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = "#2b344c"; ctx.fillRect(cx + bopW + 34 * s, floorY - 48 * s, 12 * s, 20 * s); // mud–gas separator
  const boomX = Math.min(right - 8, cx + bopW + 90 * s), boomY = floorY - 70 * s;
  ctx.strokeStyle = "#5c6a86"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(cx + bopW + 40 * s, floorY - 48 * s); ctx.lineTo(boomX, boomY); ctx.stroke();
  const gasAtSurface = r.truth.influxMdM !== null && r.truth.influxInHoleBbl > 0 && (r.truth.influxMdM - r.truth.influxLengthM) < 120;
  shown.flare = ease(shown.flare, killing && gasAtSurface ? Math.min(1, r.truth.influxInHoleBbl / 15) : 0, 1 - Math.exp(-dt * 2));
  if (shown.flare > 0.03) {
    for (let i = 0; i < 26; i++) {
      const life = (clockS * 1.6 + i / 26) % 1, size = (4 + 18 * shown.flare) * s * (1 - life * 0.5);
      ctx.fillStyle = `rgba(255, ${Math.round(200 - 150 * life)}, ${Math.round(60 - 50 * life)}, ${(1 - life) * 0.75 * shown.flare})`;
      ctx.beginPath(); ctx.arc(boomX + life * 14 * s + Math.sin(i * 7 + clockS * 9) * 2, boomY - life * 26 * s * (0.5 + shown.flare), size, 0, Math.PI * 2); ctx.fill();
    }
  }

  // A blowout: mud and gas through the rotary table and up the derrick.
  if (shown.plume > 0.02) {
    for (let i = 0; i < 140; i++) {
      const life = (clockS * 0.9 + hash(i) ) % 1, vx = (hash(i * 3.1) - 0.5) * 140 * s, vy = -(200 + hash(i * 5.7) * 260) * s;
      const x = cx + vx * life, yy = floorY + vy * life + 260 * s * life * life;
      const gas = i % 3 === 0;
      ctx.fillStyle = gas ? `rgba(225, 230, 240, ${shown.plume * (1 - life) * 0.6})` : `rgba(120, 95, 65, ${shown.plume * (1 - life) * 0.85})`;
      ctx.beginPath(); ctx.arc(x, yy, (gas ? 6 + life * 16 : 1.5 + hash(i) * 2) * s, 0, Math.PI * 2); ctx.fill();
    }
  }
}
