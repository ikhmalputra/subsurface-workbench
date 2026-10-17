/**
 * Earthquake catalogues in QuakeML 1.2 (Basic Event Description), the FDSN's exchange format that
 * microseismic contractors, FDSN web services and ObsPy write. Each event: its preferred origin
 * (time, latitude, longitude, depth below sea level in metres, with uncertainties), its preferred
 * magnitude and type, the evaluation mode, and comments. Writes what it reads, so a catalogue made
 * here opens in ObsPy and one from the GDR opens here.
 *
 * The reader is a small tag reader for this one schema, not a general XML parser: no DOM, so it runs
 * in the worker and in Node. It ignores namespaces' prefixes and anything it does not read.
 */

export interface QuakeEvent {
  /** The event's publicID (a resource identifier, smi:… or quakeml:…). */
  readonly id: string;
  /** Origin time, ISO 8601 UTC, and its uncertainty in seconds. */
  readonly time: string;
  readonly timeUncertaintyS?: number;
  readonly latitude: number;
  readonly longitude: number;
  /** Depth below sea level, metres (QuakeML's convention), and the uncertainties, metres. */
  readonly depthM: number;
  readonly horizontalUncertaintyM?: number;
  readonly depthUncertaintyM?: number;
  readonly magnitude: number;
  /** Mw, ML, Mwa…; QuakeML leaves the type free. */
  readonly magnitudeType: string;
  readonly evaluationMode?: "manual" | "automatic";
  /** QuakeML's event type, e.g. "induced or triggered event". */
  readonly type?: string;
  readonly comment?: string;
}
export interface QuakeCatalogue {
  readonly publicId: string;
  readonly description?: string;
  readonly creationTime?: string;
  readonly agency?: string;
  readonly events: readonly QuakeEvent[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const num = (v: number, digits: number) => Number.isFinite(v) ? Number(v.toFixed(digits)).toString() : "NaN";

/** A QuakeML 1.2 BED document for a catalogue. */
export function writeQuakeML(catalogue: QuakeCatalogue): string {
  const id = (kind: string, n: string) => `${catalogue.publicId}/${kind}/${n}`;
  const events = catalogue.events.map((e) => {
    const n = e.id.split("/").pop() ?? e.id;
    const origin = id("origin", n), magnitude = id("magnitude", n);
    return [
      `    <event publicID="${esc(e.id)}">`,
      `      <preferredOriginID>${esc(origin)}</preferredOriginID>`,
      `      <preferredMagnitudeID>${esc(magnitude)}</preferredMagnitudeID>`,
      e.type ? `      <type>${esc(e.type)}</type>` : "",
      e.comment ? `      <comment><text>${esc(e.comment)}</text></comment>` : "",
      `      <origin publicID="${esc(origin)}">`,
      `        <time><value>${esc(e.time)}</value>${e.timeUncertaintyS !== undefined ? `<uncertainty>${num(e.timeUncertaintyS, 4)}</uncertainty>` : ""}</time>`,
      `        <latitude><value>${num(e.latitude, 7)}</value></latitude>`,
      `        <longitude><value>${num(e.longitude, 7)}</value></longitude>`,
      `        <depth><value>${num(e.depthM, 1)}</value>${e.depthUncertaintyM !== undefined ? `<uncertainty>${num(e.depthUncertaintyM, 1)}</uncertainty>` : ""}</depth>`,
      e.horizontalUncertaintyM !== undefined ? `        <originUncertainty><horizontalUncertainty>${num(e.horizontalUncertaintyM, 1)}</horizontalUncertainty><preferredDescription>horizontal uncertainty</preferredDescription></originUncertainty>` : "",
      e.evaluationMode ? `        <evaluationMode>${e.evaluationMode}</evaluationMode>` : "",
      `      </origin>`,
      `      <magnitude publicID="${esc(magnitude)}">`,
      `        <mag><value>${num(e.magnitude, 2)}</value></mag>`,
      `        <type>${esc(e.magnitudeType)}</type>`,
      `        <originID>${esc(origin)}</originID>`,
      `      </magnitude>`,
      `    </event>`,
    ].filter(Boolean).join("\n");
  });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<q:quakeml xmlns:q="http://quakeml.org/xmlns/quakeml/1.2" xmlns="http://quakeml.org/xmlns/bed/1.2">`,
    `  <eventParameters publicID="${esc(catalogue.publicId)}">`,
    catalogue.description ? `    <description>${esc(catalogue.description)}</description>` : "",
    catalogue.creationTime || catalogue.agency ? `    <creationInfo>${catalogue.agency ? `<agencyID>${esc(catalogue.agency)}</agencyID>` : ""}${catalogue.creationTime ? `<creationTime>${esc(catalogue.creationTime)}</creationTime>` : ""}</creationInfo>` : "",
    ...events,
    `  </eventParameters>`,
    `</q:quakeml>`,
    "",
  ].filter((line) => line !== "").join("\n") + "\n";
}

/** The elements named `tag` directly or deeply inside `xml`, any namespace prefix, as [attributes, inner text]. */
function elements(xml: string, tag: string): { attrs: string; body: string }[] {
  const out: { attrs: string; body: string }[] = [];
  const open = new RegExp(`<(?:[\\w.-]+:)?${tag}(\\s[^>]*)?(/?)>`, "g");
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml))) {
    if (m[2] === "/") { out.push({ attrs: m[1] ?? "", body: "" }); continue; }
    // Find the matching close, counting nested opens of the same name.
    const close = new RegExp(`<(/?)(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?(/?)>`, "g");
    close.lastIndex = open.lastIndex;
    let depth = 1, c: RegExpExecArray | null, end = -1;
    while ((c = close.exec(xml))) {
      if (c[2] === "/") continue;
      depth += c[1] === "/" ? -1 : 1;
      if (depth === 0) { end = c.index; break; }
    }
    if (end < 0) throw new SyntaxError(`QuakeML: <${tag}> is not closed.`);
    out.push({ attrs: m[1] ?? "", body: xml.slice(open.lastIndex, end) });
    open.lastIndex = close.lastIndex;
  }
  return out;
}
const first = (xml: string, tag: string) => elements(xml, tag)[0]?.body;
const attr = (attrs: string, name: string) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs); return m ? unesc(m[1]!) : undefined; };
const text = (xml: string | undefined) => xml === undefined ? undefined : unesc(xml.replace(/<[^>]*>/g, "").trim());
/** A RealQuantity's value (or uncertainty) inside a named element. */
/** A value that is not a number (a corrupted or hand-edited file) counts as not given: the event is then skipped, never drawn at NaN. */
const quantity = (xml: string, tag: string, part: "value" | "uncertainty" = "value") => { const q = first(xml, tag); const v = q === undefined ? undefined : text(first(q, part)); const n = v === undefined || v === "" ? NaN : Number(v); return Number.isFinite(n) ? n : undefined; };

/** Reads a QuakeML 1.2 document: each event with its preferred origin and magnitude (or the first of each). */
export function readQuakeML(xml: string): QuakeCatalogue {
  const parameters = elements(xml, "eventParameters")[0];
  if (!parameters) throw new SyntaxError("Not a QuakeML document: no <eventParameters>.");
  const events: QuakeEvent[] = [];
  for (const ev of elements(parameters.body, "event")) {
    const preferredOrigin = text(first(ev.body, "preferredOriginID")), preferredMag = text(first(ev.body, "preferredMagnitudeID"));
    const origins = elements(ev.body, "origin"), mags = elements(ev.body, "magnitude");
    const origin = origins.find((o) => attr(o.attrs, "publicID") === preferredOrigin) ?? origins[0];
    const mag = mags.find((o) => attr(o.attrs, "publicID") === preferredMag) ?? mags[0];
    if (!origin || !mag) continue;
    const time = text(first(first(origin.body, "time") ?? "", "value"));
    const latitude = quantity(origin.body, "latitude"), longitude = quantity(origin.body, "longitude"), depthM = quantity(origin.body, "depth"), magnitude = quantity(mag.body, "mag");
    if (!time || latitude === undefined || longitude === undefined || depthM === undefined || magnitude === undefined) continue;
    const uncertainty = first(origin.body, "originUncertainty");
    const mode = text(first(origin.body, "evaluationMode"));
    const comment = text(first(first(ev.body, "comment") ?? "", "text"));
    // An event's own <type> sits directly in the event; the magnitude's <type> is inside <magnitude>.
    const eventType = text(first(ev.body.replace(/<(?:[\w.-]+:)?(origin|magnitude)[\s\S]*?<\/(?:[\w.-]+:)?\1>/g, ""), "type"));
    const horizontal = uncertainty === undefined ? undefined : text(first(uncertainty, "horizontalUncertainty"));
    const tu = quantity(origin.body, "time", "uncertainty"), du = quantity(origin.body, "depth", "uncertainty");
    events.push({
      id: attr(ev.attrs, "publicID") ?? `event-${events.length + 1}`, time, latitude, longitude, depthM, magnitude,
      magnitudeType: text(first(mag.body, "type")) ?? "M",
      ...(tu !== undefined ? { timeUncertaintyS: tu } : {}), ...(du !== undefined ? { depthUncertaintyM: du } : {}),
      ...(horizontal ? { horizontalUncertaintyM: Number(horizontal) } : {}),
      ...(mode === "manual" || mode === "automatic" ? { evaluationMode: mode } : {}),
      ...(eventType ? { type: eventType } : {}), ...(comment ? { comment } : {}),
    });
  }
  const info = first(parameters.body.replace(/<(?:[\w.-]+:)?event[\s>][\s\S]*$/, ""), "creationInfo");
  return {
    publicId: attr(parameters.attrs, "publicID") ?? "", events,
    ...(text(first(parameters.body.replace(/<(?:[\w.-]+:)?event[\s>][\s\S]*$/, ""), "description")) ? { description: text(first(parameters.body.replace(/<(?:[\w.-]+:)?event[\s>][\s\S]*$/, ""), "description"))! } : {}),
    ...(info && text(first(info, "creationTime")) ? { creationTime: text(first(info, "creationTime"))! } : {}),
    ...(info && text(first(info, "agencyID")) ? { agency: text(first(info, "agencyID"))! } : {}),
  };
}
