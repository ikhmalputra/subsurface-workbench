import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { exampleAssembly } from "../../core/dist/index.js";
import { WellAssemblyBuilder } from "../dist/well-assembly-builder.js";

test("controlled assembly editor renders the host working copy instead of its local example", () => {
  const assembly = { ...exampleAssembly(), name: "Host working copy" };
  const state = { past: [], present: assembly, future: [], selectedId: assembly.items[0].id };
  const html = renderToStaticMarkup(createElement(WellAssemblyBuilder, {
    assetBaseUrl: "/well-components", editorState: state, onEditorStateChange() {},
  }));
  assert.match(html, /Host working copy/);
  assert.match(html, /assembly-inspector/);
});

test("partial controlled editor configuration fails explicitly", () => {
  const state = { past: [], present: exampleAssembly(), future: [], selectedId: null };
  for (const props of [{ editorState: state }, { onEditorStateChange() {} }]) {
    assert.throws(() => renderToStaticMarkup(createElement(WellAssemblyBuilder, {
      assetBaseUrl: "/well-components", ...props,
    })), /requires editorState and onEditorStateChange together/);
  }
});

test("standalone assembly builder keeps its initial-assembly API", () => {
  const assembly = { ...exampleAssembly(), name: "Standalone assembly" };
  const html = renderToStaticMarkup(createElement(WellAssemblyBuilder, { assetBaseUrl: "/well-components", initialAssembly: assembly }));
  assert.match(html, /Standalone assembly/);
  assert.match(html, /Export JSON/);
  assert.match(html, /Blank well/);
});

test("embedded assembly editor leaves identity, reset and export ownership with the host", () => {
  const html = renderToStaticMarkup(createElement(WellAssemblyBuilder, { assetBaseUrl: "/well-components", initialAssembly: exampleAssembly(), embedded: true }));
  assert.doesNotMatch(html, /Export JSON|Blank well|Loaded the example|PLUG-AND-PLAY/);
  assert.match(html, /aria-label="Undo"/);
  assert.match(html, /3D view/);
  assert.match(html, /Component to edit/);
});
