import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { arpsCumulative, arpsRate, arpsTimeToRate, daysInMonth, effectiveDecline, fitArps } from "./decline.ts";

const months = (count: number) => Array.from({ length: count }, (_, i) => (i + 0.5) / 12);

for (const b of [0, 0.5, 1]) {
  test(`a clean b = ${b} decline is recovered exactly`, () => {
    const truth = { qi: 1000, di: 0.35, b };
    const t = months(120);
    const fit = fitArps(t, t.map((time) => arpsRate(truth, time)))!;
    assert.equal(fit.b, b);
    assert.ok(Math.abs(fit.qi - 1000) / 1000 < 1e-6, `qi ${fit.qi}`);
    assert.ok(Math.abs(fit.di - 0.35) / 0.35 < 1e-6, `di ${fit.di}`);
    assert.ok(fit.r2Log > 0.999999);
  });
}

test("the closed-form cumulatives equal the integrated rate", () => {
  for (const b of [0, 0.3, 0.7, 1]) {
    const decline = { qi: 500, di: 0.4, b };
    let sum = 0;
    const steps = 20000, horizon = 15;
    for (let k = 0; k < steps; k++) sum += arpsRate(decline, (k + 0.5) * horizon / steps) * horizon / steps * 365.25;
    assert.ok(Math.abs(arpsCumulative(decline, horizon) - sum) / sum < 1e-6, `b ${b}`);
  }
});

test("time to a rate inverts the rate", () => {
  for (const b of [0, 0.5, 1]) {
    const decline = { qi: 800, di: 0.25, b };
    assert.ok(Math.abs(arpsRate(decline, arpsTimeToRate(decline, 40)) - 40) < 1e-9);
  }
  assert.equal(arpsTimeToRate({ qi: 10, di: 0.2, b: 0 }, 20), 0);
  assert.equal(arpsTimeToRate({ qi: 10, di: 0, b: 0 }, 5), Infinity);
  assert.ok(Math.abs(effectiveDecline({ qi: 1, di: Math.log(2), b: 0 }) - 0.5) < 1e-12);
});

test("missing and zero months are left out, not fitted as zero", () => {
  const t = months(60);
  const rates = t.map((time, i) => i % 7 === 3 ? null : i % 11 === 5 ? 0 : arpsRate({ qi: 300, di: 0.2, b: 0 }, time));
  const fit = fitArps(t, rates)!;
  assert.ok(fit.samples < 60 && Math.abs(fit.di - 0.2) < 1e-6);
  assert.equal(fitArps([0, 1], [1, 2]), null);
  assert.equal(daysInMonth(2024 * 12 + 1), 29);
  assert.equal(daysInMonth(2023 * 12 + 1), 28);
});

test("Statfjord oil since 2000 fits an Arps curve closely", () => {
  const record = JSON.parse(readFileSync(new URL("../../fixtures/data/sodir-field-production.json", import.meta.url), "utf8"));
  const field = record.fields.find((entry: { name: string }) => entry.name === "STATFJORD");
  const start = 2000 * 12;
  const t: number[] = [], q: (number | null)[] = [];
  field.month.forEach((month: number, i: number) => { if (month >= start) { t.push((month - start + 0.5) / 12); q.push(field.oil[i] === null ? null : field.oil[i] * 1e6 / daysInMonth(month)); } });
  const fit = fitArps(t, q)!;
  assert.ok(fit.b >= 0 && fit.b <= 1);
  assert.ok(fit.r2Log > 0.9, `R² ${fit.r2Log}`);
  assert.ok(fit.qi > 10000 && fit.qi < 100000, `qi ${fit.qi} Sm3/d`);
});
