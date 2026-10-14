import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { forgeWell, sites } from "../data/sites.ts";
import { fmt } from "../format.ts";
import { usePlace } from "../data/place.ts";
import { designHistory } from "../data/design.ts";
import { dateToMs } from "@ikhmalputra/subsurface-core/records";
import { allDates, formatDate, momentOn } from "../data/history.ts";
import { modules, signalColour } from "../modules/registry.ts";
import { actions, signals, useDeck } from "./store.ts";

/**
 * Words, not letters: every typed word must start a word of the command (or, weaker, of its
 * keywords). Fuzzy letter matching sent "open runs" to "Open Curved construction".
 */
function scoreCommand(value: string, search: string, keywords: readonly string[] = []): number {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const own = value.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
  const extra = keywords.join(" ").toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
  let score = 0;
  for (const word of words) {
    const at = own.findIndex((candidate) => candidate.startsWith(word));
    if (at >= 0) { score += 1 + (own[at] === word ? 0.5 : 0) - at * 0.01; continue; }
    if (extra.some((candidate) => candidate.startsWith(word))) { score += 0.3; continue; }
    return 0;
  }
  return score / words.length / 1.5;
}

/** ⌘K: every action is a command, so anything the deck does can be typed. */
export function CommandBar() {
  const open = useDeck((deck) => deck.commandOpen);
  const theme = useDeck((deck) => deck.theme);
  const tiles = useDeck((deck) => deck.tiles);
  const siteId = useDeck((deck) => deck.siteId);
  const [search, setSearch] = useState("");
  const place = usePlace();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); actions.openCommand(!open); }
      if (event.key === "Escape" && open) actions.openCommand(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => { if (!open) setSearch(""); }, [open]);
  if (!open) return null;
  const run = (action: () => void) => () => { actions.openCommand(false); action(); };
  const dot = (colour: string) => ({ ["--dot" as string]: colour });
  // "depth 2500" or "md 2,500": a typed depth is a command of its own.
  const typed = /^(?:depth|md|go to)\s+([\d,.]+)\s*m?$/i.exec(search.trim());
  const typedMd = typed ? Number(typed[1]!.replace(/,/g, "")) : null;
  const forge = siteId === "forge";
  // "day 23" or "2020-11-22": a typed moment is a command of its own.
  const typedDay = /^day\s+(-?\d+)$/i.exec(search.trim());
  const typedDate = /^(\d{4}-\d{2}-\d{2})$/.exec(search.trim());
  const moment = typedDay ? allDates.map(momentOn).find((entry) => entry.asOf.dayFromSpud === Number(typedDay[1])) : typedDate && allDates.includes(typedDate[1]!) ? momentOn(typedDate[1]!) : undefined;
  const records = place?.components ?? [];
  return <div className="cmd-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) actions.openCommand(false); }}>
    <Command className="cmd" label="Command bar" loop filter={scoreCommand}>
      <Command.Input autoFocus value={search} onValueChange={setSearch} placeholder="Fly to a site, open a module, select a string, “depth 2500”…" />
      <Command.List>
        <Command.Empty>No command matches.</Command.Empty>
        {typedMd !== null && place && typedMd <= place.totalDepthM && <Command.Group heading="Depth" forceMount>
          <Command.Item value={search} forceMount onSelect={run(() => signals.pinDepth(place.wellId, typedMd, "deck:bar"))}><i style={dot(signalColour.depth)} />Pin {fmt(typedMd)} m MD on {place.label}</Command.Item>
        </Command.Group>}
        {moment && forge && <Command.Group heading="Time" forceMount>
          <Command.Item value={search} forceMount onSelect={run(() => signals.setTimeCursor(dateToMs(moment.date), "deck:bar"))}><i style={dot(signalColour.time)} />Go to day {moment.asOf.dayFromSpud} · {formatDate(moment.date)} · {fmt(moment.asOf.drilledFt)} ft</Command.Item>
        </Command.Group>}
        <Command.Group heading="Places">
          {sites.map((site) => <Command.Item key={site.map.id} value={`fly to ${site.map.label}`} onSelect={run(() => actions.selectSite(site.map.id, null, "bar"))}><i style={dot(signalColour.place)} />Fly to {site.map.label}</Command.Item>)}
          {sites.flatMap((site) => site.wells.length > 1 ? site.wells.map((well) => <Command.Item key={well.id} value={`select well ${well.label} ${site.map.label}`} onSelect={run(() => actions.selectSite(site.map.id, well.id, "bar"))}><i style={dot(signalColour.place)} />Select {well.label}</Command.Item>) : [])}
          <Command.Item value="back to the world globe" onSelect={run(() => actions.selectSite(null))}><i style={dot(signalColour.place)} />Back to the world</Command.Item>
        </Command.Group>
        {records.length > 0 && <Command.Group heading="Select">
          {records.map((component) => <Command.Item key={component.id} value={`select ${component.name}`} keywords={[component.kind, component.material]} onSelect={run(() => signals.selectComponent(component.id, "deck:bar"))}><i style={dot(signalColour.object)} />Select {component.name}<kbd>{component.kind}</kbd></Command.Item>)}
          <Command.Item value="clear selection" onSelect={run(() => signals.selectComponent(null, "deck:bar"))}><i style={dot(signalColour.object)} />Clear the selection</Command.Item>
        </Command.Group>}
        <Command.Group heading="Modules">
          {modules.map((spec) => tiles[spec.id]
            ? <Command.Item key={spec.id} value={`stage ${spec.title}`} keywords={[spec.blurb, "open", spec.group]} onSelect={run(() => actions.promote(spec.id))}><i />Bring {spec.title} to the stage<kbd>{spec.group} · open</kbd></Command.Item>
            : <Command.Item key={spec.id} value={`open ${spec.title}`} keywords={[spec.blurb, spec.group]} onSelect={run(() => actions.open(spec.id))}><i />Open {spec.title}<kbd>{spec.group}</kbd></Command.Item>)}
        </Command.Group>
        <Command.Group heading="Close">
          {modules.filter((spec) => tiles[spec.id]).map((spec) => <Command.Item key={spec.id} value={`close ${spec.title}`} onSelect={run(() => actions.close(spec.id))}><i />Close {spec.title}</Command.Item>)}
        </Command.Group>
        {forge && <Command.Group heading="Time">
          <Command.Item value="go to the first report" keywords={["time", "drilling", "play", "replay", "spud"]} onSelect={run(() => signals.setTimeCursor(dateToMs(allDates[0]!), "deck:bar"))}><i style={dot(signalColour.time)} />Go to the first report<kbd>then ▶ or space on the time rail</kbd></Command.Item>
          <Command.Item value="show the well as finally recorded" keywords={["time", "now", "final", "as recorded"]} onSelect={run(() => signals.setTimeCursor(null, "deck:bar"))}><i style={dot(signalColour.time)} />Show the well as finally recorded</Command.Item>
          {forgeWell.operations.milestones.map((milestone) => <Command.Item key={milestone.id} value={`go to ${milestone.label}`} keywords={["time", milestone.date]} onSelect={run(() => signals.setTimeCursor(dateToMs(milestone.date), "deck:bar"))}><i style={dot(signalColour.time)} />{milestone.label}<kbd>{formatDate(milestone.date)}</kbd></Command.Item>)}
        </Command.Group>}
        {siteId === "kestrel" && <Command.Group heading="Design">
          <Command.Item value="apply the what-if" keywords={["design", "commit"]} onSelect={run(() => designHistory.apply())}><i style={dot(signalColour.whatif)} />Apply the what-if<kbd>⌘↵</kbd></Command.Item>
          <Command.Item value="discard the what-if" keywords={["design", "cancel"]} onSelect={run(() => designHistory.discard())}><i style={dot(signalColour.whatif)} />Discard the what-if<kbd>Esc</kbd></Command.Item>
          <Command.Item value="undo" keywords={["design", "back"]} onSelect={run(() => designHistory.undo())}><i style={dot(signalColour.whatif)} />Undo{designHistory.getState().undo.at(-1) ? `: ${designHistory.getState().undo.at(-1)!.label}` : ""}<kbd>⌘Z</kbd></Command.Item>
          <Command.Item value="redo" keywords={["design"]} onSelect={run(() => designHistory.redo())}><i style={dot(signalColour.whatif)} />Redo{designHistory.getState().redo.at(-1) ? `: ${designHistory.getState().redo.at(-1)!.label}` : ""}<kbd>⇧⌘Z</kbd></Command.Item>
        </Command.Group>}
        <Command.Group heading="Deck">
          <Command.Item value="clear depth cursor" onSelect={run(() => signals.pinDepth(signals.getState().activeAsset.wellId, null, "deck:bar"))}><i style={dot(signalColour.depth)} />Clear the depth cursor</Command.Item>
          <Command.Item value="whole well clear depth window" onSelect={run(() => signals.setDepthWindow(null, "deck:bar"))}><i style={dot(signalColour.depth)} />Show the whole well</Command.Item>
          <Command.Item value="links patch bay connections" onSelect={run(() => actions.setPatch(true))}><i />Show every link between modules<kbd>hold ⌥</kbd></Command.Item>
          <Command.Item value="reset layout" onSelect={run(actions.resetLayout)}><i />Reset the layout</Command.Item>
          <Command.Item value={theme === "night" ? "day deck light theme" : "night deck dark theme"} onSelect={run(() => actions.setTheme(theme === "night" ? "day" : "night"))}><i />{theme === "night" ? "Switch to the day deck" : "Switch to the night deck"}</Command.Item>
        </Command.Group>
      </Command.List>
    </Command>
  </div>;
}
