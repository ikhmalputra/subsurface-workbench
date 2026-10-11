import type { SpatialReference } from "./contracts.ts";

export interface ContractIssue { readonly path: string; readonly message: string }

export class ContractValidationError extends TypeError {
  readonly issues: readonly ContractIssue[];
  constructor(issues: readonly ContractIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "ContractValidationError";
    this.issues = issues;
  }
}

export function fail(path: string, message: string): never {
  throw new ContractValidationError([{ path, message }]);
}

export function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "expected an object");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!keys.includes(key)) fail(`${path}.${key}`, "unknown field");
  for (const key of keys) if (!Object.hasOwn(record, key)) fail(`${path}.${key}`, "required field");
  return record;
}

export function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) fail(path, "expected a non-empty string");
  return value;
}

export function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "expected a finite number");
  return value;
}

export function literal<T extends string | number>(value: unknown, expected: T, path: string): T {
  if (value !== expected) fail(path, `expected ${JSON.stringify(expected)}`);
  return expected;
}

export function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return Array.from(value);
}

export function triple(value: unknown, path: string): [number, number, number] {
  const entries = array(value, path);
  if (entries.length !== 3) fail(path, "expected exactly three numbers");
  return [number(entries[0], `${path}[0]`), number(entries[1], `${path}[1]`), number(entries[2], `${path}[2]`)];
}

export function reference(value: unknown, path: string): SpatialReference {
  const record = object(value, path, ["units", "crs", "depthDatum"]);
  return { units: literal(record.units, "m", `${path}.units`), crs: text(record.crs, `${path}.crs`), depthDatum: text(record.depthDatum, `${path}.depthDatum`) };
}
