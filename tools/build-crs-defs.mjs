// The coordinate reference systems the SDK can reproject between, as proj4 definitions, generated
// from a pinned EPSG dataset (the epsg-index package) into packages/core/src/crs-defs.json.
//
//   node tools/build-crs-defs.mjs           # rewrite the table and print what changed
//   node tools/build-crs-defs.mjs --check   # fail if the table is out of date
//
// What goes in: every projected and geographic CRS built on the datums oil-and-gas records use (the
// list below), with the datum shift to WGS 84 the dataset gives as a Helmert (`+towgs84`). Grid-file
// shifts (`+nadgrids`), which a browser cannot read, are dropped; for the datums that then have no
// shift, a published Helmert is put in its place, with its accuracy stated, so the table never
// claims a precision it does not have. A CRS left with no shift at all says so, and the deck warns.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const all = JSON.parse(readFileSync(`${root}node_modules/epsg-index/all.json`, "utf8"));
const epsgIndexVersion = JSON.parse(readFileSync(`${root}node_modules/epsg-index/package.json`, "utf8")).version;

/** The datums, by the name EPSG gives them before " / ". Regional and national ones that carry oil-and-gas records. */
const DATUMS = [
  // Global and continental
  // Realisations of one datum that differ by under a metre (NAD83(HARN/CSRS/2011), ETRS89 by epoch,
  // Pulkovo 1942(58/83), SIRGAS 1995, ITRF) are left to the base datum: a few hundred near-duplicates.
  "WGS 84", "WGS 72", "ED50", "ED87", "ETRS89", "NAD27", "NAD83", "SAD69", "SIRGAS 2000", "PSAD56", "Pulkovo 1942",
  // Europe
  "OSGB36", "TM65", "IRENET95", "DHDN", "Amersfoort", "NTF", "RGF93 v1", "RGF93 v2", "RGF93 v2b", "Monte Mario", "Datum 73", "Lisbon", "CH1903", "CH1903+", "MGI", "S-JTSK", "NGO 1948",
  // Middle East and North Africa
  "Nahrwan 1967", "Nahrwan 1934", "Ain el Abd", "Qatar 1974", "QND95", "Fahud", "PDO Survey Datum 1993", "Trucial Coast 1948", "Deir ez Zor", "KOC", "Kuwait Utility", "NGN", "Karbala 1979", "IGRS", "FD58", "Nakhl-e Ghanem", "Israel 1993", "Jordan", "ELD79", "LGD2006", "Nord Sahara 1959", "Carthage", "Egypt 1907", "Egypt Gulf of Suez S-650 TL", "Yemen NGN96",
  // Sub-Saharan Africa
  "Minna", "Camacupa 1948", "Malongo 1987", "Accra", "Leigon", "Pointe Noire", "IGC 1962 6th Parallel South", "M'poraloko", "Schwarzeck", "Hartebeesthoek94", "Cape", "Arc 1950", "Arc 1960", "Tete", "Moznet", "Adindan", "Massawa", "Mauritania 1999", "Nouakchott 1965", "Tananarive", "RGM04", "Abidjan 1987", "Conakry 1905", "Dabola 1981", "Locodjo 1965", "Mhast (onshore)", "Mhast (offshore)",
  // Asia and Oceania
  "Indian 1975", "Indian 1954", "Indian 1960", "Kalianpur 1975", "Kalianpur 1962", "Kertau 1968", "Kertau (RSO)", "GDM2000", "Timbalai 1948", "GDBD2009", "DGN95", "Batavia", "Gunung Segara", "Makassar", "Samboja", "Luzon 1911", "PRS92", "Hanoi 1972", "VN-2000", "Hong Kong 1980", "Beijing 1954", "Xian 1980", "CGCS2000", "Tokyo", "JGD2000", "JGD2011", "Korea 2000", "AGD66", "AGD84", "GDA94", "GDA2020", "NZGD49", "NZGD2000", "PNG94", "Timor-Leste",
  // Americas
  "Campo Inchauspe", "POSGAR 2007", "Corrego Alegre 1970-72", "Aratu", "Bogota 1975", "MAGNA-SIRGAS", "La Canoa", "REGVEN", "Naparima 1955", "Naparima 1972", "Trinidad 1903", "Peru96", "Mexico ITRF92", "Mexico ITRF2008", "Chos Malal 1914", "Hito XVIII 1963", "Yacare", "Sapper Hill 1973", "Barbados 1938", "Grand Cayman 1959",
];
const DATUM_SET = new Set(DATUMS);

/**
 * Published Helmert shifts to WGS 84 for datums whose dataset entries only give a grid file, as
 * `[dx, dy, dz, rx, ry, rz, ds]` and the accuracy EPSG states for them, in metres. Everything in
 * the table that has no shift after the grid is dropped, and no entry here, is marked "none".
 */
const HELMERT = {
  "NAD27": { towgs84: [-8, 160, 176, 0, 0, 0, 0], accuracyM: 10, note: "NAD27 to WGS 84 (3), continental USA" },
  "OSGB36": { towgs84: [446.448, -125.157, 542.06, 0.15, 0.247, 0.842, -20.489], accuracyM: 2, note: "OSGB36 to WGS 84 (6)" },
  "DHDN": { towgs84: [598.1, 73.7, 418.2, 0.202, 0.045, -2.455, 6.7], accuracyM: 3, note: "DHDN to WGS 84 (4), all of Germany" },
  "Amersfoort": { towgs84: [565.4171, 50.3319, 465.5524, -0.398957, 0.343988, -1.8774, 4.0725], accuracyM: 1, note: "Amersfoort to WGS 84 (4)" },
  "NTF": { towgs84: [-168, -60, 320, 0, 0, 0, 0], accuracyM: 2, note: "NTF to WGS 84 (1)" },
  "Tokyo": { towgs84: [-146.414, 507.337, 680.507, 0, 0, 0, 0], accuracyM: 3, note: "Tokyo to WGS 84 (2), Japan" },
  "AGD66": { towgs84: [-117.808, -51.536, 137.784, 0.303, 0.446, 0.234, -0.29], accuracyM: 1, note: "AGD66 to WGS 84 (18)" },
  "AGD84": { towgs84: [-117.763, -51.51, 139.061, 0.292, 0.443, 0.277, -0.191], accuracyM: 1, note: "AGD84 to WGS 84 (9)" },
  "NZGD49": { towgs84: [59.47, -5.04, 187.44, 0.47, -0.1, 1.024, -4.5993], accuracyM: 4, note: "NZGD49 to WGS 84 (4)" },
};

const datumOf = (name) => name.includes(" / ") ? name.slice(0, name.indexOf(" / ")) : name;
const KEEP_PROJ = new Set(["utm", "tmerc", "lcc", "omerc", "somerc", "cass", "krovak", "merc", "stere", "sterea", "laea", "aea", "poly", "nzmg", "longlat", "lcca", "gstmerc", "etmerc"]);

const entries = {};
for (const [code, entry] of Object.entries(all)) {
  if (!entry.proj4 || (entry.kind !== "CRS-PROJCRS" && entry.kind !== "CRS-GEOGCRS")) continue;
  if (!DATUM_SET.has(datumOf(entry.name))) continue;
  const proj = /\+proj=([a-z]+)/.exec(entry.proj4)?.[1];
  if (!proj || !KEEP_PROJ.has(proj)) continue;
  // Grid-file shifts a browser cannot read are dropped; a published Helmert stands in where one is listed above.
  let proj4 = entry.proj4.replace(/\s\+(nadgrids|geoidgrids)=\S+/g, "").replace(/\s\+type=crs/, "").trim();
  let datumShift = /\+towgs84=/.test(proj4) ? (/\+towgs84=0,0,0(,0,0,0,0)?\b/.test(proj4) ? "identity" : "towgs84") : /\+datum=WGS84/.test(proj4) ? "identity" : "none";
  let shiftAccuracyM, shiftNote;
  if (datumShift === "none") {
    const helmert = HELMERT[datumOf(entry.name)];
    if (helmert) { proj4 = `${proj4} +towgs84=${helmert.towgs84.join(",")}`; datumShift = "towgs84"; shiftAccuracyM = helmert.accuracyM; shiftNote = helmert.note; }
  }
  entries[`EPSG:${code}`] = { name: entry.name, kind: entry.kind === "CRS-PROJCRS" ? "projected" : "geographic", unit: entry.unit, proj4, datumShift, ...(shiftAccuracyM !== undefined ? { shiftAccuracyM, shiftNote } : {}), ...(entry.bbox ? { bbox: entry.bbox } : {}) };
}

const text = JSON.stringify({ source: `epsg-index ${epsgIndexVersion} (EPSG dataset as packaged)`, generator: "tools/build-crs-defs.mjs", count: Object.keys(entries).length, entries }, null, 0) + "\n";
const target = `${root}packages/core/src/crs-defs.json`;
const summary = `${Object.keys(entries).length} CRSs (${Object.values(entries).filter((e) => e.kind === "projected").length} projected), ${(text.length / 1024).toFixed(0)} kB, ${(gzipSync(text).length / 1024).toFixed(0)} kB gzip; datum shift: ${["towgs84", "identity", "none"].map((kind) => `${kind} ${Object.values(entries).filter((e) => e.datumShift === kind).length}`).join(", ")}`;
if (process.argv.includes("--check")) {
  const current = readFileSync(target, "utf8");
  if (current !== text) { console.error("packages/core/src/crs-defs.json is out of date: run `node tools/build-crs-defs.mjs` and commit it."); process.exit(1); }
  console.log(`CRS table current: ${summary}`);
} else {
  writeFileSync(target, text);
  console.log(`Wrote packages/core/src/crs-defs.json: ${summary}`);
}
