import { Gauge } from "lucide-react";
import { metresToFeet, millimetresToInches } from "@ikhmalputra/subsurface-core";
import { stringRatings } from "../data/forge.ts";
import { stringsOf, tvdOn } from "../data/place.ts";
import { fmt } from "../format.ts";
import { formatDate, installs, useMoment } from "../data/history.ts";
import { Loads } from "./EngineeringModules.tsx";
import { Empty } from "./Empty.tsx";
import { Frame, Inspector, Status } from "./frame/Frame.tsx";
import { useWire } from "./wire.ts";

const psi = (value: number) => `${fmt(value)} psi`;
const NR = "not reported";

/**
 * The strings. On a design (Kestrel A-7) every string with its loads, live under what-if; on a
 * drilled well (FORGE) the selected string as the record gives it, and what API TR 5C3 says it can
 * take. The wall there is the API 5CT nominal wall for the reported OD and weight, and says so: the
 * record has no wall or ID, and no pore or fracture pressure to load it with.
 */
export function Strings() {
  const wire = useWire("strings");
  const place = wire.place!;
  return place.kind === "design" ? <Loads /> : <RecordedString />;
}

function RecordedString() {
  const wire = useWire("strings");
  const moment = useMoment();
  const place = wire.place!;
  const strings = stringsOf(place);
  const selected = wire.selected;
  const component = selected && strings.includes(selected) ? selected : null;
  if (!component) return <div className="string-card">
    <Empty icon={Gauge} title={selected ? `${selected.name} is not a string` : "No string selected"}>{`Select a casing string in any view to see its record and its API ratings. ${strings.length} strings: ${strings.map((entry) => entry.name.split(" / ")[0]).join(", ")}.`}</Empty>
    <div className="string-picks" role="group" aria-label="Strings">{strings.map((entry) => <button key={entry.id} type="button" onClick={() => wire.select(entry.id)}>{entry.name}</button>)}</div>
  </div>;
  const rated = stringRatings(component);
  const shoeMd = component.bottomDepthM;
  // At the time cursor the string may not be in the well yet, or be part-run.
  const runs = installs.filter((event) => event.componentId === component.id);
  const now = moment?.asOf.components.find((entry) => entry.id === component.id);
  const status = !moment ? null : !now ? `Not yet run on ${formatDate(moment.date)}. ${runs.map((event) => `${event.label}: ${formatDate(event.date)}, p. ${event.page}`).join(" · ")}.`
    : now.bottomDepthM < component.bottomDepthM - 0.5 ? `On ${formatDate(moment.date)} run to ${fmt(now.rawBottomDepthFt ?? metresToFeet(now.bottomDepthM))} ft of ${fmt(component.rawBottomDepthFt ?? metresToFeet(shoeMd))} ft.` : null;
  const tvd = tvdOn(place, shoeMd);
  return <Frame name="strings" title={component.name} subtitle="Casing string · the record and its API TR 5C3 ratings"
    tools={<label className="string-pick">String <select value={component.id} onChange={(event) => wire.select(event.target.value)}>
      {strings.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
    </select></label>}
    canvas={<div className="string-card">
      {status && <p className="string-status">{status}</p>}
      {rated.ratings ? <div className="ratings" aria-label="API TR 5C3 ratings">
        <div><small>Burst</small><b>{psi(rated.ratings.burstPsi)}</b><span>Barlow, 87.5 % wall</span></div>
        <div><small>Collapse</small><b>{psi(rated.ratings.collapsePsi)}</b><span>{rated.ratings.collapseRegime} regime · D/t {fmt(rated.ratings.dOverT, 2)}</span></div>
        <div><small>Body yield</small><b>{fmt(rated.ratings.bodyYieldLbf / 1000)} klbf</b><span>at {fmt(rated.ratings.yieldPsi / 1000)} ksi minimum yield</span></div>
      </div> : <p className="note">{rated.reason}</p>}
      <dl className="facts">
        <div><dt>OD</dt><dd>{rated.odIn === null ? NR : `${fmt(rated.odIn, 3)} in`}</dd></div>
        <div><dt>Grade</dt><dd>{rated.grade ?? NR}</dd></div>
        <div><dt>Weight</dt><dd>{rated.weightLbFt === null ? NR : `${fmt(rated.weightLbFt, 1)} lb/ft`}</dd></div>
        <div><dt>Connection</dt><dd>{rated.connection ?? NR}</dd></div>
        <div><dt>ID (record)</dt><dd>{component.innerDiameterMm === null ? NR : `${fmt(millimetresToInches(component.innerDiameterMm), 3)} in`}</dd></div>
        <div><dt>Wall · ID · drift (API nominal)</dt><dd>{rated.pipe ? `${fmt(rated.pipe.wallIn, 3)} · ${fmt(rated.pipe.idIn, 3)} · ${fmt(rated.pipe.driftIn, 3)} in` : NR}</dd></div>
      </dl>
    </div>}
    inspector={<Inspector id="strings-record" initial="record" head={<dl className="mf-facts">
      <div className="mf-facts-title"><dt>Shoe</dt><dd>{fmt(shoeMd)} m MD</dd></div>
      <div><dt>In feet</dt><dd>{fmt(metresToFeet(shoeMd))} ft MD</dd></div>
      <div><dt>True vertical depth</dt><dd>{tvd === null ? "TVD not surveyed" : `${fmt(tvd)} m TVD`}</dd></div>
    </dl>} sections={[
      { id: "record", title: "The record", summary: component.sourcePage ? `source p. ${component.sourcePage}` : undefined, body: <p className="mf-prose">{component.material}{component.sourcePage ? ` · source p. ${component.sourcePage}` : ""}. Wall, ID and drift marked API nominal are the API 5CT nominal pipe for the reported OD and weight, not the record.</p> },
      { id: "method", title: "Method", body: <p className="mf-prose">Ratings are textbook API TR 5C3 for new pipe at room temperature, without wear, tension or temperature derating. FORGE&apos;s records give no pore or fracture pressures, so no loads are put against them.</p> },
    ]} />}
    status={<Status items={["Pick another string here or select one in any view", "API TR 5C3 for new pipe; no loads: FORGE gives no pore or fracture pressures"]} />} />;
}
