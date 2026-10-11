"use client";

import { useEffect, useRef } from "react";
import { getCatalogEntry } from "@ikhmalputra/subsurface-core";
import type { AssemblyIssue, AssemblyItem, AssemblySlot, WellAssembly } from "@ikhmalputra/subsurface-core";
import { assetUrl } from "./assembly-palette.js";
import { formatDepth, formatInches } from "./assembly-format.js";
import { CommandButton } from "./ui.js";

interface ExplodedPartsProps {
  readonly assembly: WellAssembly;
  readonly assetBaseUrl: string;
  readonly selectedId?: string | null;
  readonly issues?: readonly AssemblyIssue[];
  readonly onSelect?: (itemId: string | null) => void;
}

const GROUPS: readonly { readonly label: string; readonly slots: readonly AssemblySlot[] }[] = [
  { label: "Surface equipment", slots: ["surface"] },
  { label: "Casing strings & liners", slots: ["casing", "liner"] },
  { label: "Cement", slots: ["cement"] },
  { label: "Casing accessories", slots: ["casing-tool"] },
  { label: "Completion string", slots: ["tubing", "tubing-tool"] },
  { label: "Sandface completion", slots: ["sandface"] },
  { label: "Plugs & abandonment", slots: ["plug"] },
];

function sizeLine(item: AssemblyItem) {
  if (getCatalogEntry(item.catalogId).slot === "cement") return "Annular cement";
  return item.idIn ? `OD ${formatInches(item.odIn)} · ID ${formatInches(item.idIn)}` : `OD ${formatInches(item.odIn)}`;
}

function depthLine(item: AssemblyItem) {
  if (getCatalogEntry(item.catalogId).slot === "surface") return "At surface";
  return item.bottomM - item.topM < 3 ? `@ ${formatDepth((item.topM + item.bottomM) / 2)}` : `${formatDepth(item.topM)} → ${formatDepth(item.bottomM)}`;
}

/** Every component on its own card, grouped outside-in; rendered by `AssemblySchematic` when exploded. */
export function ExplodedParts({ assembly, assetBaseUrl, selectedId = null, issues = [], onSelect }: ExplodedPartsProps) {
  const td = Math.max(assembly.totalDepthM, 1);
  const state = (id: string) => issues.some((issue) => issue.itemId === id && issue.severity === "error") ? "error" : issues.some((issue) => issue.itemId === id && issue.severity === "warning") ? "warning" : "ok";
  const groups = GROUPS.map((group) => ({
    ...group,
    items: assembly.items
      .filter((item) => group.slots.includes(getCatalogEntry(item.catalogId).slot))
      .sort((a, b) => group.slots[0] === "casing" ? b.odIn - a.odIn || a.topM - b.topM : a.topM - b.topM),
  })).filter((group) => group.items.length);

  const root = useRef<HTMLDivElement>(null);
  const pickedHere = useRef(false);
  useEffect(() => {
    const container = root.current;
    if (pickedHere.current) { pickedHere.current = false; return; }
    if (!container || !selectedId) return;
    const reveal = () => {
      const card = container.querySelector<HTMLElement>(`.sw-asm-part[data-item-id="${CSS.escape(selectedId)}"]`);
      if (!card || container.scrollHeight <= container.clientHeight) return false;
      const top = card.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      if (top < container.scrollTop || top > container.scrollTop + container.clientHeight * 0.35) {
        container.scrollTo({ top: Math.max(0, top - 36), behavior: "smooth" });
      }
      return true;
    };
    const frame = requestAnimationFrame(() => {
      if (reveal()) return;
      const observer = new ResizeObserver(() => { if (reveal()) observer.disconnect(); });
      observer.observe(container);
      cleanup = () => observer.disconnect();
    });
    let cleanup = () => {};
    return () => { cancelAnimationFrame(frame); cleanup(); };
  }, [selectedId]);

  return <div ref={root} className="sw-asm-exploded" data-testid="assembly-exploded" data-has-selection={selectedId ? "true" : undefined}
    onPointerDown={(event) => { if (event.target === event.currentTarget) onSelect?.(null); }}>
    {groups.map((group) => <section key={group.label} className="sw-asm-exploded-group" aria-label={group.label}>
      <h3>{group.label}<span>{group.items.length}</span></h3>
      <ul>
        {group.items.map((item) => {
          const spec = getCatalogEntry(item.catalogId);
          const selected = item.id === selectedId;
          const top = Math.min(100, item.topM / td * 100);
          const height = Math.max(2.5, (item.bottomM - item.topM) / td * 100);
          return <li key={item.id}>
            <CommandButton kind="selection" type="button" className={`sw-asm-part${selected ? " is-selected" : ""}`} data-item-id={item.id} data-state={state(item.id)} aria-pressed={selected}
              aria-label={`${item.label}, ${spec.kind}, ${sizeLine(item)}, ${depthLine(item)}`} onClick={() => { pickedHere.current = true; onSelect?.(selected ? null : item.id); }}>
              <span className="sw-asm-part-render" style={{ ["--sw-part-tone" as string]: spec.color }}><img src={assetUrl(assetBaseUrl, spec.asset.thumbnail)} alt="" width={96} height={96} loading="lazy" draggable={false} /></span>
              <span className="sw-asm-part-depth" aria-hidden title={`Position in the well: ${depthLine(item)}`}><i style={{ top: `${Math.min(top, 100 - height)}%`, height: `${height}%`, background: spec.color }} /></span>
              <span className="sw-asm-part-text">
                <small>{spec.kind}</small>
                <strong>{item.label}</strong>
                <span>{sizeLine(item)}</span>
                <span>{depthLine(item)}</span>
              </span>
            </CommandButton>
          </li>;
        })}
      </ul>
    </section>)}
  </div>;
}
