import assert from "node:assert/strict";
import test from "node:test";
import { developerViews, isIndependentExample, workspaces, workspaceForRoute } from "../src/lib/workspace-routes.ts";

test("every legacy engineering route has one workspace owner", () => {
  const routes = workspaces.flatMap((workspace) => [...workspace.views.map((view) => view.href), ...workspace.related]);
  assert.equal(new Set(routes).size, routes.length);
  assert.deepEqual(workspaces.map((workspace) => workspace.id), ["well", "design", "field", "analysis"]);
  assert.equal(workspaceForRoute("/edit-well/")?.id, "well");
  assert.equal(workspaceForRoute("/well-report/")?.id, "well");
  assert.equal(workspaceForRoute("/builder/")?.id, "design");
  for (const route of routes) assert.ok(workspaceForRoute(route));
  for (const view of developerViews) assert.equal(workspaceForRoute(view.href), undefined);
});

test("navigation metadata and fixture availability use the same route registry", () => {
  for (const workspace of workspaces) {
    assert.ok(workspace.views.some((view) => view.href === workspace.entry));
    for (const view of workspace.views) assert.equal(isIndependentExample(view.href), view.independent);
    for (const route of workspace.related) assert.equal(isIndependentExample(route), false);
  }
  for (const view of developerViews) assert.equal(isIndependentExample(view.href), true);
  assert.equal(isIndependentExample("/unknown/"), false);
});
