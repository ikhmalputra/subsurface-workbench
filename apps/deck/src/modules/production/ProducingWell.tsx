import { useEffect, useRef } from "react";
import type { FlowPattern } from "@ikhmalputra/subsurface-core/production";
import { LITHOLOGY_BASE, hash, lithologyOf, lithologyPattern, steelGradient } from "../RigView.tsx";
import type { Lithology } from "../RigView.tsx";
import { depthScale } from "./scene.ts";
import type { SceneFlow, WellScene } from "./scene.ts";

/**
 * The producing well, drawn and flowing. Motion is the model's, not decoration: tracers rise up the
 * tubing at the traverse's mixture velocity at their depth (scaled to what the eye can follow, the
 * same scale everywhere so faster is faster); each is liquid or gas by the holdup where it is, so
 * gas appears as it leaves the oil and its bubbles grow as the pressure on them falls; slug flow
 * shows its long Taylor bubbles. Inflow streaks into the perforations at a speed set by the rate,
 * and lift gas runs down the annulus to the valve it enters. Diameters are exaggerated against
 * depth so the annulus can be seen; depths are to scale and the well is drawn straight.
 */

export const PATTERN_TINT: Readonly<Record<FlowPattern, string>> = { liquid: "#38bdf8", segregated: "#a78bfa", transition: "#f472b6", intermittent: "#f59e0b", distributed: "#34d399", gas: "#f87171" };
const OIL = "#c08a3e", WATER = "#3b82f6", GAS = "rgba(236, 244, 255, 0.92)";
const PX_PER_FTS = 9, MAX_PX_S = 240;

interface Tracer { md: number; seed: number; lane: number }

export function ProducingWell({ scene, cursorMdM, onHover, onPin, playing = true }: {
  readonly scene: WellScene; readonly cursorMdM: number | null;
  readonly onHover: (mdM: number | null) => void; readonly onPin: (mdM: number | null) => void; readonly playing?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ scene, cursorMdM, playing });
  live.current = { scene, cursorMdM, playing };

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const ctx = context;
    let width = 0, height = 0, frame = 0, last = performance.now(), clock = 0;
    const resize = () => {
      const box = element.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(120, box.width); height = Math.max(200, box.height);
      element.width = Math.round(width * dpr); element.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const patterns = new Map<Lithology, CanvasPattern | null>();
    const patternFor = (kind: Lithology) => { if (!patterns.has(kind)) patterns.set(kind, lithologyPattern(ctx, kind)); return patterns.get(kind) ?? null; };
    const tubingTracers: Tracer[] = Array.from({ length: 220 }, (_, i) => ({ md: hash(i * 9.1) * 3000, seed: i, lane: hash(i * 3.7) * 2 - 1 }));
    const annulusTracers: Tracer[] = Array.from({ length: 70 }, (_, i) => ({ md: hash(i * 4.3) * 3000, seed: i + 500, lane: hash(i * 1.9) }));
    const inflow: Tracer[] = Array.from({ length: 60 }, (_, i) => ({ md: hash(i * 2.2), seed: i + 900, lane: hash(i * 6.1) }));

    const flowAt = (flow: readonly SceneFlow[], md: number): SceneFlow | null => {
      if (!flow.length) return null;
      let lo = 0, hi = flow.length - 1;
      if (md <= flow[0]!.mdM) return flow[0]!;
      if (md >= flow[hi]!.mdM) return flow[hi]!;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (flow[mid]!.mdM <= md) lo = mid; else hi = mid; }
      return flow[lo]!;
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const { scene: s, cursorMdM: cursor, playing: run } = live.current;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (run) clock += dt;
      const scale = depthScale(height, s.mdMax), y = scale.y;
      const cx = Math.round(width * 0.5);
      // Diameters exaggerated: the widest hole fills about two thirds of the column.
      const widest = Math.max(...s.sections.map((x) => x.holeIn), s.tubing.odIn * 3);
      const inch = Math.min(width * 0.62, 260) / widest;
      const r = (dIn: number) => Math.max(1.5, dIn / 2 * inch);
      const perfTop = Math.min(...s.perforations.map((p) => p.topMdM), s.mdMax), perfBottom = Math.max(...s.perforations.map((p) => p.bottomMdM), perfTop);
      const prod = [...s.sections].reverse().find((x) => x.shoeMdM >= perfBottom) ?? s.sections.at(-1);
      ctx.clearRect(0, 0, width, height);

      // ---- sky and surface ----
      const sky = ctx.createLinearGradient(0, 0, 0, scale.top);
      sky.addColorStop(0, "#0b1222"); sky.addColorStop(1, "#16223a");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, width, scale.top);

      // ---- the rock, anchored to depth ----
      ctx.fillStyle = "#1a1d26"; ctx.fillRect(0, scale.top, width, height - scale.top);
      s.formations.forEach((f, i) => {
        const y0 = Math.max(scale.top, y(f.topMdM)), y1 = Math.min(height, y(s.formations[i + 1]?.topMdM ?? s.mdMax * 2));
        if (y1 <= y0) return;
        const kind = lithologyOf(f.lithology), pattern = patternFor(kind);
        ctx.fillStyle = pattern ?? LITHOLOGY_BASE[kind]; ctx.fillRect(0, y0, width, y1 - y0);
        ctx.fillStyle = f.reservoir ? "rgba(8, 11, 20, 0.15)" : "rgba(8, 11, 20, 0.42)"; ctx.fillRect(0, y0, width, y1 - y0);
        ctx.strokeStyle = "rgba(0, 0, 0, 0.5)"; ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(width, y0); ctx.stroke();
        if (y1 - y0 > 14) { ctx.fillStyle = f.reservoir ? "#fbbf24" : "rgba(226, 232, 240, 0.72)"; ctx.font = "500 10px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "left"; ctx.fillText(f.name, 6, y0 + 12); }
      });

      // ---- inflow: streaks from the rock into the perforations, faster with more rate ----
      const inflowSpeed = Math.min(1.6, 0.15 + s.liquidRate / 6000);
      if (s.liquidRate > 0) {
        for (const t of inflow) {
          if (run) t.md = (t.md + dt * inflowSpeed) % 1;
          const side = hash(t.seed) > 0.5 ? 1 : -1, depth = perfTop + (perfBottom - perfTop) * t.lane;
          const x0 = cx + side * (r(prod?.holeIn ?? 8.5) + 6 + (1 - t.md) * width * 0.32), x1 = x0 - side * 12;
          ctx.strokeStyle = `rgba(250, 204, 21, ${0.25 + 0.55 * t.md})`; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(x0, y(depth)); ctx.lineTo(x1, y(depth)); ctx.stroke();
        }
      }

      // ---- casing strings, outside in: steel walls to each shoe, cement behind ----
      for (const sec of s.sections) {
        const outer = r(sec.odIn), inner = r(sec.idIn), y1 = y(Math.min(sec.shoeMdM, s.mdMax));
        ctx.fillStyle = "rgba(120, 124, 132, 0.55)";
        ctx.fillRect(cx - r(sec.holeIn), scale.top, r(sec.holeIn) - outer, y1 - scale.top);
        ctx.fillRect(cx + outer, scale.top, r(sec.holeIn) - outer, y1 - scale.top);
        ctx.fillStyle = steelGradient(ctx, cx - outer, cx - inner, 0.8); ctx.fillRect(cx - outer, scale.top, outer - inner, y1 - scale.top);
        ctx.fillStyle = steelGradient(ctx, cx + inner, cx + outer, 0.8); ctx.fillRect(cx + inner, scale.top, outer - inner, y1 - scale.top);
        ctx.fillStyle = "#cbd5e1"; ctx.fillRect(cx - outer - 2, y1 - 3, outer - inner + 2, 3); ctx.fillRect(cx + inner, y1 - 3, outer - inner + 2, 3);
      }
      const innerR = r(prod?.idIn ?? 6), tubeR = r(s.tubing.odIn), boreR = r(s.tubing.idIn);

      // ---- the annulus: lift gas above the packer while lifting, load fluid while unloading, packer fluid otherwise ----
      const packerY = s.packerMdM === null ? y(s.mdMax) : y(s.packerMdM);
      const lifting = s.liftMscfD > 0 && s.liftMdM !== null;
      ctx.fillStyle = lifting || s.annulusLevelMdM !== null ? "rgba(147, 197, 253, 0.16)" : "rgba(120, 98, 70, 0.55)";
      ctx.fillRect(cx - innerR, scale.top, innerR - tubeR, packerY - scale.top); ctx.fillRect(cx + tubeR, scale.top, innerR - tubeR, packerY - scale.top);
      if (s.annulusLevelMdM !== null) {
        const ly = y(s.annulusLevelMdM);
        ctx.fillStyle = "rgba(37, 99, 235, 0.92)";
        ctx.fillRect(cx - innerR, ly, innerR - tubeR, packerY - ly); ctx.fillRect(cx + tubeR, ly, innerR - tubeR, packerY - ly);
        ctx.strokeStyle = "#bfdbfe"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx - innerR, ly); ctx.lineTo(cx - tubeR, ly); ctx.moveTo(cx + tubeR, ly); ctx.lineTo(cx + innerR, ly); ctx.stroke();
      }
      // Lift gas running down the annulus to where it goes in.
      if (lifting || s.annulusLevelMdM !== null) {
        const until = s.annulusLevelMdM ?? s.liftMdM ?? 0, speed = 260;
        for (const t of annulusTracers) {
          if (run) t.md += dt * speed * s.mdMax / Math.max(200, height);
          if (t.md > until) t.md = (t.md - until) % Math.max(1, until * 0.1);
          const side = t.seed % 2 ? 1 : -1, x = cx + side * (tubeR + (innerR - tubeR) * (0.25 + 0.5 * t.lane));
          ctx.fillStyle = "rgba(191, 219, 254, 0.75)"; ctx.beginPath(); ctx.arc(x, y(t.md), 1.4, 0, Math.PI * 2); ctx.fill();
        }
      }
      // Packer.
      if (s.packerMdM !== null) { ctx.fillStyle = "#64748b"; ctx.fillRect(cx - innerR, packerY - 4, innerR - tubeR, 8); ctx.fillRect(cx + tubeR, packerY - 4, innerR - tubeR, 8); }

      // ---- the tubing: walls, then the flow inside tinted by its pattern ----
      const tailY = y(Math.min(s.tubing.tailMdM, s.mdMax));
      ctx.fillStyle = steelGradient(ctx, cx - tubeR, cx - boreR, 1); ctx.fillRect(cx - tubeR, scale.top - 6, tubeR - boreR, tailY - scale.top + 6);
      ctx.fillStyle = steelGradient(ctx, cx + boreR, cx + tubeR, 1); ctx.fillRect(cx + boreR, scale.top - 6, tubeR - boreR, tailY - scale.top + 6);
      ctx.fillStyle = "#0b1020"; ctx.fillRect(cx - boreR, scale.top - 6, boreR * 2, tailY - scale.top + 6);
      for (let i = 0; i < s.flow.length - 1; i++) {
        const a = s.flow[i]!, b = s.flow[i + 1]!, y0 = y(a.mdM), y1 = y(b.mdM);
        ctx.globalAlpha = 0.22; ctx.fillStyle = PATTERN_TINT[a.pattern]; ctx.fillRect(cx - boreR, y0, boreR * 2, y1 - y0 + 0.5);
        ctx.globalAlpha = 1;
      }
      // Unloading: the tubing holds load fluid below the deepest open valve and gas-cut fluid above it, rising.
      if (s.annulusLevelMdM !== null) {
        const openMd = Math.max(0, ...s.valves.filter((v) => v.state === "open" || v.state === "operating").map((v) => v.mdM));
        const oy = openMd > 0 ? y(openMd) : scale.top;
        ctx.fillStyle = "rgba(37, 99, 235, 0.75)"; ctx.fillRect(cx - boreR, oy, boreR * 2, tailY - oy);
        if (openMd > 0) {
          ctx.fillStyle = "rgba(96, 165, 250, 0.35)"; ctx.fillRect(cx - boreR, scale.top - 6, boreR * 2, oy - scale.top + 6);
          for (let k = 0; k < 40; k++) { const ph = (clock * 0.35 + hash(k)) % 1, by = oy - ph * (oy - scale.top); ctx.fillStyle = GAS; ctx.beginPath(); ctx.arc(cx + (hash(k * 2.3) * 2 - 1) * boreR * 0.6, by, 1 + 1.6 * ph, 0, Math.PI * 2); ctx.fill(); }
        }
      }
      // Below the tubing tail, to the perforations: the casing carries the inflow.
      ctx.fillStyle = "rgba(192, 138, 62, 0.35)"; ctx.fillRect(cx - innerR, tailY, innerR * 2, y(perfBottom) - tailY);

      // ---- tracers up the tubing at the mixture velocity where each is ----
      const dead = s.liquidRate <= 0;
      const pRes = Math.max(1, s.reservoirPsia);
      ctx.save(); ctx.beginPath(); ctx.rect(cx - boreR, scale.top - 6, boreR * 2, tailY - scale.top + 6); ctx.clip();
      for (const t of tubingTracers) {
        const here = flowAt(s.flow, t.md);
        if (!here) continue;
        const vPx = dead ? 0 : Math.min(MAX_PX_S, here.vm * PX_PER_FTS);
        if (run) t.md -= dt * vPx * s.mdMax / Math.max(200, height);
        if (t.md < 0) { t.md = s.tubing.tailMdM - hash(t.seed + clock) * 20; continue; }
        const yy = y(t.md), x = cx + t.lane * boreR * 0.7;
        const gas = hash(t.seed * 1.7) > here.holdup;
        if (gas) {
          // Bubbles grow as the pressure on them falls (Boyle, to the cube root for the radius).
          const size = Math.min(boreR * 0.8, 1.2 * Math.cbrt(pRes / Math.max(50, here.p)) + 0.6);
          ctx.fillStyle = GAS; ctx.beginPath(); ctx.arc(x, yy, size, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = hash(t.seed * 3.1) < s.waterCut ? WATER : OIL;
          ctx.fillRect(x - 1.3, yy - 1.3, 2.6, 2.6);
        }
      }
      // Slug flow: long Taylor bubbles riding up at the mixture velocity.
      for (let i = 0; i < s.flow.length - 1; i++) {
        const a = s.flow[i]!;
        if (a.pattern !== "intermittent" || dead) continue;
        const y0 = y(a.mdM), y1 = y(s.flow[i + 1]!.mdM), span = 26, phase = (clock * Math.min(MAX_PX_S, a.vm * PX_PER_FTS)) % span;
        for (let yy = y1 - phase; yy > y0 - span; yy -= span) {
          const len = span * (1 - a.holdup) * 0.9;
          if (yy - len < y0 || yy > y1) continue;
          ctx.fillStyle = "rgba(236, 244, 255, 0.55)"; ctx.beginPath(); ctx.roundRect(cx - boreR * 0.72, yy - len, boreR * 1.44, len, boreR * 0.7); ctx.fill();
        }
      }
      ctx.restore();

      // ---- valves on the tubing: mandrels, open ones jetting gas in ----
      for (const v of s.valves) {
        const vy = y(v.mdM), w = Math.max(5, (innerR - tubeR) * 0.7);
        const colour = v.state === "operating" ? "#f59e0b" : v.state === "open" ? "#38bdf8" : v.state === "dummy" ? "#475569" : "#94a3b8";
        ctx.fillStyle = colour; ctx.beginPath(); ctx.roundRect(cx - tubeR - w, vy - 7, w, 14, 3); ctx.fill();
        if ((v.state === "open" || v.state === "operating") && !dead) {
          for (let k = 0; k < 3; k++) { const ph = (clock * 2 + k / 3) % 1; ctx.fillStyle = `rgba(191, 219, 254, ${1 - ph})`; ctx.beginPath(); ctx.arc(cx - tubeR + ph * boreR * 1.4, vy + (k - 1) * 3, 1.6, 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.fillStyle = "rgba(226, 232, 240, 0.9)"; ctx.font = "600 10px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "right";
        ctx.fillText(v.label, cx - innerR - 6, vy + 3.5);
      }
      // Gauge.
      if (s.gaugeMdM !== null) {
        const gy = y(s.gaugeMdM);
        ctx.fillStyle = "#a78bfa"; ctx.beginPath(); ctx.arc(cx + tubeR + 3, gy, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(226, 232, 240, 0.9)"; ctx.font = "600 10px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "left";
        ctx.fillText("gauge", cx + innerR + 6, gy + 3.5);
      }
      // Perforation tunnels.
      for (const p of s.perforations) for (let md = p.topMdM; md <= p.bottomMdM; md += Math.max(1, (p.bottomMdM - p.topMdM) / 10)) {
        const py = y(md); ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx - innerR - 10, py); ctx.lineTo(cx - innerR + 2, py); ctx.moveTo(cx + innerR - 2, py); ctx.lineTo(cx + innerR + 10, py); ctx.stroke();
      }

      // ---- the tree and the flowline ----
      const treeW = Math.max(16, tubeR * 2.4), treeTop = 10;
      ctx.fillStyle = steelGradient(ctx, cx - treeW / 2, cx + treeW / 2, 1.05); ctx.fillRect(cx - treeW / 2, treeTop, treeW, scale.top - treeTop - 4);
      for (const k of [0.2, 0.45]) { ctx.fillStyle = "#ef4444"; ctx.beginPath(); ctx.arc(cx, treeTop + (scale.top - treeTop) * k, 4.5, 0, Math.PI * 2); ctx.fill(); }
      const wingY = treeTop + (scale.top - treeTop) * 0.68;
      ctx.fillStyle = steelGradient(ctx, cx, width, 0.9); ctx.fillRect(cx + treeW / 2, wingY - 5, width - cx - treeW / 2, 10);
      // The choke, and the flow leaving down the line.
      ctx.fillStyle = "#f59e0b"; ctx.beginPath(); ctx.moveTo(cx + treeW / 2 + 16, wingY - 9); ctx.lineTo(cx + treeW / 2 + 30, wingY); ctx.lineTo(cx + treeW / 2 + 16, wingY + 9); ctx.closePath(); ctx.fill();
      if (!dead) for (let k = 0; k < 8; k++) { const ph = (clock * (0.4 + s.liquidRate / 12000) + k / 8) % 1; ctx.fillStyle = hash(k) < s.waterCut ? WATER : OIL; ctx.fillRect(cx + treeW / 2 + 34 + ph * (width - cx - treeW / 2 - 40), wingY - 1.5, 3, 3); }
      ctx.fillStyle = "rgba(226, 232, 240, 0.92)"; ctx.font = "600 10.5px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "left";
      ctx.fillText(`${Math.round(s.whpPsig)} psig`, cx + treeW / 2 + 36, wingY - 9);

      // ---- the depth cursor shared with the deck ----
      if (cursor !== null && cursor <= s.mdMax) {
        const cy = y(cursor);
        ctx.strokeStyle = "rgba(244, 114, 182, 0.9)"; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(width, cy); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "#f472b6"; ctx.font = "600 10px 'IBM Plex Mono', monospace"; ctx.textAlign = "right"; ctx.fillText(`${Math.round(cursor).toLocaleString()} m`, width - 4, cy - 4);
      }
      if (dead && s.annulusLevelMdM === null) { ctx.fillStyle = "rgba(248, 113, 113, 0.95)"; ctx.font = "600 12px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "left"; ctx.fillText("not flowing", cx + innerR + 8, scale.top + 22); }
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);

  const mdAt = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect(), md = depthScale(box.height, live.current.scene.mdMax).md(event.clientY - box.top);
    return md >= 0 && md <= live.current.scene.mdMax ? md : null;
  };
  return <canvas ref={canvas} className="pw-canvas" aria-label="The producing well, drawn to depth: hover to move the depth cursor, click to pin it"
    onPointerMove={(event) => onHover(mdAt(event))} onPointerLeave={() => onHover(null)} onClick={(event) => onPin(mdAt(event))} />;
}
