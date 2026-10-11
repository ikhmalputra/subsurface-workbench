import forgeSeismicData from "./forge-seismic.json" with { type: "json" };

/** SEG-Y sample format codes this parser decodes. */
export type SegySampleFormat = 1 | 2 | 3 | 5 | 8;
export type SegyFieldType = "int16" | "int32" | "uint16" | "ibm" | "ieee";

/** A trace-header field: 1-based byte position as written in the SEG-Y standard. */
export interface SegyHeaderField {
  readonly byte: number;
  readonly type: SegyFieldType;
}

/** Where to read geometry from each 240-byte trace header. Defaults are SEG-Y rev 1 standard locations. */
export interface SegyTraceHeaderLayout {
  readonly inline: SegyHeaderField;
  readonly crossline: SegyHeaderField;
  readonly cdp: SegyHeaderField;
  readonly cdpX: SegyHeaderField;
  readonly cdpY: SegyHeaderField;
  readonly coordinateScalar: SegyHeaderField;
  readonly shotpoint: SegyHeaderField;
}

export const standardTraceHeaderLayout: SegyTraceHeaderLayout = {
  inline: { byte: 189, type: "int32" },
  crossline: { byte: 193, type: "int32" },
  cdp: { byte: 21, type: "int32" },
  cdpX: { byte: 181, type: "int32" },
  cdpY: { byte: 185, type: "int32" },
  coordinateScalar: { byte: 71, type: "int16" },
  shotpoint: { byte: 197, type: "int32" },
};

export interface SegyBinaryHeader {
  readonly jobId: number;
  readonly lineNumber: number;
  readonly reelNumber: number;
  readonly tracesPerEnsemble: number;
  readonly auxTracesPerEnsemble: number;
  /** Bytes 3217–3218. Microseconds for time data; depth data often stores the step in mm or 1/1000 ft. */
  readonly sampleInterval: number;
  readonly sampleIntervalOriginal: number;
  readonly samplesPerTrace: number;
  readonly samplesPerTraceOriginal: number;
  readonly format: number;
  readonly ensembleFold: number;
  readonly sortingCode: number;
  /** 1 = metres, 2 = feet, 0 = unspecified. */
  readonly measurementSystem: number;
  readonly revision: string;
  readonly fixedLengthTraces: number;
  readonly extendedTextHeaders: number;
}

export interface SegyTrace {
  readonly index: number;
  readonly inline: number;
  readonly crossline: number;
  readonly cdp: number;
  /** Coordinates with the coordinate scalar applied (integer fields only). */
  readonly x: number;
  readonly y: number;
  readonly shotpoint: number;
  readonly coordinateScalar: number;
  readonly headerSampleCount: number;
}

export interface SegyFile {
  /** 40 card images, EBCDIC or ASCII decoded, trailing spaces trimmed. */
  readonly textHeader: readonly string[];
  readonly textEncoding: "ebcdic" | "ascii";
  readonly byteOrder: "big" | "little";
  readonly binary: SegyBinaryHeader;
  readonly formatName: string;
  readonly sampleCount: number;
  readonly traceCount: number;
  readonly traces: readonly SegyTrace[];
  /** Trace-major samples: trace t, sample s at data[t * sampleCount + s]. */
  readonly data: Float32Array;
  readonly byteLength: number;
}

export interface ParseSegyOptions {
  readonly layout?: Partial<SegyTraceHeaderLayout>;
  /** Read at most this many traces. */
  readonly maxTraces?: number;
}

const formatNames: Record<SegySampleFormat, string> = {
  1: "4-byte IBM floating point",
  2: "4-byte two's complement integer",
  3: "2-byte two's complement integer",
  5: "4-byte IEEE floating point",
  8: "1-byte two's complement integer",
};
const formatBytes: Record<SegySampleFormat, number> = { 1: 4, 2: 4, 3: 2, 5: 4, 8: 1 };

// Code page 037, non-printable positions mapped to space.
const EBCDIC = "                                                                  \u00e2\u00e4\u00e0\u00e1\u00e3\u00e5\u00e7\u00f1\u00a2.<(+|&\u00e9\u00ea\u00eb\u00e8\u00ed\u00ee\u00ef\u00ec\u00df!$*);\u00ac-/\u00c2\u00c4\u00c0\u00c1\u00c3\u00c5\u00c7\u00d1\u00a6,%_>?\u00f8\u00c9\u00ca\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc`:#@'=\"\u00d8abcdefghi\u00ab\u00bb\u00f0\u00fd\u00fe\u00b1\u00b0jklmnopqr\u00aa\u00ba\u00e6\u00b8\u00c6\u00a4\u00b5~stuvwxyz\u00a1\u00bf\u00d0\u00dd\u00de\u00ae^\u00a3\u00a5\u00b7\u00a9\u00a7\u00b6\u00bc\u00bd\u00be[]\u00af\u00a8\u00b4\u00d7{ABCDEFGHI \u00f4\u00f6\u00f2\u00f3\u00f5}JKLMNOPQR\u00b9\u00fb\u00fc\u00f9\u00fa\u00ff\\\u00f7STUVWXYZ\u00b2\u00d4\u00d6\u00d2\u00d3\u00d50123456789\u00b3\u00db\u00dc\u00d9\u00da ";

/** Decode EBCDIC (code page 037) bytes to text. */
export function ebcdicToText(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += EBCDIC[byte];
  return text;
}

/** IBM System/360 single-precision float from its 32-bit pattern. */
export function ibmToFloat(bits: number): number {
  const word = bits >>> 0;
  const mantissa = word & 0x00ffffff;
  if (mantissa === 0) return 0;
  const sign = word >>> 31 ? -1 : 1;
  const exponent = (word >>> 24) & 0x7f;
  return sign * (mantissa / 0x1000000) * 16 ** (exponent - 64);
}

function readField(view: DataView, offset: number, field: SegyHeaderField, little: boolean): number {
  const at = offset + field.byte - 1;
  switch (field.type) {
    case "int16": return view.getInt16(at, little);
    case "uint16": return view.getUint16(at, little);
    case "int32": return view.getInt32(at, little);
    case "ieee": return view.getFloat32(at, little);
    case "ibm": return ibmToFloat(view.getUint32(at, little));
  }
}

function decodeText(bytes: Uint8Array): { lines: string[]; encoding: "ebcdic" | "ascii" } {
  // EBCDIC 'C' is 0xC3; ASCII 'C' is 0x43. Count bytes in the printable ASCII range to decide.
  let ascii = 0;
  for (const byte of bytes) if (byte >= 0x20 && byte < 0x7f) ascii += 1;
  const encoding = ascii > bytes.length * 0.9 && bytes[0] !== 0xc3 ? "ascii" : "ebcdic";
  const text = encoding === "ascii" ? String.fromCharCode(...bytes) : ebcdicToText(bytes);
  const lines = Array.from({ length: Math.ceil(text.length / 80) }, (_, index) => text.slice(index * 80, index * 80 + 80).trimEnd());
  return { lines, encoding };
}

/**
 * Parse a SEG-Y rev 0/1/2 file with fixed-length traces. Reads the 3200-byte textual header,
 * the 400-byte binary header, extended textual headers and every trace (header geometry plus samples).
 * Byte order is detected from the format code. Use `layout` for files that store geometry at non-standard bytes.
 */
export function parseSegy(buffer: ArrayBuffer, options: ParseSegyOptions = {}): SegyFile {
  if (buffer.byteLength < 3600) throw new Error("SEG-Y file is shorter than its 3600-byte file header");
  const view = new DataView(buffer);
  const bigFormat = view.getUint16(3224, false);
  const little = !(bigFormat in formatNames) && view.getUint16(3224, true) in formatNames;
  const u16 = (byte: number) => view.getUint16(byte - 1, little);
  const i16 = (byte: number) => view.getInt16(byte - 1, little);
  const i32 = (byte: number) => view.getInt32(byte - 1, little);
  const format = u16(3225);
  if (!(format in formatNames)) throw new Error(`Unsupported SEG-Y sample format code ${format}`);
  const sampleFormat = format as SegySampleFormat;
  const revisionMajor = view.getUint8(3500);
  const revisionMinor = view.getUint8(3501);
  const binary: SegyBinaryHeader = {
    jobId: i32(3201),
    lineNumber: i32(3205),
    reelNumber: i32(3209),
    tracesPerEnsemble: i16(3213),
    auxTracesPerEnsemble: i16(3215),
    sampleInterval: u16(3217),
    sampleIntervalOriginal: u16(3219),
    samplesPerTrace: u16(3221),
    samplesPerTraceOriginal: u16(3223),
    format,
    ensembleFold: i16(3227),
    sortingCode: i16(3229),
    measurementSystem: i16(3255),
    revision: `${revisionMajor}.${revisionMinor}`,
    fixedLengthTraces: i16(3503),
    extendedTextHeaders: i16(3505),
  };
  const text = decodeText(new Uint8Array(buffer, 0, 3200));
  const extended = Math.max(0, binary.extendedTextHeaders);
  const firstTrace = 3600 + extended * 3200;
  const layout = { ...standardTraceHeaderLayout, ...options.layout };
  let sampleCount = binary.samplesPerTrace;
  if (sampleCount === 0 && buffer.byteLength >= firstTrace + 240) sampleCount = view.getUint16(firstTrace + 114, little);
  if (sampleCount === 0) throw new Error("SEG-Y sample count is zero in both binary and first trace header");
  const traceBytes = 240 + sampleCount * formatBytes[sampleFormat];
  const available = Math.floor((buffer.byteLength - firstTrace) / traceBytes);
  const traceCount = Math.min(available, options.maxTraces ?? Infinity);
  const data = new Float32Array(traceCount * sampleCount);
  const traces: SegyTrace[] = [];
  for (let index = 0; index < traceCount; index += 1) {
    const offset = firstTrace + index * traceBytes;
    const rawScalar = readField(view, offset, layout.coordinateScalar, little);
    const scale = rawScalar < 0 ? 1 / -rawScalar : rawScalar > 0 ? rawScalar : 1;
    const coordinate = (field: SegyHeaderField) => {
      const value = readField(view, offset, field, little);
      return field.type === "ibm" || field.type === "ieee" ? value : value * scale;
    };
    traces.push({
      index,
      inline: readField(view, offset, layout.inline, little),
      crossline: readField(view, offset, layout.crossline, little),
      cdp: readField(view, offset, layout.cdp, little),
      x: coordinate(layout.cdpX),
      y: coordinate(layout.cdpY),
      shotpoint: readField(view, offset, layout.shotpoint, little),
      coordinateScalar: rawScalar,
      headerSampleCount: view.getUint16(offset + 114, little),
    });
    const start = offset + 240;
    const target = index * sampleCount;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      let value: number;
      switch (sampleFormat) {
        case 1: value = ibmToFloat(view.getUint32(start + sample * 4, little)); break;
        case 2: value = view.getInt32(start + sample * 4, little); break;
        case 3: value = view.getInt16(start + sample * 2, little); break;
        case 5: value = view.getFloat32(start + sample * 4, little); break;
        case 8: value = view.getInt8(start + sample); break;
      }
      data[target + sample] = value;
    }
  }
  return {
    textHeader: text.lines,
    textEncoding: text.encoding,
    byteOrder: little ? "little" : "big",
    binary,
    formatName: formatNames[sampleFormat],
    sampleCount,
    traceCount,
    traces,
    data,
    byteLength: buffer.byteLength,
  };
}

/** Samples of one trace (a view, not a copy). */
export function segyTrace(file: SegyFile, index: number): Float32Array {
  return file.data.subarray(index * file.sampleCount, (index + 1) * file.sampleCount);
}

/** Absolute-amplitude percentile, a robust display clip. Samples at most `maxSamples` values evenly. */
export function amplitudeClip(data: Float32Array, percentile = 99, maxSamples = 200_000): number {
  const stride = Math.max(1, Math.floor(data.length / maxSamples));
  const values: number[] = [];
  for (let index = 0; index < data.length; index += stride) {
    const value = Math.abs(data[index]!);
    if (Number.isFinite(value)) values.push(value);
  }
  if (values.length === 0) return 1;
  values.sort((a, b) => a - b);
  const rank = Math.min(values.length - 1, Math.max(0, Math.round((percentile / 100) * (values.length - 1))));
  return values[rank]! || 1;
}

/** Depth below a seismic datum (positive down) from TVD below a rig/kelly-bushing reference. */
export function tvdToSeismicDepth(tvdM: number, referenceElevationM: number, datumElevationM: number): number {
  return tvdM + datumElevationM - referenceElevationM;
}

/** Inverse of `tvdToSeismicDepth`: section depth below datum → TVD below the well reference. */
export function seismicDepthToTvd(depthM: number, referenceElevationM: number, datumElevationM: number): number {
  return depthM - datumElevationM + referenceElevationM;
}

export type SeismicColorMap = "grey" | "red-blue" | "seismic";

const SEISMIC_STOPS: readonly (readonly [number, number, number])[] = [[0, 0, 77], [0, 40, 255], [255, 255, 255], [255, 26, 0], [128, 0, 0]];

/**
 * Colour for a clipped amplitude in −1…1. grey: peak black. red-blue: troughs blue, peaks red, zero white (pale, for
 * light 2D panels). seismic: the saturated diverging interpretation map, dark navy → blue → white → red → dark red.
 */
export function seismicColour(map: SeismicColorMap, value: number): [number, number, number] {
  const t = Math.max(-1, Math.min(1, value));
  if (map === "grey") { const g = Math.round(127.5 - 127.5 * t); return [g, g, g]; }
  if (map === "seismic") {
    const position = (t + 1) * 2, index = Math.min(3, Math.floor(position)), f = position - index;
    const a = SEISMIC_STOPS[index]!, b = SEISMIC_STOPS[index + 1]!;
    return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
  }
  if (t < 0) { const k = -t; return [Math.round(255 - 235 * k), Math.round(255 - 200 * k), Math.round(255 - 75 * k)]; }
  return [Math.round(255 - 75 * t), Math.round(255 - 235 * t), Math.round(255 - 225 * t)];
}

/** RGBA image, row 0 first. For a section: one column per trace and one row per sample. */
export interface SeismicImage { readonly data: Uint8ClampedArray; readonly width: number; readonly height: number }
export interface SeismicImageOptions { readonly colorMap?: SeismicColorMap; readonly clip?: number }

function paint(width: number, height: number, valueAt: (column: number, row: number) => number, clip: number, map: SeismicColorMap): SeismicImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const [r, g, b] = seismicColour(map, valueAt(column, row) / clip);
      const at = (row * width + column) * 4;
      data[at] = r; data[at + 1] = g; data[at + 2] = b; data[at + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Variable-density image of every trace, amplitudes divided by `clip` (default p99) before colouring. Works without a DOM. */
export function seismicImage(file: SegyFile, options: SeismicImageOptions = {}): SeismicImage {
  const height = file.sampleCount;
  return paint(file.traceCount, height, (trace, sample) => file.data[trace * height + sample]!, options.clip ?? amplitudeClip(file.data), options.colorMap ?? "grey");
}

export interface SectionLine {
  /** Origin of the along-line distance axis, same CRS as the points. */
  readonly originEastingM: number;
  readonly originNorthingM: number;
  readonly azimuthDeg: number;
}

export interface ProjectedPoint {
  readonly mdM: number;
  readonly alongM: number;
  /** Signed horizontal distance off the line, positive to the right looking along azimuth. */
  readonly offsetM: number;
  readonly depthM: number;
}

/**
 * Project a trajectory (absolute easting/northing plus a depth already in section datum) onto a straight
 * vertical section. Returns distance along the line and how far each station sits off it.
 */
export function projectOntoSection(points: readonly { readonly mdM: number; readonly eastingM: number; readonly northingM: number; readonly depthM: number }[], line: SectionLine): ProjectedPoint[] {
  const radians = (line.azimuthDeg * Math.PI) / 180;
  const east = Math.sin(radians);
  const north = Math.cos(radians);
  return points.map((point) => {
    const de = point.eastingM - line.originEastingM;
    const dn = point.northingM - line.originNorthingM;
    return { mdM: point.mdM, alongM: de * east + dn * north, offsetM: de * north - dn * east, depthM: point.depthM };
  });
}

export interface SeismicSectionMetadata {
  readonly id: string;
  readonly title: string;
  readonly license: string;
  readonly attribution: string;
  readonly source: { readonly url: string; readonly member: string; readonly sha256: string; readonly title: string; readonly textHeader: readonly string[] };
  readonly wellheadSource: { readonly url: string; readonly title: string };
  readonly crs: string;
  readonly wellhead: { readonly eastingM: number; readonly northingM: number; readonly groundElevationM: number };
  readonly seismicDatumElevationM: number;
  readonly rkbElevationM: number;
  readonly volume: { readonly inlines: readonly number[]; readonly crosslines: readonly number[]; readonly binM: number; readonly sampleIntervalM: number; readonly samples: number; readonly gridFitResidualM: number };
  readonly section: { readonly file: string; readonly sha256: string; readonly azimuthDeg: number; readonly fromM: number; readonly toM: number; readonly traceSpacingM: number; readonly traces: number; readonly samples: number; readonly maxDepthM: number; readonly p99AbsAmplitude: number };
  /**
   * Well-centred sub-volume on a grid aligned with `section`: int8 counts, x = along fastest, then offset (right of the
   * azimuth), then depth sample from 0 m below datum. amplitude = count × amplitudePerCount, clipped at `clipPercentile`.
   */
  readonly subVolume?: { readonly file: string; readonly sha256: string; readonly encoding: string; readonly azimuthDeg: number; readonly alongFromM: number; readonly alongToM: number; readonly offsetFromM: number; readonly offsetToM: number; readonly spacingM: number; readonly alongCount: number; readonly offsetCount: number; readonly samples: number; readonly sampleIntervalM: number; readonly maxDepthM: number; readonly amplitudePerCount: number; readonly clipPercentile: number; readonly clippedFraction: number };
  readonly checks: { readonly planToeVsSurveyM: number; readonly surveyAzimuthReference: string };
  readonly notes: readonly string[];
}

/** Provenance and geometry for the bundled Utah FORGE 16A(78)-32 PSDM well-path section. */
export const forgeSeismicSection: SeismicSectionMetadata = forgeSeismicData;

/** Header layout of the original FORGE 3D PSDM volume (inline/crossline in the high halves of bytes 9/13, IBM CMP X/Y at 189/193). */
export const forgePsdmVolumeLayout: Partial<SegyTraceHeaderLayout> = {
  inline: { byte: 9, type: "int16" },
  crossline: { byte: 13, type: "int16" },
  cdpX: { byte: 189, type: "ibm" },
  cdpY: { byte: 193, type: "ibm" },
};

/** Well position at a measured depth, linearly interpolated between projected stations. */
export function wellPointAtMd(path: readonly ProjectedPoint[], md: number): ProjectedPoint | null {
  if (path.length === 0) return null;
  if (md <= path[0]!.mdM) return path[0]!;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!, b = path[i]!;
    if (md <= b.mdM) {
      const t = b.mdM === a.mdM ? 0 : (md - a.mdM) / (b.mdM - a.mdM);
      return { mdM: md, alongM: a.alongM + t * (b.alongM - a.alongM), offsetM: a.offsetM + t * (b.offsetM - a.offsetM), depthM: a.depthM + t * (b.depthM - a.depthM) };
    }
  }
  return path.at(-1)!;
}

/** First measured depth at which the well reaches a section depth, or `null` if it never does. */
export function wellMdAtDepth(path: readonly ProjectedPoint[], depth: number): number | null {
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!, b = path[i]!;
    if ((a.depthM - depth) * (b.depthM - depth) <= 0) return b.depthM === a.depthM ? a.mdM : a.mdM + ((depth - a.depthM) / (b.depthM - a.depthM)) * (b.mdM - a.mdM);
  }
  return null;
}
