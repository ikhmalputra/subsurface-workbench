import { useMemo, useState } from "react";
import { RotateCw } from "lucide-react";
import type { CataloguedWell } from "@ikhmalputra/subsurface-core/data-contract";
import { refreshCatalogue } from "../data/catalogue.ts";
import { catalogueFields, useCatalogue, useCatalogueVersion } from "../data/catalogue-state.ts";
import { actions, useDeck } from "../deck/store.ts";
import { fmt } from "../format.ts";
import { Frame, Inspector, Status } from "./frame/Frame.tsx";
import { useSize } from "./useSize.ts";

/**
 * Where the deck's wells come from:
 * - the sources the host's config.json names, and how far each has been read;
 * - every well listed, field by field;
 * - what was left out, and why.
 * This is how a tenant sees their data arriving, or not.
 *
 * The list may hold hundreds of thousands of wells, so only the rows in view are drawn.
 */

const PROVENANCE: Readonly<Record<string, string>> = { documented: "documented", synthetic: "synthetic", "user-authored": "yours", tenant: "your backend" };
const ROW = 26;

type Row = { readonly kind: "field"; readonly key: string; readonly name: string; readonly source: string; readonly count: number } | { readonly kind: "well"; readonly key: string; readonly entry: CataloguedWell };

export function DataSources() {
  const { config, configNote, configProblems, sources, problems, fields, loading, wellCount } = useCatalogue();
  const version = useCatalogueVersion();
  const siteId = useDeck((deck) => deck.siteId);
  // Records a source served and the checks refused; sources the config named but this build cannot read are listed apart.
  const served = problems.filter((problem) => problem.sourceId !== "config");
  const unavailable = problems.filter((problem) => problem.sourceId === "config");
  const errors = served.filter((problem) => problem.severity === "error");
  // Rebuilt when the catalogue announces a change (`version`), not on every render.
  const rows = useMemo((): readonly Row[] => {
    const labels = new Map(sources.map((source) => [source.id, source.label]));
    return catalogueFields().flatMap((field): Row[] => [
      { kind: "field", key: field.key, name: field.name, source: labels.get(field.sourceId) ?? field.sourceId, count: field.wells.length },
      ...field.wells.map((entry): Row => ({ kind: "well", key: field.key, entry })),
    ]);
  }, [version, sources]);

  return <Frame name="sources" className="ds" title="Data sources" subtitle={configNote}
    tools={<button type="button" className="ds-refresh" onClick={() => void refreshCatalogue()} disabled={loading}><RotateCw size={13} aria-hidden="true" />{loading ? "Reading…" : "Read again"}</button>}
    numbers={<>
      <span><small>Sources</small><b>{config.sources.length}</b></span>
      <span><small>Wells</small><b>{fmt(wellCount)}</b></span>
      <span><small>Left out</small><b>{fmt(errors.length)}</b></span>
    </>}
    canvas={<WellList rows={rows} siteId={siteId} fields={fields} />}
    inspector={<Inspector id="sources" initial="config" sections={[
      { id: "config", title: "Sources", summary: `${config.sources.length}`, body: <dl className="mf-facts">
        {sources.map((source) => <div key={source.id}><dt>{source.label}<br /><small>{source.standard}</small></dt><dd>{source.error ? "could not be read" : `${fmt(source.wells)}${source.total !== undefined && source.total !== source.wells ? ` of ${fmt(source.total)}` : ""} wells${source.reading ? " · reading" : ""}${source.truncated ? " · cut short" : ""}`}</dd></div>)}
      </dl> },
      (unavailable.length > 0 || configProblems.length > 0) && { id: "config-problems", title: "Not read", summary: `${unavailable.length + configProblems.length}`, body: <ul className="ds-problems">
        {[...configProblems, ...unavailable.map((problem) => problem.message)].map((message, i) => <li key={i}>{message}</li>)}
      </ul> },
      { id: "problems", title: "Left out or flagged", summary: `${fmt(errors.length)} left out · ${fmt(served.length - errors.length)} flagged`, body: served.length
        ? <ul className="ds-problems">{served.slice(0, 300).map((problem, i) => <li key={i} className={problem.severity === "error" ? "is-error" : undefined}><b>{problem.object} {problem.id}</b> {problem.message}</li>)}{served.length > 300 && <li>…and {fmt(served.length - 300)} more.</li>}</ul>
        : <p className="mf-prose">Every record passed its checks.</p> },
      { id: "connect", title: "Connect your backend", body: <div className="mf-prose ds-connect">
        <p>The deck reads <code>config.json</code> beside it when it starts. Name your sources there; nothing in it is a secret, and sign-in goes through your identity provider.</p>
        <pre>{`{
  "sources": [
    { "type": "contract-json", "label": "Field A",
      "url": "data/wells.index.json" },
    { "type": "osdu", "url": "https://osdu.example.com",
      "dataPartition": "opendes" }
  ]
}`}</pre>
        <p>A <b>contract-json</b> source is wells in the data contract: one file (<code>subsurface-wells</code>, up to 64 MB), or for a large tenant an index of headers with a file per field (<code>subsurface-wells-index</code>). Only the index is read at start; a field&apos;s file when the field is opened.</p>
        <p>Each object maps to WITSML, OSDU and PPDM (docs/TENANT_DATA_MAP.md). OSDU, WITSML over ETP and PPDM adapters are next; until then the deck says so here instead of guessing.</p>
      </div> },
    ]} />}
    status={<Status items={[
      loading ? `Reading sources: ${fmt(wellCount)} wells listed so far` : "Click a well to open its field; its paths and tops are read then",
      "Every record is checked before it is drawn; nothing is placed at a guessed location",
    ]} />} />;
}

/** The wells, field by field, drawing only the rows in view: a list of any length scrolls like a short one. */
function WellList({ rows, siteId, fields }: { readonly rows: readonly Row[]; readonly siteId: string | null; readonly fields: ReturnType<typeof useCatalogue>["fields"] }) {
  const [box, size] = useSize<HTMLDivElement>();
  const [top, setTop] = useState(0);
  const first = Math.max(0, Math.floor(top / ROW) - 8), last = Math.min(rows.length, Math.ceil((top + Math.max(size.height, 600)) / ROW) + 8);
  return <div className="ds-list" ref={box} onScroll={(event) => setTop(event.currentTarget.scrollTop)} role="table" aria-label="Wells by field" aria-rowcount={rows.length}>
    <div className="ds-row ds-head" role="row"><span>Well</span><span>Location</span><span>Datum</span><span>Path</span><span>Tops</span><span>Source</span></div>
    <div style={{ height: rows.length * ROW, position: "relative" }}>
      {rows.slice(first, last).map((row, i) => {
        const y = (first + i) * ROW;
        if (row.kind === "field") {
          const status = fields.get(row.key);
          return <div key={`f-${row.key}`} className={`ds-row ds-field${row.key === siteId ? " is-here" : ""}`} role="row" style={{ top: y }}>
            <button type="button" className="ds-open" onClick={() => actions.selectSite(row.key, null)}>{row.name}</button>
            <span>{fmt(row.count)} well{row.count === 1 ? "" : "s"} · {row.source}{status?.reading ? ` · reading ${fmt(status.read)} of ${fmt(status.total)}` : status?.error ? ` · ${status.error}` : ""}</span>
          </div>;
        }
        const { entry } = row, bore = entry.wellbores[0], path = bore?.path ?? [];
        return <div key={entry.well.id} className={`ds-row${row.key === siteId ? " is-here" : ""}`} role="row" style={{ top: y }}>
          <button type="button" className="ds-open" title={`Open ${entry.well.name}'s field`} onClick={() => actions.selectSite(row.key, bore?.wellbore.id ?? entry.well.id)}>{entry.well.name}</button>
          <span>{entry.well.location ? `${entry.well.location.latitude.toFixed(4)}°, ${entry.well.location.longitude.toFixed(4)}°` : <em>not given</em>}</span>
          <span>{bore ? `${bore.wellbore.datum.reference}${bore.wellbore.datum.elevationM !== null ? ` ${fmt(bore.wellbore.datum.elevationM, 1)} m` : ""}` : <em>—</em>}</span>
          <span>{path.length >= 2 ? `${fmt(path.at(-1)!.mdM)} m MD · ${bore!.trajectory!.kind}${bore!.trajectory!.azimuthReference === "unknown" ? " · north not stated" : ` · ${bore!.trajectory!.azimuthReference} north`}` : <em>{bore ? "no path" : "read when its field opens"}</em>}</span>
          <span>{bore?.markers.length ?? "—"}</span>
          <span>{PROVENANCE[entry.well.provenance.kind] ?? entry.well.provenance.kind}</span>
        </div>;
      })}
    </div>
  </div>;
}
