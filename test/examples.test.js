// Checks the teaching examples against the real templates they claim to use, so a
// typo in a path, a local code or a binding claim fails the build.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { parseOpt } from "../src/opt-parser.js";
import { EXAMPLES, prepare, resolvePointer } from "../src/examples/index.js";

const HOW = new Set(["bound", "coded", "mapped", "fhir-code", "text", "context", "direct", "none"]);
const TERMINOLOGY_IN_OPT = { "SNOMED CT": "SNOMED CT", LOINC: "LOINC" };

for (const raw of EXAMPLES) {
  const ex = prepare(raw);
  const t = parseOpt(readFileSync(new URL(`../samples/${ex.template}`, import.meta.url), "utf8"), { DOMParser });

  describe(`example: ${ex.title}`, () => {
    test("sources name the template, FHIR, SNOMED CT and the mapping", () => {
      const roles = new Set(ex.sources.map((s) => s.role));
      for (const r of ["openEHR template", "openEHR archetypes", "FHIR", "SNOMED CT", "Mapping"]) assert.ok(roles.has(r), r);
      for (const s of ex.sources) if (s.url) assert.match(s.url, /^https:\/\//);
    });

    test("link ids are unique and every link has a known 'how'", () => {
      const ids = ex.links.map((l) => l.id);
      assert.equal(new Set(ids).size, ids.length);
      for (const l of ex.links) assert.ok(HOW.has(l.how), `${l.id}: ${l.how}`);
    });

    test("every marker in the JSON belongs to a declared link", () => {
      const ids = new Set(ex.links.map((l) => l.id));
      for (const id of [...ex.openehrPointers.keys(), ...ex.fhirPointers.keys()]) assert.ok(ids.has(id), `undeclared marker ${id}`);
    });

    for (const l of ex.links) {
      test(`${l.id}: openEHR side matches the template`, () => {
        const ptrs = ex.openehrPointers.get(l.id) || [];
        assert.equal(ptrs.length, 1, "exactly one openEHR marker");
        const obj = resolvePointer(ex.openehrJson, ptrs[0]);
        assert.ok(obj, "pointer resolves");
        if (l.openehr.path === null) return; // RM-level link (e.g. subject), no archetype node

        const node = t.nodes.find((n) => n.archetypeRootId === l.openehr.archetype && n.archetypePath === l.openehr.path);
        assert.ok(node, `node ${l.openehr.archetype} ${l.openehr.path} exists in ${ex.template}`);
        const lastCode = l.openehr.path === "/" ? l.openehr.archetype : l.openehr.path.match(/\[(at[\d.]+)\]$/)[1];
        assert.equal(obj.archetype_node_id, lastCode, "instance node id matches path");
        assert.equal(obj.name?.value, node.name, "instance name matches template name");

        if (l.openehr.localCode) {
          const codes = node.values.flatMap((v) => v.codeSet?.codes || []).map((c) => c.code);
          assert.ok(codes.includes(l.openehr.localCode), `${l.openehr.localCode} allowed by template`);
          assert.equal(obj.value.defining_code.code_string, l.openehr.localCode);
        }
        if (l.how === "coded") {
          const dv = node.values.find((v) => v.rmType === "DV_CODED_TEXT");
          assert.equal(dv?.codeSet?.kind, "external", "template constrains to an external value set");
          assert.equal(obj.value.defining_code.code_string, l.terms[0].code);
        }
        for (const term of l.terms.filter((x) => x.source === "archetype binding")) {
          const found = node.bindings.some((b) => b.family === TERMINOLOGY_IN_OPT[term.system] && b.code === term.code);
          assert.ok(found, `${term.system} ${term.code} is an archetype binding on ${l.openehr.path}`);
        }
        if (l.how === "bound") assert.ok(node.bindings.length, "'bound' rows have at least one archetype binding");
        if (l.how === "mapped" && !l.openehr.localCode) assert.equal(node.bindings.length, 0, "mapped node has no binding of its own");
      });

      test(`${l.id}: FHIR side`, () => {
        const ptrs = ex.fhirPointers.get(l.id) || [];
        if (l.how === "none") {
          assert.equal(ptrs.length, 0, "unmapped item has no FHIR marker");
          return;
        }
        assert.ok(ptrs.length >= 1, "has a FHIR marker");
        for (const p of ptrs) assert.notEqual(resolvePointer(ex.fhirJson, p), undefined, `FHIR pointer ${p} resolves`);
        // A SNOMED CT or LOINC code named for this row must appear in the FHIR part it links to,
        // unless the row says the code was not recorded.
        const fhirText = JSON.stringify(ptrs.map((p) => resolvePointer(ex.fhirJson, p)));
        for (const term of l.terms.filter((x) => (x.system === "SNOMED CT" || x.system === "LOINC") && x.source !== "possible, not recorded")) {
          assert.ok(fhirText.includes(`"${term.code}"`), `${term.code} present in the linked FHIR element`);
        }
      });
    }
  });
}
