import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandButton } from "../dist/ui.js";
import { readFileSync, readdirSync } from "node:fs";
import { URL } from "node:url";

test("commands preserve native button semantics and expose consistent decorative icons", () => {
  const html = renderToStaticMarkup(createElement(CommandButton, { icon: "save", disabled: true, "aria-label": "Save design", className: "custom" }, "Save"));
  assert.match(html, /type="button"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /class="custom"/);
  assert.match(html, /data-ui-kind="command"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /width="16"/);
  assert.match(html, /title="Save design"/);
  const submit = renderToStaticMarkup(createElement(CommandButton, { type: "submit", icon: "apply" }, "Apply"));
  assert.match(submit, /type="submit"/);
  const selection = renderToStaticMarkup(createElement(CommandButton, { kind: "selection", "aria-pressed": true }, "Record"));
  assert.match(selection, /data-ui-kind="selection"/);
  assert.doesNotMatch(selection, /<svg/);
});

test("SDK and host modules use the shared button primitive, not private native button patterns", () => {
  for (const directory of [new URL("../src/", import.meta.url), new URL("../../../apps/demo/src/components/", import.meta.url)]) {
    for (const name of readdirSync(directory).filter((name) => name.endsWith(".tsx") && name !== "ui.tsx")) {
      const text = readFileSync(new URL(name, directory), "utf8");
      assert.doesNotMatch(text, /<button\b/, `${name} should use CommandButton with an explicit command/selection role`);
    }
  }
});
