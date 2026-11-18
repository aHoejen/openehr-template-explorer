# SNOMED CT in openEHR

A static web demonstrator for teaching how **openEHR, FHIR and SNOMED CT** fit together:

- **openEHR**: the EHR, where data is recorded and kept.
- **FHIR**: the message, the exchange structure for a specific template's data.
- **SNOMED CT**: the meaning, kept the same from recording to exchange.

It has two modes.

## Clinical scenarios

The start page introduces three **clinical scenarios**: things a clinician recorded for one fictional patient. A short diagram shows *definitions* (archetypes, template), the *recorded data* (an instance) and the *FHIR message*. Each scenario card offers two steps:

1. **Explore the template.** Opens the template explorer on the scenario's template (the definition, with its archetypes inside). A banner there says it holds no patient data and links on to the scenario.
2. **Follow the recorded data.** Opens the scenario walkthrough. That page links back to the full template.

The look and feel follows the SNOMED CT Implementation Demos (ihtsdo.github.io/sct-implementation-demonstrator): Roboto, a dark toolbar, blue headings with Material icons, and flat outlined cards. It does not use the SNOMED International logo, as this is not an official SNOMED International product.

Opening a scenario shows a "Recorded data" banner, followed by the walkthrough described below. For every item, step 3 also shows what FHIR demands of the target element. That is either a **terminology binding** (required, extensible, preferred, example only, or none), or, for the vital-sign codes, a **profile constraint**: the R4 vital-signs profiles define a mandatory coding slice (e.g. `Observation.code.coding:BPCode`) with `fixedUri` http://loinc.org and a `fixedCode`, so that exact LOINC coding must be present. Other codings, such as SNOMED CT, may be added alongside, because the slicing is open. This makes clear when FHIR actually demands a code system and when SNOMED CT is a choice made by the mapping. The bindings were checked against the FHIR R4 and IPS 2.0.1 StructureDefinitions.

## Worked examples

Three worked examples, each following real data from openEHR to FHIR:

| Example | openEHR template | FHIR |
|---|---|---|
| Vital signs | Vital signs monitoring (blood pressure, pulse, respiration, temperature, SpO₂) | Bundle of 5 Observations, R4 vital-signs profiles |
| Diagnosis | IPS Problem List (CKM) | Condition, IPS profile |
| Allergy | IPS Allergies and Intolerances (CKM) | AllergyIntolerance, IPS profile |

Each scenario is one side-by-side view:
- a short **"Recorded data"** banner with the story. Its ⓘ popup holds the setting, who recorded it, the template, and the archetypes it contains;
- a **summary** of outcomes (*meaning kept automatically*, *translated by a simple rule*, *needs a mapping decision*, *meaning lost or weakened*). Click one to filter; its ⓘ explains the four outcomes;
- **three columns, one row per recorded item**, grouped by archetype: *Recorded in openEHR* → *Meaning in SNOMED CT* → *Sent in FHIR*. Each row shows the value as stored, the SNOMED CT concept (checked live: active or inactive), and what the FHIR message carries;
- an **ⓘ on each row** that opens the full explanation: the verdict, how the value is stored, the FHIR binding or profile constraint, the "why this matters" note, and technical details (paths, codes, JSON snippets, *open in the template explorer*). The column headers have ⓘ popups too;
- a **"Show the full JSON"** switch that turns the same three columns into the complete openEHR JSON, the code list and the FHIR JSON, with the selected item highlighted. Clicking a highlighted part selects that item.

Rows can be selected with the mouse or the arrow keys. The popups close with Escape, and on phones they open as a bottom sheet.

The examples live in `src/examples/*.js`. `test/examples.test.js` checks each one against its real template: every path exists, every local code is allowed, every "archetype binding" really is one, and every code appears in the linked FHIR element. The SNOMED CT codes were checked as active in the 2026-01-01 International Edition when written. The mappings are hand-written for teaching. openEHR has no single standard mapping to FHIR.

## Template explorer

Open an openEHR **Operational Template (OPT 1.4 XML)** to see the following. For the bundled samples, the header shows each template's source and licence:

1. **The node tree:** COMPOSITION → SECTION → ENTRY → CLUSTER → ELEMENT. Each node shows its RM type, at-code, archetype id (at archetype roots), name and occurrences.
2. **Data values for each ELEMENT:** the data type (DV_QUANTITY, DV_CODED_TEXT, DV_ORDINAL, …), units, ranges and precision. Also the **allowed coded values**: local at-codes with their text, an external code list, or an external value-set reference (`referenceSetUri`, including FHIR `ValueSet/$expand` URLs with ECL).
3. **Terminology bindings** (SNOMED CT, LOINC, …), shown next to the node or coded value they bind. A flat **Bindings** table (archetype, path, node/code, terminology, code) can be exported as CSV.
4. **Teaching highlights:**
   - elements with **no binding**
   - coded value lists that are **local only**, or only partly bound
   - old **`SNOMED-CT(2003)`-style version stamps**
   - removed (0..0) nodes and slots
   - archetype bindings for nodes the template does not use
   - the **AQL path** of every node, plus an example AQL query, each with a copy button

By default the tree is kept simple: each row shows an icon, the name, a plain data type (quantity, coded text …) and any SNOMED CT or LOINC codes. A flag appears only for the highlight you picked. The **Technical details** switch shows RM types, at-codes, occurrences and all flags. In the detail panel, RM facts, paths and AQL sit in a collapsed *Technical details* section. Template id, source, licence and the archetypes inside are in the ⓘ next to the title.

Everything runs in the browser. The OPT is parsed locally with `DOMParser` and never uploaded.

## Live site

<https://ahoejen.github.io/snomed-in-openehr/> (GitHub Pages, published from `main`).

## Run it

It is a static site with no build step. ES modules need an HTTP server, so `file://` will not work:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>. The worked examples open first. *Template explorer* lets you pick a sample or drop your own `.opt` file.
You can link straight to a view: `#example=vital-signs`, `#example=diagnosis`, `#example=allergy`, or `#sample=vital-signs-monitoring.opt`.

`npm start` does the same with `npx serve`.

### Getting OPT files

- **Archetype Designer** (<https://tools.openehr.org/designer>): open or build a template, then *Export → OPT (1.4)*.
- **CKM** (<https://ckm.openehr.org>): open a template, then *Export → Operational template*.

## Tests

The parser (`src/opt-parser.js`) is plain JavaScript that also runs in Node, using [`@xmldom/xmldom`](https://github.com/xmldom/xmldom) as the DOM.

```bash
npm install
npm test
```

The tests check the bindings listed in the project brief against real OPTs. The values below come from the CKM archetypes:

| Archetype | Node | Binding |
|---|---|---|
| blood_pressure.v2 | at0000, at0004, at0005, at0013 | SNOMED CT 364090009, 271649006, 271650006, 246153002, all stamped `SNOMED-CT(2003)` |
| respiration.v2 | at0067 Sitting, at0069 Lying, at0004 Rate | 33586001, 40199007, 271625008 |
| pulse_oximetry.v1 | at0006 SpO₂ | SNOMED CT 431314004 and LOINC 59408-5 |
| body_temperature.v2 | at0004 Temperature | SNOMED CT 386725007 and `LNC205` 8310-5 |

They also cover the edge cases in the synthetic `teaching-edge-cases.opt`.

## How the parser reads an OPT 1.4

- The root is `<template xmlns="http://schemas.openehr.org/v1">`. The parser reads `template_id/value`, `concept`, `language` and `description/details/purpose`.
- `definition` is the root `C_ARCHETYPE_ROOT`. It is walked recursively through `attributes` (`C_SINGLE_ATTRIBUTE` / `C_MULTIPLE_ATTRIBUTE`) and `children`.
- **Names come from the nearest enclosing `C_ARCHETYPE_ROOT`.** Each root carries its own `term_definitions` and `term_bindings`. A template-level rename (a `name` attribute constrained to one string) takes precedence over the archetype text.
- Tree nodes are `C_ARCHETYPE_ROOT`, `ARCHETYPE_SLOT`, and `C_COMPLEX_OBJECT`s that are not data values. Data values (`DV_*`, `CODE_PHRASE`) under `ELEMENT.value` become the element's data constraints. Data values on other attributes (for example `COMPOSITION.category`) are listed as "other attribute constraints".
- Coded values come from `C_CODE_PHRASE` (`terminology_id` + `code_list`), `C_CODE_REFERENCE` (`referenceSetUri`), `CONSTRAINT_REF` (ac-codes) and `C_DV_ORDINAL`.
- Quantities come from `C_DV_QUANTITY`: `property` (an openEHR code) and `list` items (`units`, `magnitude`, `precision`).
- **Binding targets:**
  - `items code="atNNNN"` binds every node with that at-code inside the same archetype root, and every *local* coded value with that code. These are two different things: the node's meaning, and one value in its list.
  - A path-style code such as `/data[at0001]/…/items[at0004]` binds the node at that archetype path.
  - A binding whose target is not in the template is kept and listed as "not in this template".
- **Binding forms** are normalised: `SNOMED-CT` + `364090009`, `SNOMED-CT(2003)` + `364090009`, `[SNOMED-CT(2003)::364090009]` and `http://snomed.info/id/364090009` are all read as the same binding. The version stamp is kept so it can be flagged.
- **Paths** are AQL paths from the composition and from the nearest archetype root. Sibling clones that share an at-code get a name predicate: `items[at0011,'Left side']`.

`src/openehr-terms.js` holds openEHR terminology rubrics, used for example to show that `openehr::125` means *Pressure*. It is generated from the openEHR [specifications-TERM](https://github.com/openEHR/specifications-TERM) XML by `scripts/build-openehr-terms.py`.

## Project layout

```
index.html            page shell
styles.css            styles (light and dark)
src/opt-parser.js     OPT 1.4 parser + CSV/AQL helpers (browser + Node)
src/app.js            UI: modes/routing, tree, detail panel, bindings table, CSV export
src/examples-view.js  worked examples: mapping table, linked JSON panels, live SNOMED CT lookup
src/examples/         the three examples (openEHR instance, FHIR resource, links) + RM/FHIR builders
src/json-view.js      JSON renderer with linkable nodes
src/openehr-terms.js  generated openEHR terminology rubrics
samples/              sample OPTs (see samples/SOURCES.md)
scripts/              generators for openehr-terms.js and the synthetic sample
test/                 node:test unit tests
```

## Possible next steps

- SNOMED CT lookup through a configurable FHIR terminology server (`CodeSystem/$lookup`), to show the FSN and active status of each bound code.
- Web template (JSON) input.
- ADL 2 / OPT2 input.

## Licensing

- Code: Apache License 2.0 (see `LICENSE`).
- Archetypes and templates from the openEHR CKM are licensed **CC BY-SA 4.0** (some older ones 3.0). See `samples/SOURCES.md` for where each sample came from.
- **SNOMED CT** codes appear for teaching. Using SNOMED CT needs an Affiliate licence from SNOMED International, or access through a Member country's National Release Centre.
- **LOINC** codes are © Regenstrief Institute, Inc., used under the LOINC licence.
