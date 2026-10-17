import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// A synthetic tenant for stress tests: N wells in the data contract's JSON, as a backend might serve
// them. Everything is generated and labelled synthetic. A seeded generator makes every run identical.
//
//   node tools/stress/tenant.mjs <wells> [stations per well] [wells per field] > tenant.wells.json
//
// Each well: a location on a North Sea-like grid, an RKB datum, a definitive survey (MD, inclination,
// azimuth, TVD, north, east) from surface to a 2–5 km TD, and about 20 formation tops.

export function tenant({ wells = 1000, stations = 300, perField = 200, seed = 7 } = {}) {
  let s = seed >>> 0;
  const random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const provenance = { kind: "synthetic", source: "Stress-test tenant, generated (not real data)" };
  const tops = Array.from({ length: 20 }, (_, i) => `Unit ${String.fromCharCode(65 + i)}`);
  const out = [];
  for (let w = 0; w < wells; w++) {
    const field = Math.floor(w / perField);
    const lon = 1.5 + (field % 20) * 0.4 + random() * 0.35, lat = 56 + Math.floor(field / 20) * 0.3 + random() * 0.25;
    const td = 2000 + random() * 3000, kickoff = 300 + random() * 1200, maxInc = random() * 70, azi = random() * 360, build = 2 + random() * 2;
    const step = td / (stations - 1);
    const st = [];
    let tvd = 0, n = 0, e = 0, prevInc = 0;
    for (let i = 0; i < stations; i++) {
      const md = i * step;
      const inc = md < kickoff ? 0 : Math.min(maxInc, (md - kickoff) / 30 * build);
      if (i > 0) { const a = ((prevInc + inc) / 2) * Math.PI / 180; tvd += step * Math.cos(a); const h = step * Math.sin(a); n += h * Math.cos(azi * Math.PI / 180); e += h * Math.sin(azi * Math.PI / 180); }
      prevInc = inc;
      st.push({ mdM: +md.toFixed(2), inclinationDeg: +inc.toFixed(3), azimuthDeg: +azi.toFixed(3), tvdM: +tvd.toFixed(2), northM: +n.toFixed(2), eastM: +e.toFixed(2) });
    }
    const id = `t${w}`;
    out.push({
      well: { id, name: `T-${field}-${w % perField}`, field: { id: `f${field}`, name: `Field ${field}` }, location: { longitude: +lon.toFixed(6), latitude: +lat.toFixed(6) }, environment: "offshore", waterDepthM: 80 + Math.round(random() * 100), groundElevationM: null, provenance },
      wellbores: [{
        wellbore: { id, wellId: id, name: `T-${field}-${w % perField}`, status: "drilled", datum: { reference: "RKB", elevationM: 25 + Math.round(random() * 10) }, totalDepthMdM: +td.toFixed(1), provenance },
        trajectories: [{ id: `${id}-def`, wellboreId: id, name: "Definitive", kind: "definitive", azimuthReference: "grid", stations: st, provenance }],
        markerSets: [{ id: `${id}-tops`, wellboreId: id, name: "Tops", provenance, markers: tops.map((name, k) => ({ id: `${id}-${k}`, name, mdM: +(td * (0.2 + k * 0.035)).toFixed(1), kind: "formation" })) }],
      }],
    });
  }
  return { format: "subsurface-wells", version: 1, wells: out };
}

/**
 * A tenant written the way a large one is served: index pages of headers, 100 fields each, every
 * page linking the next, and one detail file per field. Written field by field, so it never holds
 * the whole tenant in memory.
 *   node tools/stress/tenant.mjs --index <dir> <wells> [stations] [wells per field] [fields with detail files]
 */
export function writeTenant(dir, { wells = 50_000, stations = 300, perField = 200, fieldsPerPage = 100, detailFields = Infinity } = {}) {
  mkdirSync(join(dir, "fields"), { recursive: true });
  const fields = Math.ceil(wells / perField), pages = Math.ceil(fields / fieldsPerPage);
  let bytes = 0;
  for (let page = 0; page < pages; page++) {
    const entries = [];
    for (let f = page * fieldsPerPage; f < Math.min(fields, (page + 1) * fieldsPerPage); f++) {
      const count = Math.min(perField, wells - f * perField);
      const field = tenant({ wells: count, stations, perField, seed: 7 + f }).wells.map((bundle, i) => {
        const id = `t${f * perField + i}`;
        const rename = (value) => JSON.parse(JSON.stringify(value).replaceAll(`"t${i}"`, `"${id}"`).replaceAll(`"t${i}-`, `"${id}-`).replaceAll('"f0"', `"f${f}"`).replaceAll('"Field 0"', `"Field ${f}"`).replaceAll(`"T-0-${i}"`, `"T-${f}-${i}"`));
        // Each field in its own place: 40 fields across, 0.4° apart, rows 0.3° apart.
        const moved = rename(bundle);
        moved.well.location = { longitude: +(moved.well.location.longitude + (f % 40) * 0.4).toFixed(6), latitude: +(moved.well.location.latitude + Math.floor(f / 40) * 0.3).toFixed(6) };
        return moved;
      });
      // Detail files for the first `detailFields` fields only: a stress run opens a few, and the rest
      // would only fill the disk. A field without one fails to open, and the deck must say so.
      if (f < detailFields) { const detail = JSON.stringify({ format: "subsurface-wells", version: 1, wells: field }); writeFileSync(join(dir, "fields", `f${f}.json`), detail); bytes += detail.length; }
      entries.push({ id: `f${f}`, name: `Field ${f}`, wells: field.map((bundle) => bundle.well), detail: `stress/fields/f${f}.json` });
    }
    const index = JSON.stringify({ format: "subsurface-wells-index", version: 1, fields: entries, ...(page + 1 < pages ? { next: `stress/index-${page + 1}.json` } : {}) });
    writeFileSync(join(dir, page ? `index-${page}.json` : "index.json"), index); bytes += index.length;
  }
  return { fields, pages, bytes };
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === "--index") {
  const [, , , dir, wells = "50000", stations = "300", perField = "200", detailFields = "Infinity"] = process.argv;
  console.log(JSON.stringify(writeTenant(dir, { wells: Number(wells), stations: Number(stations), perField: Number(perField), detailFields: Number(detailFields) })));
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const [wells = "1000", stations = "300", perField = "200"] = process.argv.slice(2);
  process.stdout.write(JSON.stringify(tenant({ wells: Number(wells), stations: Number(stations), perField: Number(perField) })));
}
