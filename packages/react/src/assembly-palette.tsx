"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { assemblyCatalog, assemblyCategories } from "@ikhmalputra/subsurface-core";
import type { AssemblyCatalogEntry, AssemblyCategory } from "@ikhmalputra/subsurface-core";
import { ChevronDown, Plus, Search } from "lucide-react";
import { CommandButton } from "./ui.js";

/** MIME type carried by palette drags. A second `${WELL_COMPONENT_MIME}-<id>` type exposes the id during dragover. */
export const WELL_COMPONENT_MIME = "application/x-well-component";

export function catalogIdFromDrag(event: { dataTransfer: DataTransfer | null }): string | null {
  const types = Array.from(event.dataTransfer?.types ?? []);
  const typed = types.find((type) => type.startsWith(`${WELL_COMPONENT_MIME}-`));
  if (typed) return typed.slice(WELL_COMPONENT_MIME.length + 1);
  return types.includes(WELL_COMPONENT_MIME) ? event.dataTransfer?.getData(WELL_COMPONENT_MIME) || null : null;
}

export function assetUrl(assetBaseUrl: string, file: string) {
  return `${assetBaseUrl.replace(/\/$/, "")}/${file}`;
}

export interface ComponentPaletteProps {
  /** URL where `@ikhmalputra/subsurface-react/assets/well-components/*` is served. */
  readonly assetBaseUrl: string;
  readonly catalog?: readonly AssemblyCatalogEntry[];
  /** Click / Enter fallback for drag and drop. */
  readonly onAdd?: (catalogId: string) => void;
  readonly onDragStateChange?: (catalogId: string | null) => void;
  readonly title?: string;
}


export function ComponentPalette({ assetBaseUrl, catalog = assemblyCatalog, onAdd, onDragStateChange, title = "Component library" }: ComponentPaletteProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<AssemblyCategory>>(() => new Set());
  const toggle = (category: AssemblyCategory) => setCollapsed((current) => { const next = new Set(current); if (next.has(category)) next.delete(category); else next.add(category); return next; });
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? catalog.filter((value) => `${value.label} ${value.description} ${value.kind}`.toLowerCase().includes(needle)) : catalog;
  }, [catalog, query]);
  return <section className="sw-asm-palette" aria-label={title}>
    <header className="sw-asm-palette-head">
      <h2>{title}</h2>
      <small>{catalog.length} components · drag onto the schematic or 3D view, or press Add.</small>
      <label className="sw-asm-search"><Search size={14} aria-hidden /><span className="sw-asm-sr">Filter components</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter components" /></label>
    </header>
    <div className="sw-asm-palette-scroll">
      {assemblyCategories.map((category) => {
        const entries = filtered.filter((value) => value.category === category);
        if (!entries.length) return null;
        const open = Boolean(query.trim()) || !collapsed.has(category);
        const listId = `sw-asm-group-${category.replace(/\W+/g, "-").toLowerCase()}`;
        return <div key={category} className="sw-asm-group" role="group" aria-label={category}>
          <h3><CommandButton type="button" className="sw-asm-group-toggle" aria-expanded={open} aria-controls={listId} onClick={() => toggle(category)}><ChevronDown size={14} aria-hidden /><span>{category}</span><small>{entries.length}</small></CommandButton></h3>
          <ul id={listId} hidden={!open}>
            {entries.map((value) => <li key={value.id}>
              <article className="sw-asm-tile" draggable data-catalog-id={value.id} aria-label={`${value.label}: ${value.description}`} style={{ "--sw-asm-tone": value.color } as CSSProperties}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData(WELL_COMPONENT_MIME, value.id);
                  event.dataTransfer.setData(`${WELL_COMPONENT_MIME}-${value.id}`, value.id);
                  event.dataTransfer.setData("text/plain", value.label);
                  const image = event.currentTarget.querySelector("img");
                  if (image) event.dataTransfer.setDragImage(image, 40, 40);
                  onDragStateChange?.(value.id);
                }}
                onDragEnd={() => onDragStateChange?.(null)}>
                <div className="sw-asm-tile-render"><img src={assetUrl(assetBaseUrl, value.asset.thumbnail)} alt="" width={84} height={84} draggable={false} loading="lazy" /></div>
                <div className="sw-asm-tile-copy">
                  <strong>{value.label}</strong>
                  <span>{value.odIn ? `${Number(value.odIn.toFixed(3))} in OD` : "Annular fill"}</span>
                  <small>{value.placementHint}</small>
                </div>
                {onAdd && <CommandButton type="button" className="sw-asm-add" aria-label={`Add ${value.label}`} onClick={() => onAdd(value.id)}><Plus size={14} /></CommandButton>}
              </article>
            </li>)}
          </ul>
        </div>;
      })}
      {!filtered.length && <p className="sw-asm-empty">No component matches “{query}”.</p>}
    </div>
  </section>;
}
