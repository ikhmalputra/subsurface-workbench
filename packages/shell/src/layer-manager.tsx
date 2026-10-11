"use client";

import { CommandButton } from "./ui.js";

/** Where a layer's values came from. Rendered, not buried in prose. */
export type Provenance = "documented" | "synthetic" | "user-authored";

const provenanceLabel: Readonly<Record<Provenance, string>> = {
  documented: "Sourced",
  synthetic: "Synthetic",
  "user-authored": "Edited",
};

const provenanceTitle: Readonly<Record<Provenance, string>> = {
  documented: "Values come from a cited source record.",
  synthetic: "Values are generated or assumed, not measured.",
  "user-authored": "Values were changed by you; the source record is unchanged.",
};

export interface WorkbenchLayer {
  readonly id: string;
  readonly label: string;
  readonly visible: boolean;
  readonly locked?: boolean;
  readonly provenance?: Provenance;
  /** Short qualifier, e.g. an interval or a count. Keep units explicit. */
  readonly detail?: string;
  /** Count of items the layer draws; `null` means not reported rather than zero. */
  readonly count?: number | null;
  /**
   * False when the current renderer cannot honour per-layer visibility yet. The control is shown
   * disabled with a reason rather than offered as a toggle that silently does nothing.
   */
  readonly toggleable?: boolean;
  readonly toggleHint?: string;
}

export interface LayerManagerProps {
  readonly layers: readonly WorkbenchLayer[];
  readonly selectedId?: string | null;
  readonly onSelect?: (id: string | null) => void;
  readonly onToggleVisible?: (id: string) => void;
  readonly onToggleLocked?: (id: string) => void;
}

export function LayerManager({ layers, selectedId, onSelect, onToggleVisible, onToggleLocked }: LayerManagerProps) {
  if (!layers.length) return <p className="swb-empty">No layers in this document.</p>;
  return <ul className="swb-layers" aria-label="Layers">
    {layers.map((layer) => {
      const selected = layer.id === selectedId;
      return <li key={layer.id} className="swb-layer" data-layer-id={layer.id} data-selected={selected || undefined}
        data-visible={layer.visible} data-locked={layer.locked || undefined}>
        {onToggleVisible ? <CommandButton icon={layer.visible ? "view" : "hide"} aria-pressed={layer.visible}
          aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.label}`} disabled={layer.toggleable === false}
          title={layer.toggleable === false ? layer.toggleHint ?? "This renderer cannot hide this layer separately yet." : undefined}
          onClick={() => onToggleVisible(layer.id)} /> : null}
        <CommandButton kind="selection" className="swb-layer-name" aria-pressed={selected}
          onClick={() => onSelect?.(selected ? null : layer.id)}>
          <span>{layer.label}</span>
          <small>
            {layer.detail ?? (layer.count === null ? "not reported" : layer.count !== undefined ? `${layer.count} items` : "")}
          </small>
        </CommandButton>
        {layer.provenance ? <span className="swb-badge" data-provenance={layer.provenance} title={provenanceTitle[layer.provenance]}>
          {provenanceLabel[layer.provenance]}
        </span> : null}
        {onToggleLocked ? <CommandButton icon={layer.locked ? "lock" : "unlock"} aria-pressed={layer.locked ?? false}
          aria-label={`${layer.locked ? "Unlock" : "Lock"} ${layer.label}`} onClick={() => onToggleLocked(layer.id)} /> : null}
      </li>;
    })}
  </ul>;
}
