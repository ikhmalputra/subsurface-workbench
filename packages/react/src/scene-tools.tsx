"use client";

import { FlipVertical2, Scissors } from "lucide-react";
import type { SectionAxis, SectionState } from "./section-tool.js";
import type { NamedView, ViewCubeLabels } from "./view-cube.js";
import { CommandButton } from "./ui.js";

/**
 * The heads-up controls every 3D scene shares: a section pill (on/off, which way to cut, where,
 * which side to keep) and a keyboard route to the view cube's views. They sit on the canvas in
 * small translucent pills and never take a band of the drawing.
 */

export function SceneSectionControl({ state, onChange, axes }: {
  readonly state: SectionState | null;
  readonly onChange: (state: SectionState | null) => void;
  /** What each axis is called in this scene, e.g. { x: "East–west", y: "Depth", z: "North–south" }. */
  readonly axes: Readonly<Partial<Record<SectionAxis, string>>>;
}) {
  const choices = Object.entries(axes) as [SectionAxis, string][];
  const first = choices[0]?.[0] ?? "x";
  // Clicks here are the pill's, not the canvas's: a scene that picks on pointer-up must not see them.
  const own = { onPointerDown: (event: { stopPropagation(): void }) => event.stopPropagation(), onPointerUp: (event: { stopPropagation(): void }) => event.stopPropagation() };
  return <div className="sw-scene-hud sw-scene-section" role="group" aria-label="Section plane" {...own}>
    <CommandButton kind="selection" aria-pressed={state !== null} title="Cut the model with a section plane" onClick={() => onChange(state ? null : { axis: first, at: 0.5, flip: false })}><Scissors size={15} aria-hidden="true" />Section</CommandButton>
    {state && <>
      <span className="sw-scene-hud-segment" role="group" aria-label="Section direction">
        {choices.map(([axis, label]) => <CommandButton key={axis} kind="selection" aria-pressed={state.axis === axis} onClick={() => onChange({ ...state, axis })}>{label}</CommandButton>)}
      </span>
      <label className="sw-scene-hud-range"><span className="sw-sr-only">Section position</span>
        <input type="range" min={0} max={1000} value={Math.round(state.at * 1000)} onChange={(event) => onChange({ ...state, at: Number(event.target.value) / 1000 })} />
      </label>
      <CommandButton kind="selection" aria-pressed={state.flip} aria-label="Keep the other side" title="Keep the other side" onClick={() => onChange({ ...state, flip: !state.flip })}><FlipVertical2 size={15} aria-hidden="true" /></CommandButton>
    </>}
  </div>;
}

/** Buttons for the cube's six faces and home; hidden until focused, so a keyboard user can turn the view. */
export function SceneViewKeys({ labels, onView }: { readonly labels: ViewCubeLabels; readonly onView: (view: NamedView) => void }) {
  const views: [NamedView, string][] = [["home", "Home"], ["top", labels.py], ["nz", labels.nz], ["pz", labels.pz], ["px", labels.px], ["nx", labels.nx], ["bottom", labels.ny]];
  return <div className="sw-scene-view-keys" role="group" aria-label="View from" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
    {views.map(([view, label]) => <CommandButton key={view} kind="selection" aria-label={view === "home" ? "Home view" : `View from ${label.toLowerCase()}`} onClick={() => onView(view)}>{label.charAt(0) + label.slice(1).toLowerCase()}</CommandButton>)}
  </div>;
}
