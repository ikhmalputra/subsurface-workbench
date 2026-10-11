"use client";

import { useId, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ComponentId, WellComponent } from "@ikhmalputra/subsurface-core";
import { CommandButton } from "./ui.js";

export interface ComponentInventoryProps {
  readonly components: readonly WellComponent[];
  readonly selectedId?: ComponentId | null;
  readonly onSelect: (id: ComponentId) => void;
  /** Rows per page. Large records (hundreds of joints) stay responsive. Default 12. */
  readonly pageSize?: number;
  readonly title?: string;
}

const metres = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });

function depthText(component: WellComponent) {
  if (component.topDepthReported === false) return `to ${metres(component.bottomDepthM)} m`;
  if (component.topDepthM === component.bottomDepthM) return `${metres(component.topDepthM)} m`;
  return `${metres(component.topDepthM)}–${metres(component.bottomDepthM)} m`;
}

/** Searchable, type-filtered, paged list of every record in a well. Selection is controlled. */
export function ComponentInventory({ components, selectedId = null, onSelect, pageSize = 12, title = "Component inventory" }: ComponentInventoryProps) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(0);
  const [followed, setFollowed] = useState<ComponentId | null>(selectedId);

  const kinds = [...new Set(components.map((component) => component.kind))];
  const needle = search.trim().toLowerCase();
  const matching = components.filter((component) => (kind === "all" || component.kind === kind) && (!needle || `${component.name} ${component.kind} ${component.material} ${component.id}`.toLowerCase().includes(needle)));
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));

  // Selection made elsewhere (schematic, 3D) brings its row into view.
  if (selectedId !== followed) {
    setFollowed(selectedId);
    const index = matching.findIndex((component) => component.id === selectedId);
    if (index >= 0) setPage(Math.floor(index / pageSize));
  }

  const current = Math.min(page, pageCount - 1);
  const rows = matching.slice(current * pageSize, (current + 1) * pageSize);

  return <section className="sw-inv" aria-label={title} data-testid="component-inventory">
    <header className="sw-inv-head">
      <h2>{title}</h2>
      <span data-testid="component-inventory-total">{components.length.toLocaleString("en-US")} records</span>
    </header>
    <div className="sw-inv-filters">
      <label htmlFor={`${id}-search`}>Search</label>
      <input id={`${id}-search`} type="search" placeholder="Name, type or material" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
      <label htmlFor={`${id}-kind`}>Type</label>
      <select id={`${id}-kind`} value={kind} onChange={(event) => { setKind(event.target.value); setPage(0); }}>
        <option value="all">All types ({components.length})</option>
        {kinds.map((value) => <option key={value} value={value}>{value} ({components.filter((component) => component.kind === value).length})</option>)}
      </select>
    </div>
    {rows.length === 0 ? <p className="sw-inv-empty">No matching records.</p> : <ul className="sw-inv-list">
      {rows.map((component) => <li key={component.id}>
        <CommandButton kind="selection" type="button" aria-pressed={component.id === selectedId} data-component-id={component.id} onClick={() => onSelect(component.id)}>
          <strong>{component.name}</strong>
          <small><span>{component.kind}</span><span>{depthText(component)}</span></small>
        </CommandButton>
      </li>)}
    </ul>}
    <footer className="sw-inv-pager">
      <CommandButton type="button" aria-label="Previous records" disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft size={16} aria-hidden="true" /></CommandButton>
      <span aria-live="polite">{matching.length.toLocaleString("en-US")} matching · page {current + 1} of {pageCount}</span>
      <CommandButton type="button" aria-label="Next records" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}><ChevronRight size={16} aria-hidden="true" /></CommandButton>
    </footer>
  </section>;
}
