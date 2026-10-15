import { useEffect, useRef, useState } from "react";
import { FilePlus2, FileUp, Waves, Mountain, Anchor, X } from "lucide-react";
import { addRecordedWell } from "../data/records.ts";
import type { WellRecordValue } from "../data/records.ts";
import { emptyWellBrief } from "@ikhmalputra/subsurface-core";
import type { WellDesignBrief, WellEnvironment } from "@ikhmalputra/subsurface-core";
import { addDesign, initialHydraulics, parseDesignFile, useDesigns } from "../data/design.ts";
import type { DesignValue } from "../data/design.ts";
import { actions, useDeck } from "./store.ts";

/**
 * Starting a planned well: a name, where it is, and what to start from — a blank brief, or a copy of
 * a design already in the deck (its geology, trajectory, casing and completion, moved to the new
 * place). Or a design file exported from another deck. Creating it flies there and opens the
 * designer, where every stage is filled in and checked.
 */
export function NewWell() {
  const open = useDeck((deck) => deck.newWellOpen);
  if (!open) return null;
  return <NewWellDialog />;
}

const ENVIRONMENTS: readonly { readonly id: WellEnvironment; readonly label: string; readonly icon: typeof Waves; readonly rkb: number }[] = [
  { id: "onshore", label: "Onshore", icon: Mountain, rkb: 8 },
  { id: "offshore-platform", label: "Offshore platform", icon: Anchor, rkb: 30 },
  { id: "offshore-subsea", label: "Subsea (floater)", icon: Waves, rkb: 25 },
];

function NewWellDialog() {
  const designs = useDesigns();
  const [mode, setMode] = useState<"plan" | "record">("plan");
  const [name, setName] = useState("");
  const [from, setFrom] = useState<string>("blank");
  const [environment, setEnvironment] = useState<WellEnvironment>("onshore");
  const [lat, setLat] = useState(""), [lon, setLon] = useState("");
  const [level, setLevel] = useState(""); // ground elevation onshore, water depth offshore
  const [rkb, setRkb] = useState("8");
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") actions.openNewWell(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const offshore = environment !== "onshore";
  const number = (text: string) => text.trim() === "" ? null : Number(text);

  const create = () => {
    const latitude = number(lat), longitude = number(lon), height = number(rkb), levelM = number(level);
    if (!name.trim()) return setError("Give the well a name.");
    if (latitude === null || !Number.isFinite(latitude) || Math.abs(latitude) > 84) return setError("Latitude must be between −84 and 84 degrees.");
    if (longitude === null || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return setError("Longitude must be between −180 and 180 degrees.");
    if (height === null || !Number.isFinite(height) || height < 0 || height > 100) return setError("Rig floor height must be between 0 and 100 m.");
    if (levelM !== null && (!Number.isFinite(levelM) || (offshore && levelM <= 0))) return setError(offshore ? "Water depth must be a positive number of metres." : "Ground elevation must be a number of metres.");
    if (mode === "record") {
      const value: WellRecordValue = {
        identity: { name: name.trim(), field: "", operator: "", country: "", uwi: "" },
        location: { environment, latitude, longitude, groundElevationM: offshore ? null : levelM, waterDepthM: offshore ? levelM : null },
        datum: { reference: "RKB", elevationMslM: offshore ? height : levelM === null ? null : levelM + height },
        totalDepthM: 1000, stations: [], surveySource: "", tops: [], components: [],
      };
      const entry = addRecordedWell(value);
      actions.openNewWell(false);
      actions.editWell(entry.siteId, null, "bar");
      return;
    }
    const source = designs.find((entry) => entry.record.id === from);
    const base: WellDesignBrief = source ? source.value.brief : emptyWellBrief();
    // The rig floor sits a height above the sea (offshore) or the ground (onshore, at its elevation).
    const elevation = offshore ? height : levelM === null ? null : levelM + height;
    const brief: WellDesignBrief = {
      ...base,
      identity: { ...base.identity, name: name.trim(), ...(source ? {} : { field: "", operator: "", country: "" }) },
      location: { ...base.location, environment, crs: "WGS 84", latitude, longitude, waterDepthM: offshore ? levelM : null, groundElevationM: offshore ? null : levelM },
      datum: { reference: "RKB", elevationAboveMslM: elevation },
      origin: source ? { offsetId: source.record.id, offsetName: source.value.brief.identity.name, parts: ["geology", "casing", "completion"] } : undefined,
    };
    const value: DesignValue = source ? { ...source.value, brief } : { brief, hydraulics: initialHydraulics, buildHold: null };
    const record = addDesign(value);
    actions.openNewWell(false);
    actions.designWell(record.siteId, "bar");
  };

  const importFile = async (chosen: File | undefined) => {
    if (!chosen) return;
    try {
      const text = await chosen.text();
      // A recorded well's file, or a design's.
      const parsed = JSON.parse(text) as { format?: string; value?: WellRecordValue };
      if (parsed.format === "subsurface-deck-well" && parsed.value?.identity && Array.isArray(parsed.value.stations)) {
        const entry = addRecordedWell(parsed.value);
        actions.openNewWell(false);
        actions.editWell(entry.siteId, null, "bar");
        return;
      }
      const value = parseDesignFile(text);
      const record = addDesign(value);
      actions.openNewWell(false);
      actions.designWell(record.siteId, "bar");
    } catch (reason) {
      setError(`${chosen.name}: ${(reason as Error).message}`);
    }
  };

  return <div className="cmd-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) actions.openNewWell(false); }}>
    <form className="nw" role="dialog" aria-modal="true" aria-labelledby="nw-title" onSubmit={(event) => { event.preventDefault(); create(); }}>
      <header className="nw-head">
        <FilePlus2 size={18} aria-hidden="true" />
        <div><h2 id="nw-title">New well</h2><p>{mode === "plan" ? "A planned well: name it and place it. Everything else is filled in, stage by stage, in the Well designer." : "A well that has been drilled: name it and place it, then enter its survey, tops, casing and logs in the Well editor, typed, pasted or imported."}</p></div>
        <button type="button" className="nw-close" aria-label="Close" onClick={() => actions.openNewWell(false)}><X size={16} /></button>
      </header>
      <div className="nw-mode" role="radiogroup" aria-label="Kind of well">
        <button type="button" role="radio" aria-checked={mode === "plan"} onClick={() => setMode("plan")}><b>Plan a new well</b><small>A design: geology, trajectory, casing proposed and checked</small></button>
        <button type="button" role="radio" aria-checked={mode === "record"} onClick={() => setMode("record")}><b>Record a drilled well</b><small>As drilled: survey, tops, casing records, LAS logs</small></button>
      </div>
      <label className="nw-field nw-name">Name<input ref={first} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Merlin-2" /></label>

      {mode === "plan" && <fieldset className="nw-group">
        <legend>Start from</legend>
        <div className="nw-starts">
          <button type="button" aria-pressed={from === "blank"} onClick={() => setFrom("blank")}><b>Blank</b><small>Enter the geology, trajectory, casing and completion yourself</small></button>
          {designs.map((entry) => <button key={entry.record.id} type="button" aria-pressed={from === entry.record.id} onClick={() => { setFrom(entry.record.id); setEnvironment(entry.value.brief.location.environment); }}>
            <b>Copy of {entry.value.brief.identity.name || "Unnamed well"}</b><small>{entry.value.brief.sections.length} strings · {entry.value.brief.geology.pressures.length} pressure points · moved to the new place</small>
          </button>)}
        </div>
      </fieldset>}

      <fieldset className="nw-group">
        <legend>Where</legend>
        <div className="nw-env" role="radiogroup" aria-label="Environment">
          {ENVIRONMENTS.map((entry) => <button key={entry.id} type="button" role="radio" aria-checked={environment === entry.id} onClick={() => { setEnvironment(entry.id); setRkb(String(entry.rkb)); }}><entry.icon size={15} aria-hidden="true" />{entry.label}</button>)}
        </div>
        <div className="nw-grid">
          <label className="nw-field">Latitude<span><input inputMode="decimal" value={lat} onChange={(event) => setLat(event.target.value)} placeholder="e.g. 38.504" /><i>° N</i></span></label>
          <label className="nw-field">Longitude<span><input inputMode="decimal" value={lon} onChange={(event) => setLon(event.target.value)} placeholder="e.g. −112.896" /><i>° E</i></span></label>
          <label className="nw-field">{offshore ? "Water depth" : "Ground elevation"}<span><input inputMode="decimal" value={level} onChange={(event) => setLevel(event.target.value)} placeholder={offshore ? "e.g. 85" : "e.g. 1650"} /><i>m</i></span></label>
          <label className="nw-field">Rig floor (RKB) above {offshore ? "sea" : "ground"}<span><input inputMode="decimal" value={rkb} onChange={(event) => setRkb(event.target.value)} /><i>m</i></span></label>
        </div>
        <p className="nw-hint">WGS 84 latitude and longitude; south and west are negative. {offshore ? "" : "Leave the ground elevation empty if you do not know it yet: the designer will ask for it."}</p>
      </fieldset>

      {error && <p className="nw-error" role="alert">{error}</p>}
      <footer className="nw-foot">
        <button type="button" className="nw-import" onClick={() => file.current?.click()} title="A .design.json or .well.json exported from a deck"><FileUp size={14} aria-hidden="true" />Import a well file…</button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }} />
        <span className="nw-spacer" />
        <button type="button" className="nw-cancel" onClick={() => actions.openNewWell(false)}>Cancel</button>
        <button type="submit" className="nw-create">{mode === "plan" ? "Create and open the designer" : "Create and open the editor"}</button>
      </footer>
    </form>
  </div>;
}
