/** A number for reading, with thousands separators and a fixed number of decimals. */
export const fmt = (value: number, digits = 0) => value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
