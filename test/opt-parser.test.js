import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import {
  parseOpt,
  normaliseBinding,
  describeReferenceSetUri,
  formatRange,
  formatOccurrences,
  bindingsToCsv,
  aqlFor,
} from "../src/opt-parser.js";

const load = (name) => parseOpt(readFileSync(new URL(`../samples/${name}`, import.meta.url), "utf8"), { DOMParser });

const ARCH = {
  bp: "openEHR-EHR-OBSERVATION.blood_pressure.v2",
  resp: "openEHR-EHR-OBSERVATION.respiration.v2",
  spo2: "openEHR-EHR-OBSERVATION.pulse_oximetry.v1",
  temp: "openEHR-EHR-OBSERVATION.body_temperature.v2",
  pulse: "openEHR-EHR-OBSERVATION.pulse.v2",
};

/** All bindings for an archetype + target code, as "TERMINOLOGY:code" strings. */
function bound(t, archetypeId, target) {
  return t.bindings
    .filter((b) => b.archetypeId === archetypeId && b.target === target)
    .map((b) => `${b.terminology}:${b.code}`)
    .sort();
}

function element(t, archetypeId, nodeId) {
  return t.nodes.find((n) => n.archetypeRootId === archetypeId && n.nodeId === nodeId && n.kind === "element");
}

describe("helpers", () => {
  test("normaliseBinding handles plain, version-stamped, bracketed and URI forms", () => {
    assert.deepEqual(
      [normaliseBinding("SNOMED-CT", "364090009")].map(({ terminology, version, code }) => ({ terminology, version, code })),
      [{ terminology: "SNOMED-CT", version: null, code: "364090009" }],
    );
    const stamped = normaliseBinding("SNOMED-CT(2003)", "246153002");
    assert.equal(stamped.terminology, "SNOMED-CT");
    assert.equal(stamped.version, "2003");
    const bracketed = normaliseBinding("SNOMED-CT", "[SNOMED-CT(2003)::271649006]");
    assert.equal(bracketed.code, "271649006");
    assert.equal(bracketed.version, "2003");
    assert.equal(normaliseBinding("SNOMED-CT", "http://snomed.info/id/386725007").code, "386725007");
    assert.equal(normaliseBinding("LNC205", "8310-5").family, "LOINC");
  });

  test("describeReferenceSetUri decodes FHIR ValueSet + ECL references", () => {
    const r = describeReferenceSetUri("terminology://fhir.hl7.org/ValueSet/$expand?url=http://snomed.info/sct?fhir_vs=ecl/%3C%3C404684003");
    assert.equal(r.kind, "FHIR ValueSet");
    assert.equal(r.ecl, "<<404684003");
    assert.equal(r.terminology, "SNOMED CT");
    assert.equal(describeReferenceSetUri("terminology:PSYNOTES?subset=categories").terminology, "PSYNOTES");
  });

  test("interval formatting", () => {
    assert.equal(formatRange({ lower: 0, upper: 1000, lowerIncluded: true, upperIncluded: false }), "0..<1000");
    assert.equal(formatRange({ lower: 0, upper: null, lowerIncluded: true, upperIncluded: true }), ">=0");
    assert.equal(formatOccurrences({ lower: 0, upper: null }), "0..*");
  });

  test("rejects non-OPT XML", () => {
    assert.throws(() => parseOpt("<archetype/>", { DOMParser }), /OPT 1\.4 <template>/);
  });
});

describe("Vital signs (CKM export)", () => {
  const t = load("vital-signs-ckm.opt");

  test("template metadata and archetypes", () => {
    assert.equal(t.templateId, "Vital signs");
    assert.equal(t.root.rmType, "COMPOSITION");
    for (const id of Object.values(ARCH)) assert.ok(t.archetypes.some((a) => a.archetypeId === id), id);
  });

  test("blood_pressure.v2 bindings, stamped SNOMED-CT(2003)", () => {
    assert.deepEqual(bound(t, ARCH.bp, "at0000"), ["SNOMED-CT:364090009"]);
    assert.deepEqual(bound(t, ARCH.bp, "at0004"), ["SNOMED-CT:271649006"]);
    assert.deepEqual(bound(t, ARCH.bp, "at0005"), ["SNOMED-CT:271650006"]);
    assert.deepEqual(bound(t, ARCH.bp, "at0013"), ["SNOMED-CT:246153002"]);
    const bp = t.bindings.filter((b) => b.archetypeId === ARCH.bp);
    assert.ok(bp.every((b) => b.terminologyRaw === "SNOMED-CT(2003)" && b.version === "2003"));
  });

  test("bindings attach to the archetype root and elements", () => {
    const root = t.nodes.find((n) => n.archetypeId === ARCH.bp);
    assert.deepEqual(root.bindings.map((b) => b.code), ["364090009"]);
    const sys = element(t, ARCH.bp, "at0004");
    assert.equal(sys.name, "Systolic");
    assert.deepEqual(sys.bindings.map((b) => b.code), ["271649006"]);
    // Cuff size is bound in the archetype but not part of this template.
    assert.equal(t.bindings.find((b) => b.archetypeId === ARCH.bp && b.target === "at0013").targetKind, "unmatched");
  });

  test("respiration.v2, pulse_oximetry.v1 and body_temperature.v2 bindings", () => {
    assert.deepEqual(bound(t, ARCH.resp, "at0067"), ["SNOMED-CT:33586001"]);
    assert.deepEqual(bound(t, ARCH.resp, "at0069"), ["SNOMED-CT:40199007"]);
    assert.deepEqual(bound(t, ARCH.resp, "at0004"), ["SNOMED-CT:271625008"]);
    assert.deepEqual(bound(t, ARCH.spo2, "at0006"), ["LOINC:59408-5", "SNOMED-CT:431314004"]);
    assert.deepEqual(bound(t, ARCH.temp, "at0004"), ["LNC205:8310-5", "SNOMED-CT:386725007"]);
  });

  test("quantity constraints", () => {
    const sys = element(t, ARCH.bp, "at0004");
    const q = sys.values[0];
    assert.equal(q.rmType, "DV_QUANTITY");
    assert.equal(q.units[0].units, "mm[Hg]");
    assert.equal(formatRange(q.units[0].magnitude), "0..<1000");
    assert.equal(q.property.text, "Pressure");
  });

  test("AQL paths", () => {
    const sys = element(t, ARCH.bp, "at0004");
    assert.equal(
      sys.path,
      `/content[${ARCH.bp}]/data[at0001]/events[at0006]/data[at0003]/items[at0004]`,
    );
    assert.equal(sys.archetypeValuePath, "/data[at0001]/events[at0006]/data[at0003]/items[at0004]/value");
    assert.match(aqlFor(sys, t), /SELECT o\/data\[at0001\]\/events\[at0006\]\/data\[at0003\]\/items\[at0004\]\/value/);
    assert.match(aqlFor(sys, t), /CONTAINS OBSERVATION o\[openEHR-EHR-OBSERVATION\.blood_pressure\.v2\]/);
  });

  test("slots are recognised", () => {
    assert.ok(t.findings.slots.length > 0);
  });
});

describe("Vital signs monitoring (coded value lists)", () => {
  const t = load("vital-signs-monitoring.opt");

  test("respiration body position codes carry SNOMED CT value bindings", () => {
    const n = t.nodes.find((x) => x.archetypeRootId === ARCH.resp && x.name === "Body position");
    const codes = Object.fromEntries(n.values[0].codeSet.codes.map((c) => [c.text, c.bindings?.map((b) => b.code)]));
    assert.deepEqual(codes.Sitting, ["33586001"]);
    assert.deepEqual(codes.Lying, ["40199007"]);
    assert.ok(!t.findings.localOnlyValueSets.includes(n.id));
  });

  test("blood pressure cuff size is a local-only value set", () => {
    const n = t.nodes.find((x) => x.archetypeRootId === ARCH.bp && x.name === "Cuff size");
    assert.equal(n.values[0].codeSet.kind, "local");
    assert.ok(n.values[0].codeSet.codes.some((c) => c.text === "Adult"));
    assert.ok(t.findings.localOnlyValueSets.includes(n.id));
  });

  test("value bindings appear in the bindings table with a defining_code path", () => {
    const row = t.bindings.find((b) => b.archetypeId === ARCH.resp && b.target === "at0067");
    assert.equal(row.targetKind, "value");
    assert.equal(row.text, "Sitting");
    assert.match(row.path, /\/value\/defining_code$/);
  });
});

describe("EHRN vital signs (EHRbase, bracketed code strings)", () => {
  const t = load("ehrn-vital-signs.opt");
  test("bracketed [SNOMED-CT(2003)::code] strings are normalised", () => {
    assert.deepEqual(bound(t, ARCH.bp, "at0000"), ["SNOMED-CT:364090009"]);
    assert.ok(t.bindings.filter((b) => b.archetypeId === ARCH.bp).every((b) => b.version === "2003"));
  });
  test("archetypes nested under a SECTION resolve names from their own root", () => {
    const sys = element(t, ARCH.bp, "at0004");
    assert.equal(sys.name, "Systolic");
    assert.match(sys.path, /^\/content\[openEHR-EHR-SECTION\.vital_signs\.v1\]\/items\[openEHR-EHR-OBSERVATION\.blood_pressure\.v2\]/);
  });
});

describe("Psychotherapy note (C_CODE_REFERENCE)", () => {
  const t = load("psychotherapy-note.opt");
  test("external reference set constraint is read", () => {
    const ext = t.nodes.filter((n) => t.findings.externalValueSets.includes(n.id));
    assert.equal(ext.length, 1);
    assert.equal(ext[0].values[0].codeSet.kind, "external");
    assert.equal(ext[0].values[0].codeSet.reference.uri, "terminology:PSYNOTES?subset=categories");
    assert.equal(ext[0].values[0].codeSet.constraintRef.code, "ac0001");
  });
});

describe("Teaching edge cases (synthetic)", () => {
  const t = load("teaching-edge-cases.opt");
  const arch = "openEHR-EHR-OBSERVATION.teaching_example.v0";
  const byName = (name) => t.nodes.find((n) => n.name === name);

  test("removed node (0..0) is flagged", () => {
    assert.equal(byName("Removed item").removed, true);
    assert.ok(t.findings.removed.includes(byName("Removed item").id));
  });

  test("template renames and cloned siblings get name predicates", () => {
    assert.match(byName("Left side").path, /items\[at0011,'Left side'\]$/);
    assert.match(byName("Right side").path, /items\[at0011,'Right side'\]$/);
  });

  test("path-based binding attaches to the right node", () => {
    assert.deepEqual(byName("Number of episodes").bindings.map((b) => `${b.terminology}:${b.code}`), ["LOINC:8310-5"]);
  });

  test("partly bound local value set", () => {
    const sev = byName("Severity");
    assert.equal(sev.values[0].codeSet.boundCount, 2);
    assert.ok(t.findings.partlyBoundValueSets.includes(sev.id));
  });

  test("external value set with ECL", () => {
    const cs = byName("Finding").values[0].codeSet;
    assert.equal(cs.kind, "external");
    assert.equal(cs.reference.ecl, "<<404684003");
  });

  test("ordinal, count, quantity and external code list", () => {
    assert.deepEqual(byName("Score").values[0].ordinals.map((o) => `${o.value}:${o.text}`), ["0:None", "1:Some", "2:A lot"]);
    assert.deepEqual(byName("Number of episodes").values[0].attributes, [{ attribute: "magnitude", constraint: "0..20" }]);
    assert.deepEqual(byName("Temperature").values[0].units.map((u) => u.units), ["Cel", "[degF]"]);
    const yn = byName("Confirmed?").values[0].codeSet;
    assert.equal(yn.kind, "external-list");
    assert.deepEqual(yn.codes.map((c) => c.code), ["373066001", "373067005"]);
  });

  test("URI-form binding and unmatched binding", () => {
    assert.deepEqual(bound(t, arch, "at0018"), ["SNOMED-CT:386725007"]);
    assert.equal(t.bindings.find((b) => b.target === "at0099").targetKind, "unmatched");
  });

  test("slot includes", () => {
    assert.deepEqual(byName("Device").slot.includes, ["openEHR-EHR-CLUSTER\\.device\\.v1"]);
  });

  test("CSV export escapes and has a header", () => {
    const csv = bindingsToCsv(t.bindings);
    const lines = csv.trim().split("\r\n");
    assert.equal(lines[0], "Archetype,Path in template,Path in archetype,Node/code,Bound to,Text,Terminology,Code,Version stamp");
    assert.equal(lines.length, t.bindings.length + 1);
    assert.ok(lines.some((l) => l.endsWith("/items[at0005]/value/defining_code,at0006,value,Mild,SNOMED-CT(2003),255604002,2003")));
    assert.ok(bindingsToCsv([{ text: 'a "quoted", text' }]).includes('"a ""quoted"", text"'));
  });
});
