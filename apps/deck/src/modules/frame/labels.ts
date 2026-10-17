/**
 * The one label rule for charts and maps: a label that would land on one already placed is dropped,
 * never drawn over it. Labels are placed in the order given (put the important ones first); boxes
 * are estimated from the text at the chart's font (about 6 px a character at 10–11 px).
 */
export interface LabelBox { readonly x: number; readonly y: number; readonly text: string; readonly anchor?: "start" | "middle" | "end" }
export function placeLabels(labels: readonly LabelBox[], options: { readonly charW?: number; readonly height?: number; readonly pad?: number; readonly taken?: readonly { x0: number; y0: number; x1: number; y1: number }[] } = {}): boolean[] {
  const charW = options.charW ?? 6, h = options.height ?? 11, pad = options.pad ?? 2;
  const taken = [...(options.taken ?? [])];
  return labels.map((label) => {
    const w = label.text.length * charW;
    const x0 = label.anchor === "end" ? label.x - w : label.anchor === "middle" ? label.x - w / 2 : label.x;
    const box = { x0: x0 - pad, y0: label.y - h - pad, x1: x0 + w + pad, y1: label.y + pad };
    if (taken.some((r) => box.x0 < r.x1 && box.x1 > r.x0 && box.y0 < r.y1 && box.y1 > r.y0)) return false;
    taken.push(box);
    return true;
  });
}
