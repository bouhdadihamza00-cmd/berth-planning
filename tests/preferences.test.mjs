import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePreferences,
  DEFAULT_PREFERENCES,
  translateText,
  getLocale,
  applyPreferences,
  translateUI,
} from "../frontend/preferences.js";
test("saved preferences normalize invalid and out-of-range values", () => {
  assert.deepEqual(
    normalizePreferences({ theme: "bogus", language: "xx", fontSize: 99 }),
    { ...DEFAULT_PREFERENCES, fontSize: 18 },
  );
  assert.equal(normalizePreferences({ fontSize: 9 }).fontSize, 11);
  assert.equal(normalizePreferences({ fontSize: "not a number" }).fontSize, 13);
});
test("interface translations preserve unknown operational data", () => {
  assert.equal(translateText("Product catalogue", "fr"), "Catalogue produits");
  assert.equal(translateText("MV Gulf Pioneer", "ar"), "MV Gulf Pioneer");
  assert.equal(translateText("DAP Bangladesh", "fr"), "DAP Bangladesh");
});
test("preferences apply theme, reading direction and sizing and expose regional locale", () => {
  const attrs = {},
    vars = {};
  globalThis.localStorage = {
    getItem: () =>
      JSON.stringify({
        theme: "dark",
        language: "ar",
        fontSize: 16,
        density: "comfortable",
        motion: "reduced",
        contrast: "high",
      }),
  };
  globalThis.document = {
    documentElement: {
      dataset: attrs,
      style: { setProperty: (key, value) => (vars[key] = value) },
    },
    querySelectorAll: () => [],
  };
  applyPreferences();
  assert.equal(attrs.theme, "dark");
  assert.equal(attrs.density, "comfortable");
  assert.equal(attrs.motion, "reduced");
  assert.equal(attrs.contrast, "high");
  assert.equal(document.documentElement.dir, "rtl");
  assert.equal(vars["--app-font-size"], "16px");
  assert.equal(getLocale(), "ar-MA");
  delete globalThis.document;
  delete globalThis.localStorage;
});
test("redesigned workspaces and numbered workflow steps follow the chosen language", () => {
  assert.equal(translateText("Workflow center", "fr"), "Centre des workflows");
  assert.equal(translateText("Delete subgrade", "fr"), "Supprimer la sous-qualité");
  assert.equal(translateText("Number of steps", "ar"), "عدد المراحل");
  assert.equal(translateText("Step 3", "fr"), "Étape 3");
  assert.equal(translateText("Step 3", "en"), "Step 3");
});

test("translated select labels retain their original submitted values and restore to English", () => {
  const text = {nodeType:3, textContent:"Loading"};
  const attrs = {};
  const option = {
    tagName:"OPTION", childNodes:[text], closest:()=>null, matches:()=>false,
    hasAttribute:key=>key in attrs, setAttribute:(key,value)=>{attrs[key]=value;},
    get value(){return attrs.value ?? text.textContent;},
  };
  const root = {querySelectorAll:selector=>selector.startsWith("option,")?[option]:[]};
  let language = "fr";
  globalThis.localStorage = {getItem:()=>JSON.stringify({language})};
  try {
    translateUI(root);
    assert.equal(text.textContent,"Chargement");
    assert.equal(option.value,"Loading");
    language="en";
    translateUI(root);
    assert.equal(text.textContent,"Loading");
    assert.equal(option.value,"Loading");
  } finally {delete globalThis.localStorage;}
});
