import { Color } from "three";

export function dlsColor(dls: number, limit: number) {
  const ratio = dls / Math.max(limit, 1e-6);
  const green = new Color("#0f9a7c");
  const amber = new Color("#e3a21a");
  const red = new Color("#c62828");
  return ratio <= 1 ? green.lerp(amber, ratio) : amber.lerp(red, Math.min(1, (ratio - 1) * 2));
}
