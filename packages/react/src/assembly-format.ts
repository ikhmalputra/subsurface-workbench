const fractions: Record<string, string> = { "0.125": "⅛", "0.25": "¼", "0.375": "⅜", "0.5": "½", "0.625": "⅝", "0.75": "¾", "0.875": "⅞" };

/** 9.625 → 9⅝″, 4.5 → 4½″, 6.184 → 6.184″ */
export function formatInches(value: number | null | undefined): string {
  if (value === null || value === undefined || !value) return "—";
  const whole = Math.floor(value);
  const fraction = fractions[String(Number((value - whole).toFixed(3)))];
  if (fraction) return `${whole || ""}${fraction}″`;
  return `${Number(value.toFixed(3))}″`;
}

export function formatDepth(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} m`;
}
