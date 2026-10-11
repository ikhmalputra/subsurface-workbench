"use client";

import { useEffect, useId, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type MouseEvent } from "react";
import type {
  WellReportAppendixTable,
  WellReportDatum,
  WellReportDrillingSection,
  WellReportEvent,
  WellReportHighlight,
  WellReportIdentity,
  WellReportListSection,
  WellReportLogsSection,
  WellReportSection,
  WellReportSource,
  WellReportStudy,
  WellReportSpec,
  WellReportTableSection,
  WellReportTrajectorySection,
  WellReportValue,
} from "@ikhmalputra/subsurface-core/contracts";
import { getWellComponents, wellComponentsToAssembly } from "@ikhmalputra/subsurface-core";
import type { WellComponent, WellDesign } from "@ikhmalputra/subsurface-core";
import type { AssemblySceneProps } from "./assembly-scene.js";
import { AccessibleTable } from "./accessible-table.js";
import { AssemblySchematic } from "./assembly-schematic.js";
import { CommandButton } from "./ui.js";

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const showValue = (value: WellReportValue) => value === null ? "not reported" : typeof value === "number" ? numberFormat.format(value) : value;

function EvidenceList({ items, sources, label }: {
  readonly items: readonly { readonly sourceId: string; readonly page: number | null }[];
  readonly sources: ReadonlyMap<string, WellReportSource>;
  readonly label: string;
}) {
  const grouped = new Map<string, Set<number>>();
  for (const item of items) {
    const pages = grouped.get(item.sourceId) ?? new Set<number>();
    if (item.page !== null) pages.add(item.page);
    grouped.set(item.sourceId, pages);
  }
  return <ul aria-label={label}>{[...grouped].map(([sourceId, pages]) => {
    const source = sources.get(sourceId)!;
    const orderedPages = [...pages].sort((left, right) => left - right);
    return <li key={sourceId}>
      {source.url ? <a href={source.url}>{source.title}</a> : source.title}
      {orderedPages.length === 1 ? ` · p. ${numberFormat.format(orderedPages[0]!)}` : orderedPages.length > 1 ? ` · pp. ${orderedPages.map((page) => numberFormat.format(page)).join(", ")}` : " · source record"}
    </li>;
  })}</ul>;
}

export interface WellReportViewProps {
  readonly report: WellReportSpec;
  readonly schematicDesign?: WellDesign;
  readonly schematicComponents?: readonly WellComponent[];
  readonly assemblyAssetBaseUrl?: string;
  readonly selectedMdM?: number | null;
  readonly cursorMdM?: number | null;
  readonly onSelectMd?: (mdM: number) => void;
  readonly selectedComponentId?: string | null;
  readonly onSelectComponent?: (componentId: string) => void;
}

function ReportAppendix({ appendix, sources, provenance }: {
  readonly appendix: WellReportAppendixTable;
  readonly sources: ReadonlyMap<string, WellReportSource>;
  readonly provenance: WellReportSpec["provenance"];
}) {
  return <section className="sw-well-report-appendix" data-report-appendix={appendix.id}>
    <details>
      <summary>{appendix.title} ({appendix.rows.length.toLocaleString()} records)</summary>
      <div className="sw-well-report-table-wrap">
        <table>
          <caption>{appendix.title}</caption>
          <thead><tr>{appendix.columns.map((column) => <th key={column.key} scope="col">{column.label}{column.unit ? ` (${column.unit})` : ""}</th>)}</tr></thead>
          <tbody>{appendix.rows.map((row) => <tr key={row.id} data-report-row={row.id} data-md-m={row.mdM ?? undefined}>
            {row.values.map((value, index) => <td key={appendix.columns[index]!.key} data-report-value>{showValue(value)}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </details>
    <SourceLabel sourceId={appendix.sourceId} sources={sources} provenance={provenance} />
  </section>;
}

function SourceLabel({ sourceId, sources, provenance }: { readonly sourceId: string | null; readonly sources: ReadonlyMap<string, WellReportSource>; readonly provenance: WellReportSpec["provenance"] }) {
  const source = sourceId ? sources.get(sourceId) : undefined;
  const text = source ? source.title : provenance === "synthetic" ? "Synthetic example; no external source supplied." : "Source not reported.";
  return <p className="sw-well-report-source">Source: {source?.url ? <a href={source.url}>{text}</a> : text}{source?.license ? ` · ${source.license}` : ""}</p>;
}

function WellReport3DAssembly(props: AssemblySceneProps) {
  const [Scene, setScene] = useState<ComponentType<AssemblySceneProps> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    import("./assembly-scene.js")
      .then((module) => { if (active) setScene(() => module.default); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { active = false; };
  }, []);
  if (error) return <p className="sw-well-report-3d-error" role="alert">3D well schematic unavailable: {error}</p>;
  if (!Scene) return <p role="status">Loading 3D well schematic…</p>;
  return <Scene {...props} />;
}

function identityLabel(identity: WellReportIdentity) {
  const entries: readonly (readonly [string, string | null])[] = [
    ["Well ID", identity.wellId],
    ["Operator", identity.operator],
    ["Field", identity.field],
    ["UWI", identity.uwi],
  ];
  return entries.filter((entry): entry is readonly [string, string] => entry[1] !== null);
}

function ReportSummary({ fields, sources, provenance }: { readonly fields: readonly WellReportDatum[]; readonly sources: ReadonlyMap<string, WellReportSource>; readonly provenance: WellReportSpec["provenance"] }) {
  return <div className="sw-well-report-summary">
    <div className="sw-well-report-table-wrap"><table>
      <caption>Key well facts</caption>
      <thead><tr><th scope="col">Measure</th><th scope="col">Recorded value</th><th scope="col">Source</th></tr></thead>
      <tbody>{fields.map((field) => {
    const source = field.sourceId ? sources.get(field.sourceId) : undefined;
    return <tr key={field.label} data-report-field={field.label}>
      <th scope="row">{field.label}</th>
      <td data-report-value>{showValue(field.value)}{field.unit ? ` ${field.unit}` : ""}</td>
      <td>{source?.url ? <a href={source.url}>{source.title}</a> : source?.title ?? (provenance === "synthetic" ? "Synthetic example" : "Source not reported")}</td>
    </tr>;
  })}</tbody>
    </table></div>
  </div>;
}

function ExecutiveSummary({ report, sources }: { readonly report: WellReportSpec; readonly sources: ReadonlyMap<string, WellReportSource> }) {
  if (!report.executiveSummary) return null;
  return <div className="sw-well-report-executive-summary" data-testid="well-report-executive-summary">
    <p>{report.executiveSummary.text}</p>
    <EvidenceList items={report.executiveSummary.evidence} sources={sources} label="Overview evidence" />
  </div>;
}

function WellReportContents({ report }: { readonly report: WellReportSpec }) {
  return <details className="sw-well-report-contents">
    <summary>Report contents</summary>
    <nav aria-label="Report contents">
      <a href="#well-report-schematic">Well schematic and construction records</a>
      {report.studies && report.studies.length > 0 && <a href="#well-report-studies">Studies, tests, and simulations</a>}
      {report.sections.map((section) => <a key={section.id} href={`#well-report-${section.kind}`}>{section.title}</a>)}
      {report.appendices && report.appendices.length > 0 && <a href="#well-report-registers-title">Source registers and appendices</a>}
    </nav>
  </details>;
}

const studyStatusLabel: Readonly<Record<WellReportStudy["status"], string>> = {
  reported: "Source result reported",
  incomplete: "Attempted · no complete result",
  "not-reported": "No result in supplied records",
  "not-computable": "Cannot compute from supplied inputs",
};

function StudyValues({ title, values }: { readonly title: string; readonly values: WellReportStudy["inputs"] }) {
  if (values.length === 0) return null;
  return <div className="sw-well-report-study-values">
    <h4>{title}</h4>
    <dl>{values.map((value) => <div key={value.label} data-report-study-value={value.label}>
      <dt>{value.label}</dt>
      <dd data-report-value>{showValue(value.value)}{value.unit ? ` ${value.unit}` : ""}</dd>
    </div>)}</dl>
  </div>;
}

function StudyResults({ studies, sources }: {
  readonly studies: readonly WellReportStudy[];
  readonly sources: ReadonlyMap<string, WellReportSource>;
}) {
  return <section className="sw-well-report-studies" id="well-report-studies" aria-labelledby="well-report-studies-title" data-testid="well-report-studies">
    <header>
      <p>Engineering evidence · source-reported and computed results are distinguished</p>
      <h2 id="well-report-studies-title">Studies, tests, and simulations</h2>
      <p>Test values below are transcribed from the cited drilling records. Missing study outputs are identified explicitly; this report does not substitute design assumptions for measured results.</p>
    </header>
    <div className="sw-well-report-study-grid">
      {studies.map((study) => <article className="sw-well-report-study" key={study.id} data-report-study={study.id} data-study-status={study.status} data-study-category={study.category}>
        <header>
          <p>{study.category.replaceAll("-", " ")}</p>
          <h3>{study.title}</h3>
          <span className={`sw-well-report-study-status is-${study.status}`}>{studyStatusLabel[study.status]}</span>
        </header>
        {study.date && <p className="sw-well-report-study-date">{study.date}{study.depthMdM === null ? "" : ` · ${numberFormat.format(study.depthMdM)} m MD`}</p>}
        <p>{study.summary}</p>
        {study.method && <p className="sw-well-report-study-method"><strong>Method / basis:</strong> {study.method}</p>}
        <StudyValues title="Inputs" values={study.inputs} />
        <StudyValues title="Results" values={study.results} />
        {study.table && <div className="sw-well-report-table-wrap">
          <table>
            <caption>{study.table.caption}</caption>
            <thead><tr>{study.table.columns.map((column) => <th key={column.key} scope="col">{column.label}{column.unit ? ` (${column.unit})` : ""}</th>)}</tr></thead>
            <tbody>{study.table.rows.map((row) => <tr key={row.id} data-report-study-row={row.id} data-md-m={row.mdM ?? undefined}>
              {row.values.map((value, index) => <td key={study.table!.columns[index]!.key} data-report-value>{showValue(value)}</td>)}
            </tr>)}</tbody>
          </table>
        </div>}
        {study.limitations.length > 0 && <ul className="sw-well-report-study-limitations" aria-label={`Limitations for ${study.title}`}>
          {study.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
        </ul>}
        <EvidenceList items={study.evidence} sources={sources} label={`Evidence for ${study.title}`} />
      </article>)}
    </div>
  </section>;
}

function ComponentSource({ component }: { readonly component: WellComponent }) {
  return component.sourceUrl
    ? <>{component.sourcePage ? `p. ${numberFormat.format(component.sourcePage)} · ` : ""}<a href={component.sourceUrl}>Source record</a></>
    : "Source not reported";
}

function ComponentRegister({ components, selectedId, onSelect }: {
  readonly components: readonly WellComponent[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}) {
  const groups = [
    { id: "hole", title: "Drilled hole sections", items: components.filter((component) => component.kind === "Hole") },
    { id: "casing", title: "Installed casing strings", items: components.filter((component) => component.kind === "Casing") },
    { id: "cement", title: "Cement placement records", items: components.filter((component) => component.kind === "Cement") },
    { id: "surface-equipment", title: "Wellhead equipment", items: components.filter((component) => !["Hole", "Casing", "Cement"].includes(component.kind)) },
  ].filter((group) => group.items.length > 0);

  return <section className="sw-well-report-component-list" aria-labelledby="well-report-component-list-title" data-testid="well-report-component-list">
    <header>
      <div><p>CONSTRUCTION RECORDS</p><h3 id="well-report-component-list-title">What is installed, drilled, and cemented</h3></div>
      <p>Select a record to locate it in both schematic views.</p>
    </header>
    <p className="sw-well-report-component-note">The schematic is illustrative, not to scale. Casing top ends are anchored at the surface reference for display; actual stick-up/top depths and casing IDs are not reported. Hole size is the drilled bore diameter, not casing OD. Cement intervals describe reported placement, not verified bond or isolation.</p>
    {groups.map((group) => <section className="sw-well-report-component-group" key={group.id} data-component-group={group.id}>
      <h4>{group.title} <span>{group.items.length}</span></h4>
      <div className="sw-well-report-table-wrap">
        <table>
          {group.id === "hole" && <>
            <caption>Reported hole sizes and drilled MD intervals</caption>
            <thead><tr><th scope="col">Section</th><th scope="col">Hole size (in)</th><th scope="col">Drilled interval (ft MD)</th><th scope="col">Source</th><th className="sw-well-report-action" scope="col">Schematic</th></tr></thead>
            <tbody>{group.items.map((component) => <tr key={component.id} data-report-component={component.id} data-selected={component.id === selectedId}>
              <th scope="row">{component.name}</th>
              <td data-report-value>{component.outerDiameterMm === null ? "not reported" : numberFormat.format(component.outerDiameterMm / 25.4)}</td>
              <td data-report-value>{`${numberFormat.format(Math.round(component.topDepthM / 0.3048))}–${numberFormat.format(component.rawBottomDepthFt ?? Math.round(component.bottomDepthM / 0.3048))}`}</td>
              <td><ComponentSource component={component} /></td>
              <td className="sw-well-report-action"><CommandButton icon="view" type="button" aria-pressed={component.id === selectedId} onClick={() => onSelect(component.id)}>View</CommandButton></td>
            </tr>)}</tbody>
          </>}
          {group.id === "casing" && <>
            <caption>Reported casing strings and shoe depths</caption>
            <thead><tr><th scope="col">String</th><th scope="col">Nominal size</th><th scope="col">Shoe depth (ft MD)</th><th scope="col">Grade / weight / connection</th><th scope="col">Source</th><th className="sw-well-report-action" scope="col">Schematic</th></tr></thead>
            <tbody>{group.items.map((component) => <tr key={component.id} data-report-component={component.id} data-selected={component.id === selectedId}>
              <th scope="row">{component.name.split("/")[0]?.trim() ?? component.name}</th>
              <td>{component.name.split("/")[1]?.trim() ?? "not reported"}</td>
              <td data-report-value>{component.rawBottomDepthFt === null || component.rawBottomDepthFt === undefined ? "not reported" : numberFormat.format(component.rawBottomDepthFt)}</td>
              <td>{component.material}</td>
              <td><ComponentSource component={component} /></td>
              <td className="sw-well-report-action"><CommandButton icon="view" type="button" aria-pressed={component.id === selectedId} onClick={() => onSelect(component.id)}>View</CommandButton></td>
            </tr>)}</tbody>
          </>}
          {group.id === "cement" && <>
            <caption>Reported cement placements; geometry is not independently verified</caption>
            <thead><tr><th scope="col">Cement record</th><th scope="col">Material / density</th><th scope="col">Source record detail</th><th scope="col">Source</th><th className="sw-well-report-action" scope="col">Schematic</th></tr></thead>
            <tbody>{group.items.map((component) => <tr key={component.id} data-report-component={component.id} data-selected={component.id === selectedId}>
              <th scope="row">{component.name}</th>
              <td>{component.material}</td>
              <td>{component.description}</td>
              <td><ComponentSource component={component} /></td>
              <td className="sw-well-report-action"><CommandButton icon="view" type="button" aria-pressed={component.id === selectedId} onClick={() => onSelect(component.id)}>View</CommandButton></td>
            </tr>)}</tbody>
          </>}
          {group.id === "surface-equipment" && <>
            <caption>Reported surface equipment; dimensions and pressure ratings are not supplied</caption>
            <thead><tr><th scope="col">Equipment</th><th scope="col">Material</th><th scope="col">Source record detail</th><th scope="col">Source</th><th className="sw-well-report-action" scope="col">Schematic</th></tr></thead>
            <tbody>{group.items.map((component) => <tr key={component.id} data-report-component={component.id} data-selected={component.id === selectedId}>
              <th scope="row">{component.name}</th>
              <td>{component.material}</td>
              <td>{component.description}</td>
              <td><ComponentSource component={component} /></td>
              <td className="sw-well-report-action"><CommandButton icon="view" type="button" aria-pressed={component.id === selectedId} onClick={() => onSelect(component.id)}>View</CommandButton></td>
            </tr>)}</tbody>
          </>}
        </table>
      </div>
    </section>)}
  </section>;
}

function ReportBriefing({ highlights, drillingSections, sources }: {
  readonly highlights: readonly WellReportHighlight[];
  readonly drillingSections: readonly WellReportDrillingSection[];
  readonly sources: ReadonlyMap<string, WellReportSource>;
}) {
  if (highlights.length === 0 && drillingSections.length === 0) return null;
  return <section className="sw-well-report-briefing" aria-labelledby="well-report-briefing-title" data-testid="well-report-briefing">
    <header>
      <p>Operational overview · source-backed facts</p>
      <h2 id="well-report-briefing-title">Key findings</h2>
      <p>Coverage exception, reported core footage and casing events. Calculated values and source statements are distinguished.</p>
    </header>
    {highlights.length > 0 && <div className="sw-well-report-highlights">
      {highlights.map((highlight) => <article key={highlight.id} data-report-highlight={highlight.id} data-tone={highlight.tone}>
        <p className="sw-well-report-highlight-kind">{highlight.tone === "attention" ? "Source-recorded exception" : "Source fact / calculation"}</p>
        <h3>{highlight.title}</h3>
        <strong data-report-value>{highlight.value}</strong>
        <p>{highlight.detail}</p>
        <EvidenceList items={highlight.evidence} sources={sources} label={`Evidence for ${highlight.title}`} />
      </article>)}
    </div>}
    {drillingSections.length > 0 && <div className="sw-well-report-drilling-performance">
      <h3>Drilling performance by hole section</h3>
      <p>Reported interval/run summaries; average ROP is the source’s footage-weighted value over runs with a stated ROP. “Problem runs” reproduces the source summary classification and is not an independent engineering assessment.</p>
      <div className="sw-well-report-table-wrap">
        <table>
          <caption>Drilled interval, run count, problem runs and reported average rate</caption>
          <thead><tr>
            <th scope="col">Hole section</th><th scope="col">Bit (in)</th><th scope="col">Interval (ft MD)</th>
            <th scope="col">Drilled (ft)</th><th scope="col">Runs</th><th scope="col">Problem runs</th>
            <th scope="col">Average ROP (ft/h)</th><th scope="col">Reported casing string</th><th scope="col">Source</th>
          </tr></thead>
          <tbody>{drillingSections.map((section) => {
            const source = sources.get(section.sourceId)!;
            return <tr key={section.id} data-drilling-section={section.id}>
              <th scope="row">{section.name}</th>
              <td data-report-value>{numberFormat.format(section.bitSizeIn)}</td>
              <td data-report-value>{numberFormat.format(section.topFt)}–{numberFormat.format(section.baseFt)}</td>
              <td data-report-value>{numberFormat.format(section.drilledFt)}</td>
              <td data-report-value>{numberFormat.format(section.runCount)}</td>
              <td data-report-value>{numberFormat.format(section.problemRuns)}</td>
              <td data-report-value>{section.avgRopFtPerHour === null ? "not reported" : numberFormat.format(section.avgRopFtPerHour)}</td>
              <td>{section.casing}</td>
              <td>{source.url ? <a href={source.url}>{source.title}</a> : source.title}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </div>}
  </section>;
}

function ReportTable({ section, sources, provenance, onSelectMd }: {
  readonly section: WellReportTableSection;
  readonly sources: ReadonlyMap<string, WellReportSource>;
  readonly provenance: WellReportSpec["provenance"];
  readonly onSelectMd?: (mdM: number) => void;
}) {
  const emptyMessage = section.kind === "offsets"
    ? "No offset-well records are present in the supplied sources; offset comparison is unavailable."
    : section.kind === "completion"
      ? "Wellhead hardware is listed in the construction register. No production tubing or production-flow result is documented in the supplied sources."
      : section.kind === "formation-tops"
        ? "No formation-top picks were supplied. The interval overview uses the separately cited conceptual formation model."
        : "No records supplied for this section.";
  return <>
    <div className="sw-well-report-table-wrap">
      <table>
        <caption>{section.title}</caption>
        <thead><tr>
          {section.columns.map((column) => <th key={column.key} scope="col">{column.label}{column.unit ? ` (${column.unit})` : ""}</th>)}
          <th className="sw-well-report-action" scope="col">Depth link</th>
        </tr></thead>
        <tbody>{section.rows.map((row) => {
          const mdM = row.mdM;
          return <tr key={row.id} data-report-row={row.id} data-md-m={mdM ?? undefined}>
            {row.values.map((value, index) => <td key={section.columns[index]!.key} data-report-value>{showValue(value)}</td>)}
            <td className="sw-well-report-action">{mdM === null ? "not reported" : onSelectMd ? <CommandButton kind="selection" type="button" onClick={() => onSelectMd(mdM)} aria-label={`Pin ${numberFormat.format(mdM)} m MD from ${section.title}`}>{numberFormat.format(mdM)} m MD</CommandButton> : `${numberFormat.format(mdM)} m MD`}</td>
          </tr>;
        })}</tbody>
      </table>
      {section.rows.length === 0 && <p className="sw-well-report-empty">{emptyMessage}</p>}
    </div>
    <SourceLabel sourceId={section.sourceId} sources={sources} provenance={provenance} />
  </>;
}

function toSvgPoint(event: MouseEvent<SVGSVGElement>, svg: SVGSVGElement) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

function TrajectorySpatialPlot({ section, design, selectedMdM, cursorMdM, onSelectMd }: {
  readonly section: WellReportTrajectorySection;
  readonly design?: WellDesign;
  readonly selectedMdM: number | null;
  readonly cursorMdM: number | null;
  readonly onSelectMd?: (mdM: number) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [keyboardIndex, setKeyboardIndex] = useState(0);
  const depthKeyId = `well-report-depth-key-${useId().replaceAll(":", "")}`;
  const width = 720, height = 360, left = 62, right = 690, top = 22, bottom = 294;
  const projected = section.points.map((point) => point.eastingM === null || point.northingM === null
    ? null
    : {
      point,
      x: (point.eastingM - point.northingM) * Math.SQRT1_2,
      y: point.tvdM * Math.sqrt(2 / 3) + (point.eastingM + point.northingM) * Math.sqrt(1 / 6),
    });
  const coordinates = projected.filter((item): item is NonNullable<typeof item> => item !== null);
  const minX = Math.min(0, ...coordinates.map((item) => item.x));
  const maxX = Math.max(1, ...coordinates.map((item) => item.x));
  const minY = Math.min(0, ...coordinates.map((item) => item.y));
  const maxY = Math.max(1, ...coordinates.map((item) => item.y));
  const scale = Math.min((right - left) / (maxX - minX), (bottom - top) / (maxY - minY));
  const offsetX = left + ((right - left) - (maxX - minX) * scale) / 2;
  const offsetY = top + ((bottom - top) - (maxY - minY) * scale) / 2;
  const screenPoint = (item: NonNullable<typeof projected[number]>) => ({
    x: offsetX + (item.x - minX) * scale,
    y: offsetY + (item.y - minY) * scale,
  });
  const plotted = projected.map((item) => item && ({ ...item, ...screenPoint(item) }));
  const construction = design
    ? getWellComponents(design)
      .filter((component) => ["Hole", "Cement", "Casing", "Tubular"].includes(component.kind) && !component.parentId && component.bottomDepthM > component.topDepthM)
      .map((component) => ({
        component,
      }))
      .sort((a, b) => {
        const order: Readonly<Record<string, number>> = { Hole: 0, Cement: 1, Casing: 2, Tubular: 3 };
        return order[a.component.kind]! - order[b.component.kind]!;
      })
    : [];
  const depths = section.points.map((point) => point.mdM);
  const mdMin = Math.min(...depths);
  const mdMax = Math.max(mdMin + 1, ...depths);
  const depthColor = (mdM: number) => `hsl(${165 - ((mdM - mdMin) / (mdMax - mdMin)) * 145} 62% 38%)`;
  const nearestStation = (x: number, y: number) => plotted.reduce<{ index: number; distance: number } | null>((best, item, index) => {
    if (!item) return best;
    const distance = Math.hypot(item.x - x, item.y - y);
    return !best || distance < best.distance ? { index, distance } : best;
  }, null);
  const marker = (mdM: number | null) => mdM === null || !section.points.length ? null
    : section.points.reduce((nearest, current) => Math.abs(current.mdM - mdM) < Math.abs(nearest.mdM - mdM) ? current : nearest, section.points[0]!);
  const selected = marker(selectedMdM);
  const cursor = marker(cursorMdM);
  const positionFor = (point: typeof section.points[number] | null) => point ? plotted[section.points.indexOf(point)] ?? null : null;
  const keyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!section.points.length) return;
    if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "Home", "End"].includes(event.key)) event.preventDefault();
    if (event.key === "Home") setKeyboardIndex(0);
    else if (event.key === "End") setKeyboardIndex(section.points.length - 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowRight") setKeyboardIndex((index) => Math.min(section.points.length - 1, index + 1));
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") setKeyboardIndex((index) => Math.max(0, index - 1));
    else if (event.key === "Enter") onSelectMd?.(section.points[keyboardIndex]?.mdM ?? section.points[0]!.mdM);
  };
  const click = (event: MouseEvent<SVGSVGElement>) => {
    if (!svg.current || !coordinates.length) return;
    const location = toSvgPoint(event, svg.current);
    if (!location) return;
    const nearest = nearestStation(location.x, location.y);
    if (nearest) onSelectMd?.(section.points[nearest.index]!.mdM);
  };
  const active = plotted[keyboardIndex] ?? null;
  const selectedPlot = positionFor(selected);
  const cursorPlot = positionFor(cursor);
  return <figure className="sw-well-report-figure sw-well-report-spatial-figure" data-testid="well-report-trajectory-2-5d">
    <figcaption>Spatial survey projection · oblique view of supplied local Easting, Northing, and TVD in metres; construction schematic above matches Well View</figcaption>
    {!coordinates.length ? <p className="sw-well-report-empty">Spatial trajectory coordinates not reported.</p> : <>
      <svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="group" tabIndex={0}
        aria-label={`Spatial survey projection of ${coordinates.length} supplied trajectory stations in ${section.frame}. Horizontal axes are local Easting and Northing; depth is true vertical depth in metres, positive down. Colour changes from shallow to deep. Arrow keys browse supplied stations and Enter links the selected MD.`}
        onKeyDown={keyDown} onClick={click}>
        <defs><linearGradient id={depthKeyId}><stop offset="0%" stopColor={depthColor(mdMin)} /><stop offset="100%" stopColor={depthColor(mdMax)} /></linearGradient></defs>
        <rect className="sw-well-report-plot" x={left} y={top} width={right - left} height={bottom - top} />
        {plotted.map((item, index) => {
          const previous = index > 0 ? plotted[index - 1] : null;
          return item && previous ? <line key={section.points[index]!.mdM} className="sw-well-report-spatial-segment"
            x1={previous.x} y1={previous.y} x2={item.x} y2={item.y}
            stroke={depthColor((section.points[index - 1]!.mdM + section.points[index]!.mdM) / 2)} /> : null;
        })}
        {construction.flatMap(({ component }, componentIndex) => plotted.slice(1).flatMap((item, index) => {
          const previous = plotted[index];
          if (!item || !previous || item.point.mdM < component.topDepthM || item.point.mdM > component.bottomDepthM || previous.point.mdM < component.topDepthM || previous.point.mdM > component.bottomDepthM) return [];
          const widthByKind = component.kind === "Hole" ? 9 : component.kind === "Cement" ? 7 : component.kind === "Casing" ? 5 : 3;
          const colorByKind = component.kind === "Hole" ? "#8d9892" : component.kind === "Cement" ? "#c2ac73" : component.kind === "Casing" ? "#167d70" : "#4a6fb0";
          const laneOffset = (componentIndex - (construction.length - 1) / 2) * 5;
          return [<line key={`${component.id}-${item.point.mdM}`} data-construction-component={component.id}
            x1={previous.x + laneOffset} y1={previous.y} x2={item.x + laneOffset} y2={item.y}
            stroke={colorByKind} strokeWidth={widthByKind} strokeOpacity={component.kind === "Hole" ? 0.45 : component.kind === "Cement" ? 0.58 : 0.96}
            strokeDasharray={component.kind === "Hole" ? "4 3" : undefined} strokeLinecap="round" />];
        }))}
        {plotted[0] && <circle className="sw-well-report-spatial-endpoint" cx={plotted[0].x} cy={plotted[0].y} r="4" />}
        {plotted.at(-1) && <circle className="sw-well-report-spatial-toe" cx={plotted.at(-1)!.x} cy={plotted.at(-1)!.y} r="4" />}
        {selectedPlot && <circle className="sw-well-report-selected" cx={selectedPlot.x} cy={selectedPlot.y} r="7" />}
        {cursorPlot && <circle className="sw-well-report-cursor" cx={cursorPlot.x} cy={cursorPlot.y} r="5" />}
        {active && keyboardIndex > 0 && <circle className="sw-well-report-keyboard" cx={active.x} cy={active.y} r="6" />}
        <text x={left} y="318">Wellhead</text>
        <text x={right} y="318" textAnchor="end">Deepest supplied station</text>
        <line className="sw-well-report-spatial-axis-east" x1="76" y1="265" x2="112" y2="265" />
        <line className="sw-well-report-spatial-axis-north" x1="76" y1="265" x2="58" y2="247" />
        <line className="sw-well-report-spatial-axis-depth" x1="76" y1="265" x2="76" y2="287" />
        <text x="116" y="268">E</text><text x="48" y="246">N</text><text x="80" y="293">TVD +</text>
        <rect x="475" y="337" width="150" height="7" rx="3" fill={`url(#${depthKeyId})`} />
        <text x="470" y="346" textAnchor="end">shallow</text><text x="631" y="346">deep</text>
      </svg>
      <p>{coordinates.length} supplied spatial stations · local frame: {section.frame} · projection is for visualization, not a map or vertical-section survey</p>
      {construction.length > 0 && <ul className="sw-well-report-spatial-legend" aria-label="Reported well construction intervals projected onto the supplied trajectory">
        {construction.map(({ component }) => <li key={component.id} data-construction-record={component.id}>
          <span aria-hidden="true" data-kind={component.kind.toLowerCase()} />
          <strong>{component.name}</strong>
          <span>{numberFormat.format(component.topDepthM)}–{numberFormat.format(component.bottomDepthM)} m MD</span>
          <span>{component.outerDiameterMm === null ? "OD not reported" : `OD ${numberFormat.format(component.outerDiameterMm)} mm`}</span>
          {component.sourcePage && <span>Report p. {component.sourcePage}</span>}
        </li>)}
      </ul>}
      {construction.length > 0 && <p className="sw-well-report-spatial-disclosure">Construction sleeves follow only supplied survey stations inside each reported MD interval. Line widths and lateral placement are conceptual, not to scale; gaps in source coordinates are not bridged.</p>}
    </>}
  </figure>;
}

function TrajectoryFigure({ section, sources, provenance, selectedMdM, cursorMdM, onSelectMd, spatialDesign }: {
  readonly section: WellReportTrajectorySection;
  readonly sources: ReadonlyMap<string, WellReportSource>;
  readonly provenance: WellReportSpec["provenance"];
  readonly selectedMdM: number | null;
  readonly cursorMdM: number | null;
  readonly onSelectMd?: (mdM: number) => void;
  readonly spatialDesign?: WellDesign;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [keyboardIndex, setKeyboardIndex] = useState(0);
  const width = 660, height = 340, left = 58, right = 638, top = 20, bottom = 294;
  const mdValues = section.points.map((point) => point.mdM);
  const tvdValues = section.points.map((point) => point.tvdM);
  const mdMin = Math.min(0, ...mdValues), mdMax = Math.max(mdMin + 1, ...mdValues);
  const tvdMin = Math.min(0, ...tvdValues), tvdMax = Math.max(tvdMin + 1, ...tvdValues);
  const horizontalPoints = section.points.filter((point): point is typeof point & { eastingM: number; northingM: number } => point.eastingM !== null && point.northingM !== null);
  const eastingValues = horizontalPoints.map((point) => point.eastingM);
  const northingValues = horizontalPoints.map((point) => point.northingM);
  const eastingMin = eastingValues.length ? Math.min(...eastingValues) : 0, eastingMax = Math.max(eastingMin + 1, ...eastingValues);
  const northingMin = northingValues.length ? Math.min(...northingValues) : 0, northingMax = Math.max(northingMin + 1, ...northingValues);
  const planX = (eastingM: number) => left + (eastingM - eastingMin) / (eastingMax - eastingMin) * (right - left);
  const planY = (northingM: number) => bottom - (northingM - northingMin) / (northingMax - northingMin) * (bottom - top);
  const x = (mdM: number) => left + (mdM - mdMin) / (mdMax - mdMin) * (right - left);
  const y = (tvdM: number) => bottom - (tvdM - tvdMin) / (tvdMax - tvdMin) * (bottom - top);
  const path = section.points.map((point, index) => `${index ? "L" : "M"}${x(point.mdM)},${y(point.tvdM)}`).join(" ");
  let planPath = "";
  let planSegmentOpen = false;
  for (const point of section.points) {
    if (point.eastingM === null || point.northingM === null) {
      planSegmentOpen = false;
      continue;
    }
    planPath += `${planSegmentOpen ? "L" : "M"}${planX(point.eastingM)},${planY(point.northingM)} `;
    planSegmentOpen = true;
  }
  const marker = (depth: number | null) => {
    if (depth === null || !section.points.length) return null;
    const point = section.points.reduce((nearest, current) => Math.abs(current.mdM - depth) < Math.abs(nearest.mdM - depth) ? current : nearest, section.points[0]!);
    return point;
  };
  const selected = marker(selectedMdM);
  const cursor = marker(cursorMdM);
  const keyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!section.points.length) return;
    if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "Home", "End"].includes(event.key)) event.preventDefault();
    if (event.key === "Home") setKeyboardIndex(0);
    else if (event.key === "End") setKeyboardIndex(section.points.length - 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowRight") setKeyboardIndex((index) => Math.min(section.points.length - 1, index + 1));
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") setKeyboardIndex((index) => Math.max(0, index - 1));
    else if (event.key === "Enter") onSelectMd?.(section.points[keyboardIndex]?.mdM ?? section.points[0]!.mdM);
  };
  const click = (event: MouseEvent<SVGSVGElement>) => {
    if (!svg.current || !section.points.length) return;
    const point = toSvgPoint(event, svg.current);
    if (!point) return;
    const mdM = mdMin + (point.x - left) / (right - left) * (mdMax - mdMin);
    const nearest = section.points.reduce((best, current) => Math.abs(current.mdM - mdM) < Math.abs(best.mdM - mdM) ? current : best, section.points[0]!);
    onSelectMd?.(nearest.mdM);
  };
  const active = section.points[keyboardIndex];
  return <figure className="sw-well-report-figure" data-testid="well-report-trajectory">
    <figcaption>{section.title} · MD/TVD profile and local Easting/Northing plan, in metres</figcaption>
    <TrajectorySpatialPlot section={section} design={spatialDesign} selectedMdM={selectedMdM} cursorMdM={cursorMdM} onSelectMd={onSelectMd} />
    <svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="group" tabIndex={0}
      aria-label={`${section.title}. Measured depth and true vertical depth in metres; arrow keys browse supplied stations and Enter links the selected MD.`}
      onKeyDown={keyDown} onClick={click}>
      <rect className="sw-well-report-plot" x={left} y={top} width={right - left} height={bottom - top} />
      <line className="sw-well-report-axis" x1={left} x2={right} y1={bottom} y2={bottom} />
      <line className="sw-well-report-axis" x1={left} x2={left} y1={top} y2={bottom} />
      <path className="sw-well-report-trajectory" d={path} />
      {selected && <circle className="sw-well-report-selected" cx={x(selected.mdM)} cy={y(selected.tvdM)} r="6" />}
      {cursor && <circle className="sw-well-report-cursor" cx={x(cursor.mdM)} cy={y(cursor.tvdM)} r="4" />}
      {active && keyboardIndex > 0 && <circle className="sw-well-report-keyboard" cx={x(active.mdM)} cy={y(active.tvdM)} r="5" />}
      <text x={(left + right) / 2} y="326" textAnchor="middle">MD (m)</text>
      <text x="14" y={(top + bottom) / 2} transform={`rotate(-90 14 ${(top + bottom) / 2})`} textAnchor="middle">TVD (m)</text>
      {section.points.length > 0 && <title>{`${section.points.length} supplied stations in ${section.frame}`}</title>}
    </svg>
    <svg className="sw-well-report-plan" viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`${section.title} plan view. Easting and northing in metres in ${section.frame}. Gaps are not connected.`}>
      {horizontalPoints.length > 0 ? <>
        <rect className="sw-well-report-plot" x={left} y={top} width={right - left} height={bottom - top} />
        <line className="sw-well-report-axis" x1={left} x2={right} y1={bottom} y2={bottom} />
        <line className="sw-well-report-axis" x1={left} x2={left} y1={top} y2={bottom} />
        <path className="sw-well-report-trajectory" d={planPath} />
        {selected && selected.eastingM !== null && selected.northingM !== null && <circle className="sw-well-report-selected" cx={planX(selected.eastingM)} cy={planY(selected.northingM)} r="6" />}
        {cursor && cursor.eastingM !== null && cursor.northingM !== null && <circle className="sw-well-report-cursor" cx={planX(cursor.eastingM)} cy={planY(cursor.northingM)} r="4" />}
        {active && active.eastingM !== null && active.northingM !== null && keyboardIndex > 0 && <circle className="sw-well-report-keyboard" cx={planX(active.eastingM)} cy={planY(active.northingM)} r="5" />}
        <text x={(left + right) / 2} y="326" textAnchor="middle">Easting (m)</text>
        <text x="14" y={(top + bottom) / 2} transform={`rotate(-90 14 ${(top + bottom) / 2})`} textAnchor="middle">Northing (m)</text>
      </> : <text x={width / 2} y={height / 2} textAnchor="middle">Plan coordinates not reported</text>}
    </svg>
    <p>{section.points.length ? `${section.points.length} supplied stations · ${section.frame}` : "Trajectory not reported."}</p>
    <AccessibleTable
      label="well report trajectory stations"
      description="Supplied measured-depth, true-vertical-depth, Easting, and Northing values in metres in the declared frame; no trajectory values are interpolated."
      columns={[
        { label: "MD", unit: "m" }, { label: "TVD", unit: "m" }, { label: "Easting", unit: "m" }, { label: "Northing", unit: "m" },
        { label: "Inclination", unit: "deg" }, { label: "Azimuth", unit: "deg" }, { label: "Source row" },
        { label: "Raw MD", unit: "ft" }, { label: "Raw TVD", unit: "ft" },
      ]}
      rowCount={section.points.length}
      getRows={(start, end) => section.points.slice(start, end).map((point) => [
        point.mdM, point.tvdM, point.eastingM, point.northingM, point.inclinationDeg ?? null,
        point.azimuthDeg ?? null, point.sourceRow ?? null, point.rawMdFt ?? null, point.rawTvdFt ?? null,
      ])}
    />
    <SourceLabel sourceId={section.sourceId} sources={sources} provenance={provenance} />
  </figure>;
}

function LogFigure({ section, sources, provenance, selectedMdM, cursorMdM, onSelectMd }: {
  readonly section: WellReportLogsSection;
  readonly sources: ReadonlyMap<string, WellReportSource>;
  readonly provenance: WellReportSpec["provenance"];
  readonly selectedMdM: number | null;
  readonly cursorMdM: number | null;
  readonly onSelectMd?: (mdM: number) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const depths = [...new Set(section.curves.flatMap((curve) => curve.depthsMdM))].sort((a, b) => a - b);
  const [keyboardIndex, setKeyboardIndex] = useState(0);
  const width = Math.max(420, section.curves.length * 96 + 70), height = 520, left = 55, right = width - 14, top = 20, bottom = height - 34;
  const mdMin = depths[0] ?? 0, mdMax = depths.at(-1) ?? mdMin + 1;
  const y = (mdM: number) => top + (mdM - mdMin) / Math.max(1, mdMax - mdMin) * (bottom - top);
  const curvePath = (curveIndex: number) => {
    const curve = section.curves[curveIndex]!;
    const valid = curve.values.filter((value): value is number => value !== null);
    const min = valid.length ? Math.min(...valid) : 0, max = valid.length ? Math.max(...valid) : 1;
    const domain = max === min ? [min - 0.5, max + 0.5] : [min, max];
    const x0 = left + curveIndex * (right - left) / Math.max(1, section.curves.length);
    const x1 = left + (curveIndex + 1) * (right - left) / Math.max(1, section.curves.length);
    let path = "", open = false;
    curve.values.forEach((value, index) => {
      if (value === null) { open = false; return; }
      const px = x0 + (value - domain[0]!) / (domain[1]! - domain[0]!) * (x1 - x0);
      path += `${open ? "L" : "M"}${px},${y(curve.depthsMdM[index]!)} `;
      open = true;
    });
    return { path, x0, x1 };
  };
  const keyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!depths.length) return;
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) event.preventDefault();
    if (event.key === "Home") setKeyboardIndex(0);
    else if (event.key === "End") setKeyboardIndex(depths.length - 1);
    else if (event.key === "ArrowDown") setKeyboardIndex((index) => Math.min(depths.length - 1, index + 1));
    else if (event.key === "ArrowUp") setKeyboardIndex((index) => Math.max(0, index - 1));
    else if (event.key === "Enter") onSelectMd?.(depths[keyboardIndex] ?? depths[0]!);
  };
  const click = (event: MouseEvent<SVGSVGElement>) => {
    if (!svg.current || !depths.length) return;
    const point = toSvgPoint(event, svg.current);
    if (!point) return;
    const mdM = mdMin + (point.y - top) / (bottom - top) * Math.max(1, mdMax - mdMin);
    onSelectMd?.(depths.reduce((best, current) => Math.abs(current - mdM) < Math.abs(best - mdM) ? current : best, depths[0]!));
  };
  const mark = (mdM: number | null, className: string) => mdM === null ? null : <line className={className} x1={left} x2={right} y1={y(mdM)} y2={y(mdM)} />;
  const activeMd = depths[keyboardIndex];
  return <figure className="sw-well-report-figure" data-testid="well-report-logs">
    <figcaption>{section.title} · measured depth in metres; null samples break the curve</figcaption>
    {!section.curves.length
      ? <p className="sw-well-report-empty">No log curves supplied; not reported.</p>
      : <>
        <svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="group" tabIndex={0}
          aria-label={`${section.title}. ${section.curves.map((curve) => `${curve.mnemonic} in ${curve.unit ?? "unit not reported"}`).join(", ")}. MD in metres. Arrow keys browse depths; Enter links the selected exact sample MD.`}
          onKeyDown={keyDown} onClick={click}>
          <rect className="sw-well-report-plot" x={left} y={top} width={right - left} height={bottom - top} />
          {section.curves.map((curve, index) => {
            const geometry = curvePath(index);
            return <g key={curve.id}>
              <line className="sw-well-report-axis" x1={geometry.x0} x2={geometry.x0} y1={top} y2={bottom} />
              <path className="sw-well-report-log-curve" stroke={curve.color} d={geometry.path} />
              <text x={(geometry.x0 + geometry.x1) / 2} y="14" textAnchor="middle">{curve.mnemonic}</text>
              <text x={(geometry.x0 + geometry.x1) / 2} y={height - 8} textAnchor="middle">{curve.unit ?? "unit not reported"}</text>
            </g>;
          })}
          {mark(selectedMdM, "sw-well-report-selected-depth")}
          {mark(cursorMdM, "sw-well-report-cursor-depth")}
          {activeMd !== undefined && <line className="sw-well-report-keyboard-depth" x1={left} x2={right} y1={y(activeMd)} y2={y(activeMd)} />}
          <text x="15" y={(top + bottom) / 2} transform={`rotate(-90 15 ${(top + bottom) / 2})`} textAnchor="middle">MD (m)</text>
        </svg>
        <p>{section.curves.length} supplied curves · {depths.length} exact depth keys · {depths.length ? `${numberFormat.format(mdMin)}–${numberFormat.format(mdMax)} m MD` : "depth not reported"}</p>
        <AccessibleTable
          label="well report log samples"
          description="Source samples in measured-depth metres. Unknown values are shown as not reported; no values are interpolated."
          columns={[{ label: "Curve" }, { label: "MD", unit: "m" }, { label: "Value" }]}
          rowCount={section.curves.reduce((count, curve) => count + curve.values.length, 0)}
          getRows={(from, to) => {
            const rows: (string | number | null)[][] = [];
            let offset = 0;
            for (const curve of section.curves) {
              const curveStart = Math.max(0, from - offset);
              const curveEnd = Math.min(curve.values.length, to - offset);
              for (let index = curveStart; index < curveEnd; index += 1) {
                rows.push([curve.mnemonic, curve.depthsMdM[index]!, curve.values[index]!]);
              }
              offset += curve.values.length;
              if (offset >= to) break;
            }
            return rows;
          }}
        />
      </>}
    <SourceLabel sourceId={section.sourceId} sources={sources} provenance={provenance} />
  </figure>;
}

function Operations({ events, sources, provenance, onSelectMd }: {
  readonly events: readonly WellReportEvent[];
  readonly sources: ReadonlyMap<string, WellReportSource>;
  readonly provenance: WellReportSpec["provenance"];
  readonly onSelectMd?: (mdM: number) => void;
}) {
  return <>
    {events.length ? <ol className="sw-well-report-timeline">{events.map((event) => <li key={event.id}>
      <time dateTime={event.date}>{event.date}</time>
      <span>{event.label}</span>
      {event.mdM === null ? <span>MD not reported</span> : onSelectMd ? <CommandButton kind="selection" type="button" className="sw-well-report-action" onClick={() => { if (event.mdM !== null) onSelectMd(event.mdM); }}>{numberFormat.format(event.mdM)} m MD</CommandButton> : <span>{numberFormat.format(event.mdM)} m MD</span>}
      <small>{event.sourceId ? sources.get(event.sourceId)?.title ?? "Source not reported" : provenance === "synthetic" ? "Synthetic example" : "Source not reported"}{event.sourcePage ? ` · p. ${numberFormat.format(event.sourcePage)}` : ""}</small>
    </li>)}</ol> : <p className="sw-well-report-empty">No operations records supplied; not reported.</p>}
  </>;
}

function ListSection({ section, sources }: { readonly section: WellReportListSection; readonly sources: readonly WellReportSource[] }) {
  return <>
    {section.items.length
      ? <ul className="sw-well-report-list">{section.items.map((item, index) => <li key={`${section.id}-${index}`}>{item}</li>)}</ul>
      : <p className="sw-well-report-empty">No items supplied; not reported.</p>}
    {section.kind === "provenance" && <ul className="sw-well-report-sources" aria-label="Report sources">
      {sources.map((source) => <li key={source.id}>
        {source.url ? <a href={source.url}>{source.title}</a> : source.title}
        {source.license && <> · {source.license}</>}
        {source.sha256 && <code> · SHA-256 {source.sha256}</code>}
      </li>)}
    </ul>}
  </>;
}

function renderSection(section: WellReportSection, props: {
  readonly sources: ReadonlyMap<string, WellReportSource>;
  readonly provenance: WellReportSpec["provenance"];
  readonly selectedMdM: number | null;
  readonly cursorMdM: number | null;
  readonly onSelectMd?: (mdM: number) => void;
  readonly spatialDesign?: WellDesign;
  readonly report: WellReportSpec;
}) {
  if (section.kind === "summary") return <>
    <ExecutiveSummary report={props.report} sources={props.sources} />
    <ReportSummary fields={section.fields} sources={props.sources} provenance={props.provenance} />
    <ReportBriefing highlights={props.report.highlights ?? []} drillingSections={props.report.drillingSections ?? []} sources={props.sources} />
  </>;
  if (section.kind === "trajectory") return <TrajectoryFigure
    section={section}
    sources={props.sources}
    provenance={props.provenance}
    selectedMdM={props.selectedMdM}
    cursorMdM={props.cursorMdM}
    onSelectMd={props.onSelectMd}
    spatialDesign={props.spatialDesign}
  />;
  if (section.kind === "logs") return <LogFigure section={section} sources={props.sources} provenance={props.provenance} selectedMdM={props.selectedMdM} cursorMdM={props.cursorMdM} onSelectMd={props.onSelectMd} />;
  if (section.kind === "operations") return <Operations events={section.events} sources={props.sources} provenance={props.provenance} onSelectMd={props.onSelectMd} />;
  if (section.kind === "provenance" || section.kind === "assumptions" || section.kind === "not-checked") return <ListSection section={section} sources={[...props.sources.values()]} />;
  return <ReportTable section={section} sources={props.sources} provenance={props.provenance} onSelectMd={props.onSelectMd} />;
}

/** Accessible interactive report; print CSS renders the same figures as static SVG. */
export function WellReportView({ report, schematicDesign, schematicComponents = [], assemblyAssetBaseUrl = "/well-components", selectedMdM = null, cursorMdM = null, onSelectMd, selectedComponentId: controlledComponentId, onSelectComponent }: WellReportViewProps) {
  const sources = new Map(report.sources.map((source) => [source.id, source]));
  const [localComponentId, setSelectedComponentId] = useState(schematicComponents[0]?.id ?? "");
  const selectedComponentId = controlledComponentId === undefined ? localComponentId : controlledComponentId ?? "";
  const selectedComponent = schematicComponents.find((component) => component.id === selectedComponentId);
  const assembly = useMemo(() => schematicDesign ? wellComponentsToAssembly({
    id: schematicDesign.id,
    name: schematicDesign.wellName ?? schematicDesign.id,
    totalDepthM: schematicDesign.totalDepthM,
    components: schematicComponents,
  }) : null, [schematicComponents, schematicDesign]);
  const selectSchematicComponent = (id: string) => {
    setSelectedComponentId(id);
    onSelectComponent?.(id);
    const component = schematicComponents.find((item) => item.id === id);
    if (component && component.topDepthReported !== false) onSelectMd?.(component.topDepthM);
  };
  return <article className="sw-well-report" data-testid="well-report" data-well-id={report.identity.wellId} data-provenance={report.provenance}>
    <div className="sw-well-report-toolbar">
      <CommandButton icon="print" type="button" onClick={() => window.print()}>Print / save as PDF</CommandButton>
    </div>
    {report.provenance === "synthetic" && <p className="sw-well-report-synthetic" role="note">SYNTHETIC EXAMPLE · not engineering data</p>}
    <header className="sw-well-report-header">
      <p>As-drilled well report · {report.provenance}</p>
      <h1>{report.title}</h1>
      <h2>{report.identity.name}</h2>
      <dl>{identityLabel(report.identity).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{showValue(value)}</dd></div>)}
        <div><dt>Depth datum</dt><dd>{report.datum.name}</dd></div>
        <div><dt>Reference elevation</dt><dd>{showValue(report.datum.referenceElevationMslM)}{report.datum.referenceElevationMslM === null ? "" : " m MSL"}</dd></div>
      </dl>
    </header>
    {schematicDesign && <section className="sw-well-report-schematic" id="well-report-schematic" aria-labelledby="well-report-schematic-title" data-testid="well-report-schematic">
      <header>
        <div><p>WELLBORE CONSTRUCTION / SOURCE-ALIGNED</p><h2 id="well-report-schematic-title">Well schematic</h2></div>
        <p>2.5D and 3D views use the supplied construction records. Schematic geometry is illustrative and not to scale; see the categorized source register below.</p>
      </header>
      {assembly && <div className="sw-well-report-assembly-pair" data-testid="well-report-assembly-pair">
        <AssemblySchematic
          assembly={assembly}
          assetBaseUrl={assemblyAssetBaseUrl}
          selectedId={selectedComponentId}
          onSelect={(id) => { if (id) selectSchematicComponent(id); }}
          cursorDepthM={cursorMdM}
          title="Construction schematic"
        />
        <div className="sw-well-report-3d" aria-label="Construction cutaway" data-testid="well-report-assembly-3d">
          <WellReport3DAssembly
            assembly={assembly}
            assetBaseUrl={assemblyAssetBaseUrl}
            selectedId={selectedComponentId}
            onSelect={(id) => { if (id) selectSchematicComponent(id); }}
            title="Construction cutaway"
          />
        </div>
      </div>}
      {selectedComponent && <p className="sw-well-report-schematic-source">
        Selected record: {selectedComponent.name} · {selectedComponent.description}
        {selectedComponent.sourcePage ? ` · Source page ${selectedComponent.sourcePage}` : ""}
        {selectedComponent.sourceUrl ? <> · <a href={selectedComponent.sourceUrl}>Open source record</a></> : ""}
      </p>}
      {schematicComponents.length > 0 && <ComponentRegister components={schematicComponents} selectedId={selectedComponentId} onSelect={selectSchematicComponent} />}
    </section>}
    {report.studies && report.studies.length > 0 && <StudyResults studies={report.studies} sources={sources} />}
    <WellReportContents report={report} />
    {report.sections.map((section) => <section className="sw-well-report-section" id={`well-report-${section.kind}`} key={section.id} data-report-section={section.kind}>
      <h2>{section.title}</h2>
      {renderSection(section, {
        sources,
        provenance: report.provenance,
        selectedMdM,
        cursorMdM,
        onSelectMd,
        spatialDesign: schematicDesign,
        report,
      })}
    </section>)}
    {report.appendices && report.appendices.length > 0 && <section className="sw-well-report-registers" aria-labelledby="well-report-registers-title">
      <header><h2 id="well-report-registers-title">Detailed source registers</h2><p>Appendices retain the supplied station, drilling-run, daily-report, and other source records. Values are not interpolated or completed.</p></header>
      {report.appendices.map((appendix) => <ReportAppendix key={appendix.id} appendix={appendix} sources={sources} provenance={report.provenance} />)}
    </section>}
    <footer className="sw-well-report-footer">Report view only · data ownership and persistence remain with the host application.</footer>
  </article>;
}
