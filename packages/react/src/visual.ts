export type SubsurfaceColorMapName = "viridis" | "cividis";

const colorMapStops: Readonly<Record<SubsurfaceColorMapName, readonly string[]>> = {
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  cividis: ["#00224e", "#414d6b", "#7d7c78", "#bcae6c", "#fee838"],
};

function channelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearToChannel(channel: number): number {
  const clipped = Math.max(0, Math.min(1, channel));
  const srgb = clipped <= 0.0031308 ? clipped * 12.92 : 1.055 * clipped ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

function toOklab(hex: string): readonly [number, number, number] {
  const rgb = [1, 3, 5].map((offset) => channelToLinear(Number.parseInt(hex.slice(offset, offset + 2), 16)));
  const [red, green, blue] = rgb;
  const l = Math.cbrt(0.4122214708 * red! + 0.5363325363 * green! + 0.0514459929 * blue!);
  const m = Math.cbrt(0.2119034982 * red! + 0.6806995451 * green! + 0.1073969566 * blue!);
  const s = Math.cbrt(0.0883024619 * red! + 0.2817188376 * green! + 0.6299787005 * blue!);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab(lab: readonly [number, number, number]): string {
  const [lightness, a, b] = lab;
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${rgb.map(linearToChannel).map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

/** Clamped interpolation in OKLab across named, perceptually uniform sequential-map anchors. */
export function sampleColorMap(value: number, domain: readonly [number, number], map: SubsurfaceColorMapName = "cividis"): string {
  if (!Number.isFinite(value) || !Number.isFinite(domain[0]) || !Number.isFinite(domain[1]) || domain[1] <= domain[0]) {
    throw new RangeError("Colour mapping requires a finite value and strictly increasing domain.");
  }
  const stops = colorMapStops[map];
  if (!stops) throw new TypeError(`Unsupported subsurface colour map: ${String(map)}`);
  const position = Math.max(0, Math.min(1, (value - domain[0]) / (domain[1] - domain[0]))) * (stops.length - 1);
  const low = Math.floor(position), high = Math.min(stops.length - 1, low + 1), fraction = position - low;
  if (fraction === 0) return stops[low]!;
  const first = toOklab(stops[low]!);
  const second = toOklab(stops[high]!);
  return fromOklab([
    first[0] + (second[0] - first[0]) * fraction,
    first[1] + (second[1] - first[1]) * fraction,
    first[2] + (second[2] - first[2]) * fraction,
  ]);
}

export function colorMapCss(map: SubsurfaceColorMapName = "cividis"): string {
  if (!colorMapStops[map]) throw new TypeError(`Unsupported subsurface colour map: ${String(map)}`);
  const stops = Array.from({ length: 33 }, (_, index) => {
    const position = index / 32;
    return `${sampleColorMap(position, [0, 1], map)} ${position * 100}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/** Colour-blind-aware qualitative palette; use line style, marker shape, or labels as well as colour. */
export const subsurfaceCategoryPalette = Object.freeze([
  "#0072b2", "#d55e00", "#009e73", "#cc79a7",
  "#e69f00", "#56b4e9", "#f0e442", "#332288",
] as const);

export function categoryColor(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("Category index must be a non-negative safe integer.");
  return subsurfaceCategoryPalette[index % subsurfaceCategoryPalette.length]!;
}
