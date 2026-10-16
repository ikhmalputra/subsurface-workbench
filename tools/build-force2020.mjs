// Builds the FORCE 2020 well set the deck reads: 118 Norwegian North Sea wells with their logs,
// the Norwegian Offshore Directorate's group and formation tops and casing shoes, and the
// competition's interpreted lithology. Source: Bormann et al., "FORCE 2020 Well well log and
// lithofacies dataset for machine learning competition", Zenodo 4351156 (CC BY 4.0; the logs are
// the Directorate's, NLOD 2.0).
//
//   node tools/build-force2020.mjs <folder>
//
// <folder> holds train.csv (unzipped from train.zip), leaderboard_test_features.csv,
// leaderboard_test_target.csv and hidden_test.csv from the competition's repository
// (github.com/bolgebrygg/Force-2020-Machine-Learning-competition, lithology_competition/data),
// and NPD_Lithostratigraphy_groups_all_wells.xlsx, NPD_Lithostratigraphy_member_formations_all_wells.xlsx
// and NPD_Casing_depth_most_wells.xlsx from the Zenodo record (saved as groups.xlsx,
// formations.xlsx and casing.xlsx).
//
// Writes packages/fixtures/data/force2020/wells.json (every well's header, tops, shoes and path)
// and one <well>.i16 per well: the logs on a 0.5 m MD grid, each curve 16-bit quantised between its
// own minimum and maximum (resistivity in log10), -32768 where the curve was not logged.
import { createReadStream, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const proj4 = createRequire(join(root, "packages/core/package.json"))("proj4");
const folder = process.argv[2];
if (!folder) { console.error("Usage: node tools/build-force2020.mjs <folder with the FORCE 2020 files>"); process.exit(1); }

/** ED50 / UTM zone 31N (EPSG:23031) with its EPSG three-parameter shift to WGS84. */
const ED50_UTM31 = "+proj=utm +zone=31 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs";
const toLonLat = (x, y) => proj4(ED50_UTM31, "WGS84", [x, y]);

const STEP = 0.5;
/** The curves kept, with their units; resistivities quantised in log10. */
const CURVES = [
  { m: "GR", unit: "API" }, { m: "CALI", unit: "in" }, { m: "BS", unit: "in" },
  { m: "RDEP", unit: "ohm.m", log: true }, { m: "RMED", unit: "ohm.m", log: true },
  { m: "RHOB", unit: "g/cm3" }, { m: "NPHI", unit: "v/v" }, { m: "PEF", unit: "b/e" },
  { m: "DTC", unit: "us/ft" }, { m: "DTS", unit: "us/ft" }, { m: "SP", unit: "mV" },
];
/** The competition's lithology codes, in the order the files store them. */
const LITHOLOGY = [30000, 65030, 65000, 80000, 74000, 70000, 70032, 88000, 86000, 99000, 90000, 93000];

// ── The three CSVs ──────────────────────────────────────────────────────────────────────────
const wells = new Map();
async function readCsv(name, split, targets) {
  const lines = createInterface({ input: createReadStream(join(folder, name)), crlfDelay: Infinity });
  let header = null, row = 0;
  for await (const line of lines) {
    const cells = line.split(";");
    if (!header) { header = Object.fromEntries(cells.map((cell, index) => [cell, index])); continue; }
    const id = cells[header.WELL];
    let well = wells.get(id);
    if (!well) { well = { name: id, split, md: [], x: [], y: [], z: [], group: [], formation: [], litho: [], curves: Object.fromEntries(CURVES.map((curve) => [curve.m, []])) }; wells.set(id, well); }
    const num = (key) => { const index = header[key]; if (index === undefined) return null; const text = cells[index]; if (!text) return null; const value = Number(text); return Number.isFinite(value) ? value : null; };
    well.md.push(num("DEPTH_MD")); well.x.push(num("X_LOC")); well.y.push(num("Y_LOC")); well.z.push(num("Z_LOC"));
    well.group.push(cells[header.GROUP] || null); well.formation.push(cells[header.FORMATION] || null);
    for (const curve of CURVES) well.curves[curve.m].push(num(curve.m));
    well.litho.push(targets ? targets[row] ?? null : num("FORCE_2020_LITHOFACIES_LITHOLOGY"));
    row++;
  }
}
const leaderboardTargets = readFileSync(join(folder, "leaderboard_test_target.csv"), "utf8").trim().split("\n").slice(1).map((line) => { const value = Number(line.split(";")[2]); return Number.isFinite(value) ? value : null; });
await readCsv("train.csv", "train");
await readCsv("leaderboard_test_features.csv", "leaderboard", leaderboardTargets);
await readCsv("hidden_test.csv", "hidden");

// ── The Directorate's spreadsheets ──────────────────────────────────────────────────────────
/** The first sheet of an .xlsx, as rows of strings: enough of the format for these three files. */
function readXlsx(path) {
  const zip = readFileSync(path);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const entries = new Map();
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    const method = zip.readUInt16LE(at + 10), size = zip.readUInt32LE(at + 20), nameLength = zip.readUInt16LE(at + 28), extra = zip.readUInt16LE(at + 30), comment = zip.readUInt16LE(at + 32), offset = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const data = zip.subarray(start, start + size);
    entries.set(name, method === 8 ? inflateRawSync(data).toString("utf8") : data.toString("utf8"));
    at += 46 + nameLength + extra + comment;
  }
  const decode = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const strings = [...(entries.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>(.*?)<\/si>/gs)].map((match) => decode([...match[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((part) => part[1]).join("")));
  const columnOf = (ref) => [...ref.replace(/\d+/g, "")].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
  return [...entries.get("xl/worksheets/sheet1.xml").matchAll(/<row[^>]*>(.*?)<\/row>/gs)].map((match) => {
    const row = [];
    for (const cell of match[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
      const value = /<v>(.*?)<\/v>/s.exec(cell[3] ?? "")?.[1] ?? /<t[^>]*>(.*?)<\/t>/s.exec(cell[3] ?? "")?.[1] ?? "";
      row[columnOf(cell[1])] = /t="s"/.test(cell[2]) && value !== "" ? strings[Number(value)] : decode(value);
    }
    return row;
  });
}
/** "VIKING GP. Top" → "Viking Gp."; "Roedby Fm. Top" → "Roedby Fm.". */
const topName = (surface) => surface.replace(/\s+Top$/i, "").trim().toLowerCase().replace(/(^|[\s(/-])([a-zæøå])/g, (_, lead, char) => lead + char.toUpperCase()).replace(/\bGp\.?$/, "Gp.").replace(/\bFm\.?$/, "Fm.");
function readTops(file) {
  const rows = readXlsx(join(folder, file));
  const head = rows[0];
  const col = (name) => head.indexOf(name);
  const byWell = new Map();
  for (const row of rows.slice(1)) {
    const well = row[col("Well identifier")], surface = row[col("Surface")], md = Number(row[col("MD")]), z = Number(row[col("Z")]);
    if (!well || !surface || !Number.isFinite(md)) continue;
    const list = byWell.get(well) ?? [];
    list.push({ name: topName(surface), md: round(md, 1), tvdss: Number.isFinite(z) ? round(-z, 1) : null });
    byWell.set(well, list);
  }
  for (const list of byWell.values()) list.sort((a, b) => a.md - b.md);
  return byWell;
}
const round = (value, digits) => { const k = 10 ** digits; return Math.round(value * k) / k; };
const groupTops = readTops("groups.xlsx");
const formationTops = readTops("formations.xlsx");
// The casing sheet's first column is a row id; then well, label, X, Y, Z, MD.
const shoes = new Map();
for (const row of readXlsx(join(folder, "casing.xlsx")).slice(1)) {
  const [, well, label, , , z, md] = row;
  const od = Number(/^([\d.]+)\s*IN/i.exec(label ?? "")?.[1]);
  if (!well || !Number.isFinite(Number(md))) continue;
  const list = shoes.get(well) ?? [];
  list.push({ label: label.trim(), odIn: Number.isFinite(od) ? od : null, md: round(Number(md), 1), tvdss: Number.isFinite(Number(z)) ? round(-Number(z), 1) : null });
  shoes.set(well, list.sort((a, b) => a.md - b.md));
}

// ── Each well: logs on a 0.5 m grid, path, header ───────────────────────────────────────────
const quadrant = (name) => Number(name.split("/")[0]);
const AREAS = [
  { id: "force-q7", quadrants: [7], label: "North Sea · quadrant 7" },
  { id: "force-q15", quadrants: [15, 16, 17], label: "North Sea · quadrants 15–17" },
  { id: "force-q25", quadrants: [25, 26], label: "North Sea · quadrants 25–26" },
  { id: "force-q29", quadrants: [29, 30, 31, 32], label: "North Sea · quadrants 29–32" },
  { id: "force-q33", quadrants: [33, 34], label: "North Sea · quadrants 33–34" },
  { id: "force-q35", quadrants: [35, 36], label: "North Sea · quadrants 35–36" },
];
const slug = (name) => name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
const out = join(root, "packages/fixtures/data/force2020");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const manifest = [];
let bytes = 0;
for (const well of [...wells.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))) {
  const order = well.md.map((md, index) => [md, index]).filter(([md]) => md !== null).sort((a, b) => a[0] - b[0]).map(([, index]) => index);
  const md0 = Math.floor(well.md[order[0]] / STEP) * STEP, md1 = Math.ceil(well.md[order.at(-1)] / STEP) * STEP;
  const n = Math.round((md1 - md0) / STEP) + 1;
  const bin = (index) => Math.min(n - 1, Math.max(0, Math.round((well.md[index] - md0) / STEP)));
  // Continuous curves: the mean of the samples in each half-metre; lithology: the most common code.
  const curves = [];
  for (const spec of CURVES) {
    const sum = new Float64Array(n), count = new Uint16Array(n);
    for (const index of order) { const value = well.curves[spec.m][index]; if (value === null || (spec.log && value <= 0)) continue; const k = bin(index); sum[k] += spec.log ? Math.log10(value) : value; count[k]++; }
    if (!count.some((c) => c > 0)) continue;
    const values = Array.from(sum, (total, k) => count[k] ? total / count[k] : null);
    const present = values.filter((value) => value !== null);
    const min = Math.min(...present), max = Math.max(...present);
    curves.push({ spec, values, min, max });
  }
  const lithoCounts = Array.from({ length: n }, () => new Map());
  for (const index of order) { const code = LITHOLOGY.indexOf(well.litho[index]); if (code >= 0) { const counts = lithoCounts[bin(index)]; counts.set(code, (counts.get(code) ?? 0) + 1); } }
  const litho = lithoCounts.map((counts) => counts.size ? [...counts].sort((a, b) => b[1] - a[1])[0][0] : -1);
  const hasLitho = litho.some((code) => code >= 0);

  const data = new Int16Array(n * (curves.length + (hasLitho ? 1 : 0)));
  curves.forEach((curve, c) => {
    const span = curve.max - curve.min || 1;
    curve.values.forEach((value, k) => { data[c * n + k] = value === null ? -32768 : Math.round((value - curve.min) / span * 65534) - 32767; });
  });
  if (hasLitho) litho.forEach((code, k) => { data[curves.length * n + k] = code; });
  const file = `${slug(well.name)}.i16`;
  writeFileSync(join(out, file), Buffer.from(data.buffer));
  bytes += data.byteLength;

  // The path: positions every 25 m MD, east and north from the first sample, TVD below sea level.
  const located = order.filter((index) => well.x[index] !== null && well.y[index] !== null && well.z[index] !== null);
  const first = located[0];
  const survey = [];
  let next = -Infinity;
  for (const index of located) {
    if (well.md[index] < next && index !== located.at(-1)) continue;
    survey.push([round(well.md[index], 1), round(well.x[index] - well.x[first], 1), round(well.y[index] - well.y[first], 1), round(-well.z[index], 1)]);
    next = well.md[index] + 50;
  }
  // The rig floor above sea level, where the hole is vertical down to the first sample: MD there is TVD below the floor.
  const firstMd = well.md[first], firstTvdss = -well.z[first];
  const reach = survey.find((station) => station[0] >= firstMd + 100) ?? survey.at(-1);
  const straight = reach && Math.hypot(reach[1], reach[2]) < 0.05 * (reach[0] - firstMd + 1);
  // Else the Directorate's shallowest top, picked in MD and TVDSS: near the seabed every hole here is vertical.
  const shallow = (groupTops.get(well.name) ?? []).find((top) => top.tvdss !== null && top.md < 600);
  const fromLogs = located.length && straight && firstMd - firstTvdss > 0 && firstMd - firstTvdss < 80 ? round(firstMd - firstTvdss, 1) : null;
  const fromTops = shallow && shallow.md - shallow.tvdss > 0 && shallow.md - shallow.tvdss < 80 ? round(shallow.md - shallow.tvdss, 1) : null;
  const elevation = fromTops ?? fromLogs;
  const [lon, lat] = located.length ? toLonLat(well.x[first], well.y[first]) : [null, null];
  const area = AREAS.find((entry) => entry.quadrants.includes(quadrant(well.name)));
  manifest.push({
    id: slug(well.name), name: well.name, area: area.id, split: well.split, file,
    lonLat: lon === null ? null : [round(lon, 5), round(lat, 5)], utm: located.length ? [round(well.x[first], 1), round(well.y[first], 1)] : null,
    datumElevationM: elevation, datumFrom: elevation === null ? null : fromTops !== null ? "tops" : "logs", mdTop: md0, mdBase: md1, step: STEP, n,
    curves: curves.map((curve) => ({ m: curve.spec.m, unit: curve.spec.unit, min: round(curve.min, 5), max: round(curve.max, 5), ...(curve.spec.log ? { log: true } : {}) })),
    lithology: hasLitho,
    groups: groupTops.get(well.name) ?? [], formations: formationTops.get(well.name) ?? [], shoes: shoes.get(well.name) ?? [], survey,
  });
}
writeFileSync(join(out, "wells.json"), JSON.stringify({
  source: "FORCE 2020 well log and lithofacies dataset, Zenodo 4351156 (CC BY 4.0); logs, tops and casing from the Norwegian Offshore Directorate (NLOD 2.0)",
  crs: "ED50 / UTM 31N (EPSG:23031); lonLat converted to WGS84 with the EPSG three-parameter shift",
  lithology: LITHOLOGY, areas: AREAS, wells: manifest,
}));
console.log(`FORCE 2020 → ${out}: ${manifest.length} wells, logs ${(bytes / 1e6).toFixed(1)} MB, manifest ${(readFileSync(join(out, "wells.json")).length / 1024).toFixed(0)} KB`);
for (const area of AREAS) console.log(`  ${area.label}: ${manifest.filter((well) => well.area === area.id).length} wells`);
console.log(`  without tops: ${manifest.filter((well) => !well.groups.length).map((well) => well.name).join(", ") || "none"}; without a datum elevation: ${manifest.filter((well) => well.datumElevationM === null).length}`);
