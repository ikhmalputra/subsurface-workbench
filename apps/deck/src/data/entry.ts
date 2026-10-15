/**
 * Reading what a user pastes or drops in: survey stations from a spreadsheet, a CSV or a contractor's
 * text report. Nothing is guessed silently: the columns found, the unit applied and every line left
 * out are reported back, so the user sees exactly what was read.
 */

export type DepthUnit = "m" | "ft" | "usft";
export const DEPTH_UNITS: readonly { readonly value: DepthUnit; readonly label: string; readonly metres: number }[] = [
  { value: "m", label: "metres", metres: 1 },
  { value: "ft", label: "feet (international)", metres: 0.3048 },
  { value: "usft", label: "US survey feet", metres: 1200 / 3937 },
];
export const toMetres = (value: number, unit: DepthUnit) => value * DEPTH_UNITS.find((entry) => entry.value === unit)!.metres;

export interface EnteredStation { readonly mdM: number; readonly inclinationDeg: number; readonly azimuthDeg: number }
export interface StationRead {
  readonly stations: readonly EnteredStation[];
  /** Which column of the text each value came from (0-based), and whether a header named them. */
  readonly columns: { readonly md: number; readonly inc: number; readonly azi: number; readonly fromHeader: boolean };
  /** Lines not read, with why. */
  readonly skipped: readonly { readonly line: number; readonly text: string; readonly why: string }[];
  /** Problems with the stations read: not deepening, angles out of range. */
  readonly problems: readonly string[];
  /** A unit named in the header (e.g. "MD (ft)"), if any, for the user to confirm. */
  readonly headerUnit: DepthUnit | null;
}

/**
 * Cells of a line: the separator (tab, semicolon, comma, then spaces) that yields the most numbers;
 * among equals the first that splits the line at all, so "MD (ft)" stays one header cell in a
 * tab-separated paste.
 */
const splitLine = (line: string): string[] => {
  const trimmed = line.trim();
  const candidates = [trimmed.split("\t"), trimmed.split(";"), trimmed.split(","), trimmed.split(/\s+/)].map((cells) => cells.map((cell) => cell.trim()).filter((cell) => cell !== ""));
  const numeric = (cells: string[]) => cells.filter((cell) => numberOf(cell) !== null).length;
  const most = Math.max(...candidates.map(numeric));
  return candidates.find((cells) => numeric(cells) === most && cells.length >= 2) ?? candidates.at(-1)!;
};
const numberOf = (cell: string): number | null => {
  const clean = cell.replace(/[\s'"]/g, "").replace(/,(?=\d{3}(\D|$))/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(clean)) return null;
  return Number(clean);
};

/** Reads MD, inclination and azimuth, one station a line, converting depths from `unit` to metres. */
export function readStations(text: string, unit: DepthUnit): StationRead {
  const lines = text.split(/\r?\n/);
  let columns = { md: 0, inc: 1, azi: 2, fromHeader: false };
  let headerUnit: DepthUnit | null = null;
  const skipped: { line: number; text: string; why: string }[] = [];
  const stations: EnteredStation[] = [];
  lines.forEach((raw, index) => {
    if (!raw.trim()) return;
    const cells = splitLine(raw);
    const numbers = cells.map(numberOf);
    if (numbers.filter((value) => value !== null).length < 3) {
      // A header names the columns: take their order from it, once, before any data.
      if (!stations.length && !columns.fromHeader) {
        const lower = cells.map((cell) => cell.toLowerCase());
        const find = (pattern: RegExp) => lower.findIndex((cell) => pattern.test(cell));
        const md = find(/^(md|measured|m\.?d\.?\b|depth|dept)/), inc = find(/^(inc|incl|inclination|angle|dev)/), azi = find(/^(az|azi|azim|azimuth|dir|direction|bearing)/);
        if (md >= 0 && inc >= 0 && azi >= 0) {
          columns = { md, inc, azi, fromHeader: true };
          const named = cells[md]!.toLowerCase();
          headerUnit = /us\s*ft|usft|survey\s*f/.test(named) ? "usft" : /\b(ft|feet)\b|\(ft\)|\[ft\]/.test(named) ? "ft" : /\(m\)|\[m\]|\bm\b|metre|meter/.test(named) ? "m" : null;
          return;
        }
      }
      skipped.push({ line: index + 1, text: raw.trim().slice(0, 80), why: "not three numbers" });
      return;
    }
    // Without a header, the first three numbers on the line, whatever label stands before them ("MWD 1,892.0 1.36 55.82").
    const values = columns.fromHeader ? [numbers[columns.md], numbers[columns.inc], numbers[columns.azi]] : numbers.filter((value) => value !== null).slice(0, 3);
    const [md, inc, azi] = values;
    if (md == null || inc == null || azi == null) { skipped.push({ line: index + 1, text: raw.trim().slice(0, 80), why: "a column is empty" }); return; }
    stations.push({ mdM: toMetres(md, unit), inclinationDeg: inc, azimuthDeg: azi });
  });
  const problems: string[] = [];
  stations.forEach((station, index) => {
    if (station.inclinationDeg < 0 || station.inclinationDeg > 180) problems.push(`Station ${index + 1}: inclination ${station.inclinationDeg}° is outside 0–180°.`);
    if (station.azimuthDeg < 0 || station.azimuthDeg > 360) problems.push(`Station ${index + 1}: azimuth ${station.azimuthDeg}° is outside 0–360°.`);
    if (index > 0 && station.mdM <= stations[index - 1]!.mdM) problems.push(`Station ${index + 1}: MD ${round(station.mdM)} m does not deepen from ${round(stations[index - 1]!.mdM)} m.`);
  });
  return { stations, columns, skipped, problems, headerUnit };
}
const round = (value: number) => Math.round(value * 100) / 100;
