import assert from "node:assert/strict";
import test from "node:test";
import { createEditHistory } from "./edit-history.ts";

test("a what-if shows live but commits nothing until it is applied", () => {
  const history = createEditHistory({ mud: 1.3 }, { now: () => 1 });
  history.propose("Mud weight 1.30 → 1.36 SG", { mud: 1.36 });
  history.propose("Mud weight 1.30 → 1.42 SG", { mud: 1.42 });
  assert.equal(history.current().mud, 1.42);
  assert.equal(history.getState().committed.mud, 1.3);
  assert.equal(history.getState().undo.length, 0);
  assert.equal(history.apply(), true);
  assert.equal(history.getState().committed.mud, 1.42);
  assert.deepEqual(history.getState().undo.map((step) => step.label), ["Mud weight 1.30 → 1.42 SG"], "one drag is one step");
  assert.equal(history.apply(), false);
});

test("discard drops the what-if; proposing the committed value clears it", () => {
  const start = { mud: 1.3 };
  const history = createEditHistory(start);
  history.propose("try", { mud: 1.5 });
  history.discard();
  assert.equal(history.current(), start);
  history.propose("try", { mud: 1.5 });
  history.propose("back", start);
  assert.equal(history.getState().pending, null);
});

test("undo and redo move through applied steps, and a new apply clears redo", () => {
  const history = createEditHistory(0);
  for (const value of [1, 2, 3]) { history.propose(`to ${value}`, value); history.apply(); }
  assert.equal(history.undo(), true);
  assert.equal(history.undo(), true);
  assert.equal(history.current(), 1);
  assert.equal(history.redo(), true);
  assert.equal(history.current(), 2);
  history.propose("to 9", 9); history.apply();
  assert.equal(history.getState().redo.length, 0);
  assert.equal(history.redo(), false);
  assert.deepEqual(history.getState().undo.map((step) => step.label), ["to 1", "to 2", "to 9"]);
});

test("undo while a what-if is pending drops the what-if with it", () => {
  const history = createEditHistory(0);
  history.propose("to 1", 1); history.apply();
  history.propose("to 5", 5);
  history.undo();
  assert.equal(history.getState().pending, null);
  assert.equal(history.current(), 0);
});

test("the history keeps at most its limit, notifies subscribers and resets", () => {
  const history = createEditHistory(0, { limit: 2 });
  const seen: number[] = [];
  const off = history.subscribe((state) => seen.push(state.undo.length));
  for (const value of [1, 2, 3]) { history.propose(`to ${value}`, value); history.apply(); }
  assert.equal(history.getState().undo.length, 2);
  assert.equal(history.getState().undo[0]!.before, 1);
  off();
  history.reset(7);
  assert.equal(history.current(), 7);
  assert.equal(history.getState().undo.length, 0);
  assert.ok(seen.length >= 6);
  assert.throws(() => history.propose(" ", 1), /label/);
  assert.throws(() => createEditHistory(0, { limit: 0 }), /limit/);
});
