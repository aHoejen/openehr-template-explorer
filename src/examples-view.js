// "Worked examples" mode: follow one item at a time from openEHR (recorded),
// through SNOMED CT (meaning), to FHIR (sent).
import { EXAMPLES, prepare, resolvePointer } from "./examples/index.js";
import { renderJson, invert } from "./json-view.js";
import { parseOpt } from "./opt-parser.js";
import { infoButton, openInfo, closeInfo } from "./info-pop.js";

const $ = (sel) => document.querySelector(sel);

/** replaceChildren that skips null/false, so optional parts never render as "null". */
function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
}

function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.className = classes.join(" ");
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Four plain-language outcomes, from best to worst. */
export const OUTCOMES = {
  automatic: { icon: "✓", label: "Meaning kept automatically", short: "Automatic" },
  rule: { icon: "⇄", label: "Translated by a simple rule", short: "Simple rule" },
  decision: { icon: "!", label: "Needs a mapping decision", short: "Decision needed" },
  lost: { icon: "✕", label: "Meaning lost or weakened", short: "Lost" },
};

/** The detailed reason behind each outcome, in plain words. */
export const HOW = {
  bound: { outcome: "automatic", reason: "The archetype itself says what this item means, so the code goes into the message as it is." },
  coded: { outcome: "automatic", reason: "A SNOMED CT code was recorded as the value. Template and message use the same value set, so the code passes straight through." },
  direct: { outcome: "automatic", reason: "The same kind of value exists on both sides, so it is copied across." },
  context: { outcome: "automatic", reason: "Not typed in by anyone. It follows from the template or from whose record this is." },
  "fhir-code": { outcome: "rule", reason: "FHIR insists on its own fixed list of codes here. A small lookup table translates the openEHR choice." },
  mapped: { outcome: "decision", reason: "openEHR only has a local code here. Someone had to choose the SNOMED CT concept for the message. Another system might choose differently." },
  text: { outcome: "lost", reason: "The template only allows free text, so the message can carry the words but not a reliable code." },
  none: { outcome: "lost", reason: "FHIR has no standard place for this, so it stays in the openEHR record and is not sent." },
};

const SOURCE_TEXT = {
  "archetype binding": "from the archetype",
  "recorded value": "recorded in the data",
  mapping: "chosen by the mapping",
  "FHIR profile": "required by the FHIR profile",
  "FHIR code system": "FHIR's own code",
  "possible, not recorded": "possible, but not recorded",
};

const DEFAULT_SERVER = "https://implementation-demo.snomedtools.org/snowstorm-lite/fhir";
const lookupCache = new Map();

const templateCache = new Map(); // file -> Promise<parsed template>
let currentTemplate = null; // parsed OPT of the current example, once loaded
let current = null; // prepared example
let selected = null; // link id
let filter = null; // outcome key
let openInExplorer = () => {};

export function initExamples(opts) {
  openInExplorer = opts.openInExplorer;
  for (const b of document.querySelectorAll(".fm-card, .fm-thread")) {
    b.addEventListener("click", () => openInfo(b, FLOW_STEPS[b.dataset.step].title, flowStepInfo(b.dataset.step)));
  }
  const input = $("#tx-server");
  input.value = readServer();
  $("#tx-form").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      localStorage.setItem("txServer", input.value.trim());
    } catch {}
    lookupCache.clear();
    renderRows();
    renderConcepts();
  });
  $("#tx-reset").addEventListener("click", () => {
    input.value = DEFAULT_SERVER;
    try {
      localStorage.removeItem("txServer");
    } catch {}
    lookupCache.clear();
    renderRows();
    renderConcepts();
  });
  $("#sxs-rows").addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const items = groupedLinks().flatMap((g) => g.items);
    const i = items.findIndex((l) => l.id === selected);
    const to = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : i + (e.key === "ArrowDown" ? 1 : -1);
    const next = items[Math.max(0, Math.min(items.length - 1, to))];
    if (next) {
      select(next.id);
      document.querySelector(`#sxs-rows [data-id="${CSS.escape(next.id)}"]`)?.focus();
    }
  });
  $("#json-toggle").addEventListener("change", (e) => {
    const on = e.target.checked;
    $("#sxs-rows").hidden = on;
    $("#sxs-json").hidden = !on;
    renderJsonSelected();
    highlight(on);
  });
}

function readServer() {
  try {
    return localStorage.getItem("txServer") || DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}

const outcomeOf = (l) => HOW[l.how].outcome;
const visibleLinks = () => current.links.filter((l) => !filter || outcomeOf(l) === filter);

/** A Material Symbols icon for each scenario. */
const SCENARIO_ICON = { "vital-signs": "monitor_heart", diagnosis: "stethoscope", allergy: "allergy" };
const scenarioIcon = (ex) => h("span.sc-icon.material-symbols-outlined", { "aria-hidden": "true" }, SCENARIO_ICON[ex.id] || "assignment");

/** The four steps of the "From definition to message" strip on the scenarios home. */
const FLOW_STEPS = {
  archetypes: {
    title: "Archetypes: the definition of one clinical concept",
    text: [
      "An archetype is an agreed, reusable model of one clinical concept, such as Blood pressure or Problem/Diagnosis. It lists every data point the concept may need, with its data type, units and allowed values.",
      "Archetypes can bind their nodes and values to terminologies such as SNOMED CT and LOINC. Shared archetypes are reviewed and published in the openEHR Clinical Knowledge Manager (CKM).",
    ],
    links: (ex) => ({ href: `#sample=${encodeURIComponent(ex.template)}`, text: `See the archetypes in the ${ex.title.toLowerCase()} template` }),
    extra: { href: "https://ckm.openehr.org/ckm/", text: "Browse archetypes in the openEHR CKM", external: true },
  },
  template: {
    title: "Template: archetypes combined for one use",
    text: [
      "A template puts archetypes together for one purpose, such as a vital signs chart or an IPS section. It can leave out what is not needed, rename items and narrow the allowed values.",
      "Systems use the exported Operational Template (OPT). The template explorer opens an OPT and shows its tree, data types, coded values and terminology bindings. It holds no patient data.",
    ],
    links: (ex) => ({ href: `#sample=${encodeURIComponent(ex.template)}`, text: `Explore the ${ex.title.toLowerCase()} template` }),
    extra: { href: "#explore", text: "Open your own OPT in the template explorer" },
  },
  instance: {
    title: "Recorded data: an instance for one patient",
    text: [
      "When a clinician records something, the system stores it as an instance of the template: real values for one patient, at one time, by one person.",
      "Each recorded item keeps its archetype path, and coded values keep their codes. That is what lets the meaning travel on. The clinical scenarios show recorded instances.",
    ],
    links: (ex) => ({ href: `#example=${ex.id}`, text: `Scenario ${ex.scenario.number}: ${ex.title}` }),
  },
  snomed: {
    title: "SNOMED CT: the meaning, from recording to exchange",
    text: [
      "SNOMED CT is the clinical terminology that keeps the meaning of the data the same in every step. Archetypes bind their items and values to SNOMED CT concepts, recorded values can carry SNOMED CT codes, and the FHIR message sends them as codings.",
      "Where a step has no SNOMED CT code, for example free text or a local code without a binding, the meaning has to be added by a mapping decision or is weakened. Each scenario shows where that happens.",
    ],
    links: (ex) => ({ href: `#example=${ex.id}`, text: `Follow the SNOMED CT codes in ${ex.title.toLowerCase()}` }),
    extra: { href: "https://browser.ihtsdotools.org/", text: "Look up concepts in the SNOMED CT browser", external: true },
  },
  fhir: {
    title: "FHIR message: the same data, sent on",
    text: [
      "To share the data with another system, it is turned into FHIR resources (here Observation, Condition and AllergyIntolerance). The FHIR profile sets the structure and, for some elements, which codes must be present.",
      "SNOMED CT carries the clinical meaning from the record into the message. Each scenario shows, item by item, what is kept, translated, decided by the mapping, or lost.",
    ],
    links: (ex) => ({ href: `#example=${ex.id}`, text: `${ex.title}: sent as ${ex.fhirTitle}` }),
  },
};

function flowStepInfo(step) {
  const s = FLOW_STEPS[step];
  const a = ({ href, text, external }) =>
    h("a", { href, onclick: closeInfo, ...(external ? { target: "_blank", rel: "noopener" } : {}) }, text);
  return [
    s.text.map((t) => h("p", t)),
    h("ul.flow-step-links", EXAMPLES.map((ex) => h("li", a(s.links(ex)))), s.extra && h("li", a(s.extra))),
  ];
}

/** The scenarios home: what the scenarios are, before diving into one. */
export function showScenarios() {
  $("#scenarios-home").hidden = false;
  $("#scenario-detail").hidden = true;
  fill(
    $("#scenario-cards"),
    EXAMPLES.map((ex) => {
      const count = h("span.sc-count");
      loadTemplate(ex.template).then((t) => {
        if (!t) return;
        const n = t.nodes.filter((x) => x.kind === "archetype_root").length - 1;
        count.textContent = ` · ${n} archetype${n === 1 ? "" : "s"} inside`;
      });
      return h(
        "article.scenario-card",
        h("div.sc-head", scenarioIcon(ex), h("div", h("p.sc-number", `Scenario ${ex.scenario.number}`), h("h3", ex.title))),
        h("p.sc-summary", ex.scenario.summary),
        h("p.sc-meta", ex.scenario.setting),
        h(
          "ol.sc-steps",
          h(
            "li.sc-step.step-def",
            h("span.sc-step-kind", "① The definition"),
            h("span.sc-step-what", "Template ", templateLabel(ex), count),
            h("a.btn.sc-open", { href: `#sample=${encodeURIComponent(ex.template)}` }, "Explore the template"),
          ),
          h(
            "li.sc-step.step-inst",
            h("span.sc-step-kind", "② The recorded data"),
            h("span.sc-step-what", `Recorded by ${ex.scenario.recordedBy.toLowerCase()}, then sent as ${ex.fhirTitle}`),
            h("a.btn.primary.sc-open", { href: `#example=${ex.id}` }, "Follow the recorded data →"),
          ),
        ),
      );
    }),
  );
  window.scrollTo(0, 0);
}

/** For the template explorer: which scenario uses this template file? */
export function scenarioForTemplate(file) {
  return EXAMPLES.find((e) => e.template === file) || null;
}

function templateLabel(ex) {
  const src = ex.sources.find((x) => x.role === "openEHR template");
  const m = src?.text.match(/“([^”]+)”/);
  return m ? `“${m[1]}”` : ex.template;
}

export function showExample(id) {
  $("#scenarios-home").hidden = true;
  $("#scenario-detail").hidden = false;
  const raw = EXAMPLES.find((e) => e.id === id) || EXAMPLES[0];
  current = prepare(raw);
  filter = null;
  selected = current.links[0].id;
  if (!location.hash.includes(`example=${current.id}`)) history.replaceState(null, "", `#example=${current.id}`);

  const idx = EXAMPLES.findIndex((e) => e.id === current.id);
  const next = EXAMPLES[(idx + 1) % EXAMPLES.length];
  fill($("#scenario-title"), scenarioIcon(current), h("span.sc-number", `Scenario ${current.scenario.number} of ${EXAMPLES.length}`), " ", current.title);
  const nextLink = $("#next-scenario");
  nextLink.href = `#example=${next.id}`;
  nextLink.textContent = `Next scenario: ${next.title} →`;
  renderBanner();
  fill(
    $("#example-sources"),
    current.sources.map((src) =>
      h(
        "li",
        h("span.src-role", src.role),
        h("span.src-text", src.text, src.url ? [" ", h("a", { href: src.url, target: "_blank", rel: "noopener noreferrer" }, linkLabel(src.url))] : null),
      ),
    ),
  );
  fill($("#example-points"), ...current.points.map((p) => h("li", p)));
  fill($("#openehr-json"), renderJson(current.openehrJson, invert(current.openehrPointers), (id) => select(id, true)));
  fill($("#fhir-json"), renderJson(current.fhirJson, invert(current.fhirPointers), (id) => select(id, true)));
  currentTemplate = null;
  closeInfo();
  renderSummary();
  renderHead();
  renderRows();
  renderConcepts();
  renderJsonSelected();
  highlight(false);
  loadTemplate(current.template).then((t) => {
    if (!t || current.template !== raw.template) return;
    currentTemplate = t;
    renderBanner();
    renderRows();
  });
}

function linkLabel(url) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function loadTemplate(file) {
  if (!templateCache.has(file)) {
    templateCache.set(
      file,
      fetch(`samples/${encodeURIComponent(file)}`)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((xml) => parseOpt(xml))
        .catch(() => {
          templateCache.delete(file);
          return null;
        }),
    );
  }
  return templateCache.get(file);
}

// ------------------------------------------------------------------ template context

const RM_WORD = { COMPOSITION: "composition", SECTION: "section" };

/** Archetypes in the template, in tree order, with what the example uses. */
function archetypeRoots() {
  if (!currentTemplate) return [];
  const used = new Set(current.links.map((l) => l.openehr.archetype));
  return currentTemplate.nodes
    .filter((n) => n.kind === "archetype_root")
    .map((n) => {
      const parent = n.parentId ? currentTemplate.nodes.find((x) => x.id === n.parentId) : null;
      const parentRoot = parent ? currentTemplate.nodes.find((x) => x.id === parent.archetypeRootRef) : null;
      return { node: n, id: n.archetypeId, rm: n.rmType, name: n.name, used: used.has(n.archetypeId), parent: parentRoot };
    });
}

/** Compact "Recorded data" banner; the details live behind an info icon. */
function renderBanner() {
  fill(
    $("#instance-banner"),
    h("span.instance-tag", "Recorded data"),
    h("div.banner-body", h("p.banner-story", current.story)),
    infoButton("About this record", recordInfo, "About this record and its template"),
  );
}

function recordInfo() {
  const t = currentTemplate;
  const roots = archetypeRoots();
  const top = roots[0];
  const inside = roots.slice(1);
  const usedInside = inside.filter((r) => r.used);
  return [
    h("p", "This is ", h("strong", "recorded data"), ": one instance, for one (fictional) patient."),
    h(
      "dl.info-dl",
      h("dt", "Setting"),
      h("dd", current.scenario.setting),
      h("dt", "Recorded by"),
      h("dd", `${current.scenario.recordedBy}, ${current.scenario.when}`),
      h("dt", "Template"),
      h("dd", templateLabel(current), " ", h("a", { href: `#sample=${encodeURIComponent(current.template)}` }, "See the full template (the definition)")),
      t && top
        ? [
            h("dt", "Archetypes"),
            h(
              "dd",
              `The template defines a ${top.rm} that contains ${inside.length} archetype${inside.length === 1 ? "" : "s"}${reused(inside)}.`,
              usedInside.length < inside.length ? ` This scenario uses ${usedInside.length} of them.` : "",
            ),
          ]
        : null,
    ),
    t && top?.rm === "SECTION" ? h("p.muted", "A section template: in practice it is placed inside a composition, such as an International Patient Summary.") : null,
    t && top
      ? h(
          "ul.ctx-archetypes-list",
          h("li", rmBadge(top.rm), " ", h("span", top.name), h("code.small", top.id)),
          inside.map((r) =>
            h(
              "li" + (r.used ? ".used" : ".unused") + (r.parent && r.parent.archetypeId !== top.id ? ".nested" : ""),
              rmBadge(r.rm),
              " ",
              h("span", r.name),
              r.used ? null : h("span.ctx-tag", "not in this scenario"),
              h("code.small", r.id),
            ),
          ),
        )
      : null,
    templateSourceLine(),
  ];
}

/** " (clinical_evidence.v1 is used twice)" when the template reuses an archetype. */
function reused(roots) {
  const count = new Map();
  for (const r of roots) count.set(r.id, (count.get(r.id) || 0) + 1);
  const words = { 2: "twice", 3: "three times" };
  const dups = [...count].filter(([, n]) => n > 1).map(([id, n]) => `${id.replace(/^openEHR-EHR-[A-Z_]+\./, "")} is used ${words[n] || n + " times"}`);
  return dups.length ? ` (${dups.join(", ")})` : "";
}

function templateSourceLine() {
  const src = current.sources.find((x) => x.role === "openEHR template");
  if (!src) return null;
  return h("p.ctx-line.ctx-source", "Source: ", src.url ? h("a", { href: src.url, target: "_blank", rel: "noopener noreferrer" }, src.text) : src.text);
}

function rmBadge(rm) {
  return h("span.rm-badge", rm);
}

// ------------------------------------------------------------------ summary + list

function renderSummary() {
  const counts = Object.fromEntries(Object.keys(OUTCOMES).map((k) => [k, 0]));
  for (const l of current.links) counts[outcomeOf(l)]++;
  fill($("#outcome-summary"), 
    h("span.summary-lead", `${current.links.length} items:`),
    ...Object.entries(OUTCOMES)
      .filter(([k]) => counts[k])
      .map(([k, o]) =>
        h(
          "button.outcome-chip.o-" + k,
          {
            type: "button",
            "aria-pressed": String(filter === k),
            title: filter === k ? "Show all items" : `Show only: ${o.label}`,
            onclick: () => {
              filter = filter === k ? null : k;
              const vis = visibleLinks();
              if (!vis.some((l) => l.id === selected)) selected = vis[0]?.id ?? null;
              renderSummary();
              renderRows();
              renderJsonSelected();
              highlight(false);
            },
          },
          h("span.o-icon", { "aria-hidden": "true" }, o.icon),
          h("strong", counts[k]),
          " ",
          o.label.toLowerCase(),
        ),
      ),
    ...(filter ? [h("button.linklike", { type: "button", onclick: () => { filter = null; renderSummary(); renderRows(); } }, "Show all")] : []),
    infoButton("How meaning can travel", legendInfo, "What the four outcomes mean"),
  );
}

/** Links in template order, grouped by the archetype they belong to. */
function groupedLinks() {
  const vis = visibleLinks();
  const roots = archetypeRoots();
  const order = roots.length ? roots.map((r) => r.id) : [...new Set(current.links.map((l) => l.openehr.archetype))];
  const groups = [];
  for (const id of order) {
    const items = vis.filter((l) => l.openehr.archetype === id);
    if (!items.length || groups.some((g) => g.id === id)) continue;
    const r = roots.find((x) => x.id === id);
    groups.push({ id, items, rm: r?.rm || id.split("-")[2]?.split(".")[0], name: r?.name || items[0].group, parent: r?.parent, isTop: r === roots[0] });
  }
  return groups;
}

const COLUMNS = {
  openehr: { title: "Recorded in openEHR", sub: "the EHR", dot: "d-openehr" },
  sct: { title: "Meaning in SNOMED CT", sub: "what it means", dot: "d-sct" },
  fhir: { title: "Sent in FHIR", sub: "the message", dot: "d-fhir" },
};

function renderHead() {
  const col = (key, info) =>
    h(
      "div.sxs-col-head.h-" + key,
      h("span.dot." + COLUMNS[key].dot),
      h("div", h("strong", COLUMNS[key].title), h("span.col-sub", COLUMNS[key].sub)),
      infoButton(COLUMNS[key].title, info),
    );
  fill(
    $("#sxs-head"),
    col("openehr", () => [
      h("p", "Each row is one item the clinician recorded, grouped by the archetype it comes from. The value is shown as it is stored."),
      h("p", "Local codes (at-codes) only mean something inside their own archetype. Where the template uses a SNOMED CT value set, the SNOMED CT code itself is stored."),
      h("p.muted", `Full JSON: ${current.openehrTitle}. Language, encoding and most archetype details are left out for readability.`),
    ]),
    h("div.sxs-arrow-head", { "aria-hidden": "true" }),
    col("sct", () => [
      h("p", "The SNOMED CT concept that carries the item's meaning, and where it comes from: the archetype's binding, the recorded value, or a choice made by the mapping."),
      h("p", "Each concept is checked live on the terminology server (", h("code", readServer()), "). You can change the server at the bottom of the page."),
    ]),
    h("div.sxs-arrow-head", { "aria-hidden": "true" }),
    col("fhir", () => [
      h("p", `What arrives in the FHIR message (${current.fhirTitle}): the value, the FHIR element it goes into, and any other codes the message carries, such as a LOINC code a profile requires or one of FHIR's own codes.`),
      h("p.muted", "FHIR R4. The mapping is written by hand for teaching: openEHR has no single standard mapping to FHIR. Real projects use mapping engines and agreed mapping specifications."),
    ]),
  );
}

function legendInfo() {
  return h(
    "ul.legend-list",
    Object.entries(OUTCOMES).map(([k, o]) =>
      h(
        "li",
        h("span.o-icon.o-" + k, { "aria-hidden": "true" }, o.icon),
        h(
          "div",
          h("strong", o.label),
          h("ul", Object.entries(HOW).filter(([, v]) => v.outcome === k).map(([, v]) => h("li", v.reason))),
        ),
      ),
    ),
  );
}

function renderRows() {
  const out = [];
  const top = archetypeRoots()[0];
  for (const g of groupedLinks()) {
    const nested = g.parent && !g.isTop && top && g.parent.archetypeId !== top.id;
    out.push(
      h(
        "div.sxs-group" + (nested ? ".nested" : ""),
        { role: "presentation", title: g.id },
        rmBadge(g.rm),
        " ",
        h("span", g.name),
        g.isTop ? h("span.group-note", " (the template's root)") : null,
        nested ? h("span.group-note", ` inside ${g.parent.name}`) : null,
      ),
    );
    for (const l of g.items) out.push(row(l));
  }
  if (!out.length) out.push(h("p.muted", "No items match this filter."));
  fill($("#sxs-rows"), ...out);
}

/** One recorded item across the three columns. */
function row(l) {
  const k = outcomeOf(l);
  const notUsed = (t) => t.source === "possible, not recorded";
  const sct = l.terms.filter((t) => t.system === "SNOMED CT" && !notUsed(t));
  const other = l.terms.filter((t) => t.system !== "SNOMED CT" && !notUsed(t));
  const couldHave = l.terms.filter(notUsed);
  const fhirPtrs = current.fhirPointers.get(l.id) || [];
  const isSel = l.id === selected;

  const stored = l.openehr.localCode
    ? ["local code ", h("code", l.openehr.localCode)]
    : l.how === "coded"
      ? "SNOMED CT code recorded"
      : l.how === "text"
        ? "free text"
        : l.how === "context"
          ? "not recorded: from the context"
          : null;

  const sctCell = sct.length
    ? sct.map((t) => miniConcept(t))
    : l.how === "direct"
      ? h("span.c-none", "not needed")
      : l.how === "text"
        ? h("span.c-none.bad", "no SNOMED CT code")
        : other.some((t) => t.system === "FHIR")
          ? h("span.c-none", "none: FHIR's own code instead")
          : h("span.c-none", "none");

  return h(
    "div.sxs-row.o-" + k + (isSel ? ".selected" : ""),
    {
      role: "option",
      tabindex: isSel ? "0" : "-1",
      "aria-selected": String(isSel),
      "data-id": l.id,
      "data-links": l.id,
      onclick: (e) => {
        if (e.target.closest("a, button")) return;
        select(l.id);
      },
    },
    h(
      "div.c-cell.c-openehr",
      { "data-col": "openEHR" },
      h(
        "div.c-head",
        h("span.o-icon", { title: OUTCOMES[k].label, "aria-label": OUTCOMES[k].label }, OUTCOMES[k].icon),
        h("span.c-label", l.label),
        infoButton(`${l.label}: ${OUTCOMES[k].label.toLowerCase()}`, () => itemInfo(l), `Explain how “${l.label}” travels`),
      ),
      h("div.c-value", plainValue(l.value)),
      stored ? h("div.c-note", stored) : null,
    ),
    h("div.c-arrow", { "aria-hidden": "true" }, "→"),
    h(
      "div.c-cell.c-sct",
      { "data-col": "SNOMED CT" },
      sctCell,
      couldHave.length ? h("div.c-could", h("span.c-could-label", "could have been used:"), couldHave.map((t) => miniConcept(t, true))) : null,
    ),
    h("div.c-arrow", { "aria-hidden": "true" }, "→"),
    h(
      "div.c-cell.c-fhir",
      { "data-col": "FHIR" },
      l.fhir
        ? [
            h("div.c-value", sentValue(l, fhirPtrs)),
            h("code.c-el", l.fhir),
            other.length ? h("div.c-codes", other.map((t) => miniConcept(t))) : null,
            l.how === "text" && sentAsTextOnly(l) ? h("div.c-note.bad", "text only, no code") : null,
            l.how === "text" && !sentAsTextOnly(l) ? h("div.c-note.bad", "code guessed from text") : null,
          ]
        : h("div.c-value.bad", "Not sent"),
    ),
  );
}

/** A compact code chip; SNOMED CT ones get a live active/inactive check. */
function miniConcept(t, notUsed = false) {
  const cls = t.system === "SNOMED CT" ? "sct" : t.system === "LOINC" ? "loinc" : "other";
  const status = h("span.mini-live");
  const el = h(
    "span.mini" + (notUsed ? ".not-used" : ""),
    h("span.pill." + cls, t.system === "SNOMED CT" ? "SCT" : t.system, " ", codeLink(t)),
    " ",
    h("span.mini-name", t.system === "FHIR" ? `(${t.display})` : t.display),
    t.system === "SNOMED CT" ? status : null,
  );
  if (t.system === "SNOMED CT") lookup(t.code, status, true);
  return el;
}

/** "Sitting (local at1001)" -> "Sitting": keep technical codes out of the list. */
function plainValue(v) {
  return String(v).replace(/\s*\((local|SNOMED CT|DV_PROPORTION)[^)]*\)/g, "").replace(/^"(.*)" \(free text\)$/, "“$1”");
}

function select(id, fromJson) {
  selected = id;
  if (filter && !visibleLinks().some((l) => l.id === id)) {
    filter = null;
    renderSummary();
    renderRows();
  }
  for (const r of document.querySelectorAll("#sxs-rows .sxs-row")) {
    const on = r.dataset.id === id;
    r.classList.toggle("selected", on);
    r.setAttribute("aria-selected", String(on));
    r.tabIndex = on ? 0 : -1;
  }
  renderJsonSelected();
  highlight(true);
  if (!fromJson) return;
  const r = document.querySelector(`#sxs-rows [data-id="${CSS.escape(id)}"]`);
  if (r && !$("#sxs-rows").hidden) r.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/** In JSON mode, name the selected item above the panes. */
function renderJsonSelected() {
  const l = current?.links.find((x) => x.id === selected);
  if (!l) return fill($("#json-selected"), h("span.muted", "Click a highlighted part of the JSON to select an item."));
  const k = outcomeOf(l);
  fill(
    $("#json-selected"),
    h("span.muted", "Selected: "),
    h("span.o-icon.o-" + k, { "aria-hidden": "true" }, OUTCOMES[k].icon),
    h("strong", l.label),
    h("span.muted", ` · ${OUTCOMES[k].label.toLowerCase()}`),
    infoButton(`${l.label}: ${OUTCOMES[k].label.toLowerCase()}`, () => itemInfo(l), `Explain how “${l.label}” travels`),
    h("span.muted.json-hint", "Click any highlighted part of the JSON to select another item."),
  );
}

// ------------------------------------------------------------------ journey (the selected item)

/** "the Blood pressure archetype (blood_pressure.v2)" */
function archetypeName(id) {
  const short = id.replace(/^openEHR-EHR-[A-Z_]+\./, "");
  const r = archetypeRoots().find((x) => x.id === id);
  return r ? `the ${r.name} archetype (${short})` : `the ${short} archetype`;
}

function templateName() {
  return `the “${currentTemplate?.templateId || current.template.replace(/\.opt$/, "")}” template`;
}

const codeList = (terms) => terms.map((t) => `${t.system} ${t.code} “${t.display}”`).join(" and ");

/** The verdict sentence for one item, naming the archetype, item and template involved. */
function reasonFor(l) {
  const item = `“${l.label}”`;
  const arch = archetypeName(l.openehr.archetype);
  const bound = l.terms.filter((t) => t.source === "archetype binding");
  const fhirOnly = l.terms.filter((t) => t.source === "FHIR profile");
  switch (l.how) {
    case "bound":
      return (
        `${cap(arch)} binds ${item} to ${codeList(bound)}, so ${bound.length > 1 ? "these codes go" : "this code goes"} into the FHIR message unchanged.` +
        (fhirOnly.length ? ` The FHIR profile also requires the coding ${codeList(fhirOnly)} (a profile constraint, not a binding). The archetype does not provide it, so the mapping adds it.` : "")
      );
    case "coded":
      return `${cap(templateName())} only accepts SNOMED CT codes for ${item}, from the same value set the FHIR IPS profile prefers. The recorded code is sent unchanged.`;
    case "direct":
      return `${item} has the same kind of value in openEHR and in FHIR, so it is copied across as it is.`;
    case "context":
      return `Nobody records ${item} as data. FHIR needs it, so the mapping fills it in from ${l.openehr.path === null ? "the patient's EHR that holds this record" : templateName()}.`;
    case "fhir-code":
      return `${cap(arch)} records ${item} with local codes (at-codes). FHIR requires its own codes for this element (a required binding), so a small, fixed lookup table translates each local code.`;
    case "mapped":
      if (l.openehr.localCode) {
        return `${cap(arch)} uses local codes (at-codes) for ${item}, with no SNOMED CT binding. A local code such as ${l.openehr.localCode} means nothing outside this archetype, so it can't be sent as it is. ${bindingClause(l.fhirBinding)} Someone had to choose the SNOMED CT concept, and another system could choose a different one.`;
      }
      if (l.fhirBinding?.strength === "required-coding") {
        return `${cap(arch)} has no terminology binding for ${item}. The FHIR profile requires a specific LOINC coding here (a profile constraint), so that part is decided by FHIR. The SNOMED CT code is optional and was chosen by the mapping; another system could choose a different one or leave it out.`;
      }
      return `${cap(arch)} has no terminology binding for ${item}. ${bindingClause(l.fhirBinding)} The mapping supplies the codes, and another system could choose different ones.`;
    case "text":
      return `${cap(templateName())} only allows free text for ${item}, so the record holds just the words, with no SNOMED CT code. ${
        l.fhirBinding?.strength === "required" ? "FHIR requires one of its own codes here, so the words have to be interpreted." : "The FHIR message can pass on the words, but not a reliable code."
      }`;
    case "none":
      return `FHIR ${fhirResourceType()} has no standard element for ${item}. The value stays in the openEHR record and is not sent.`;
    default:
      return HOW[l.how].reason;
  }
}

function fhirResourceType() {
  const j = current.fhirJson;
  return j.resourceType === "Bundle" ? j.entry?.[0]?.resource?.resourceType || "Bundle" : j.resourceType;
}

/** FHIR binding strengths in plain words. */
export const STRENGTH = {
  "required-coding": {
    label: "Required coding",
    text:
      "This is not a terminology binding. The FHIR profile slices the element's codings and makes one slice mandatory, with its system and code given as fixed values (fixedUri / fixedCode). That exact LOINC coding must be present. The slicing is open, so other codings such as SNOMED CT may be sent alongside it.",
  },
  required: { label: "Required", text: "Only codes from this value set are allowed." },
  extensible: { label: "Extensible", text: "Codes from this value set must be used when one fits." },
  preferred: { label: "Preferred", text: "Codes from this value set are recommended, but other codes are allowed." },
  example: { label: "Example only", text: "The value set is only a suggestion: any code system is allowed." },
  none: { label: "No binding", text: "FHIR does not say which codes to use here." },
};

/** Why a SNOMED CT concept was needed, given the FHIR binding of the target element. */
function bindingClause(b) {
  switch (b?.strength) {
    case "none":
      return "FHIR itself does not require SNOMED CT here: the FHIR element has no terminology binding. SNOMED CT is used because it is the shared clinical terminology the receiver can understand.";
    case "example":
      return "FHIR only suggests SNOMED CT here (an example binding), so using it is a convention, not a FHIR rule.";
    case "preferred":
      return "FHIR recommends SNOMED CT here (a preferred binding), but does not require it.";
    case "required":
    case "extensible":
      return `FHIR requires its own codes here (${b.strength} binding).`;
    default:
      return "";
  }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** What the openEHR step says about how the value is stored. */
function storedNote(l) {
  const arch = archetypeName(l.openehr.archetype);
  if (l.openehr.localCode) return `Stored as the local code ${l.openehr.localCode}, which is defined only inside ${arch}.`;
  if (l.how === "coded") return `Stored with its SNOMED CT code. ${cap(templateName())} limits the choice to a value set.`;
  if (l.how === "text") return `Stored as free text: ${templateName()} offers no code list for this item.`;
  if (l.how === "context") return l.openehr.path === null ? "Not stored as an item: it is the patient whose EHR holds this record." : `Not stored as an item: it follows from ${templateName()}.`;
  return null;
}

/** Everything that explains one item: shown in its info popup. */
function itemInfo(l) {
  const k = HOW[l.how].outcome;
  const notUsed = (t) => t.source === "possible, not recorded";
  const couldHave = l.terms.filter(notUsed);
  const fhirPtrs = current.fhirPointers.get(l.id) || [];
  return [
    h("div.verdict.small.o-" + k, h("span.o-icon", { "aria-hidden": "true" }, OUTCOMES[k].icon), h("p", reasonFor(l))),
    storedNote(l) ? h("p", h("strong", "Recorded: "), storedNote(l)) : null,
    l.fhir && l.fhirBinding ? bindingLine(l.fhirBinding) : null,
    fhirTextNote(l, fhirPtrs),
    couldHave.length
      ? h("p", h("strong", "Could have been used: "), codeList(couldHave), ". It is not in the record and not sent; the template would need to offer a coded list here.")
      : null,
    l.note ? h("div.why.o-" + k, h("h4", "Why this matters"), h("p", l.note)) : null,
    h(
      "details.tech",
      h("summary", "Technical details"),
      h(
        "dl",
        h("dt", "Archetype"),
        h("dd", h("code", l.openehr.archetype)),
        h("dt", "Path in archetype"),
        h("dd", h("code", l.openehr.path ?? l.openehr.rm)),
        h("dt", "FHIR element"),
        h("dd", h("code", l.fhir ?? "–")),
        l.terms.length ? [h("dt", "Codes"), h("dd", l.terms.map((t) => h("div", `${t.system} ${t.code} – ${t.display} (${t.source})`)))] : null,
      ),
      snippet(current.openehrJson, current.openehrPointers.get(l.id), "openEHR"),
      fhirPtrs.length ? snippet(current.fhirJson, fhirPtrs, "FHIR") : null,
      l.openehr.path !== null
        ? h("button.btn.small", { type: "button", onclick: () => openInExplorer(current.template, l.openehr.archetype, l.openehr.path) }, "Open this node in the template explorer")
        : null,
    ),
  ];
}

/** True when FHIR receives only text (a CodeableConcept with text and no coding). */
function sentAsTextOnly(l) {
  const pointers = current.fhirPointers.get(l.id) || [];
  if (l.how !== "text" || !pointers.length) return false;
  return pointers.every((p) => {
    const v = resolvePointer(current.fhirJson, p);
    return v && typeof v === "object" && !Array.isArray(v) && !v.coding;
  });
}

/** The value FHIR carries; free text that is sent without a code is shown in quotes. */
function sentValue(l, pointers) {
  const v = fhirSummary(pointers) || "–";
  return sentAsTextOnly(l) ? `“${v}”` : v;
}

function bindingLine(b) {
  const st = STRENGTH[b.strength] || { label: b.strength, text: "" };
  const isSlice = b.strength === "required-coding";
  return h(
    "div.binding-line",
    h("span.binding-label", isSlice ? "FHIR profile constraint: " : "FHIR binding: "),
    h("span.strength.st-" + b.strength, { title: st.text }, st.label),
    h("p.step-note", b.url ? h("a", { href: b.url, target: "_blank", rel: "noopener noreferrer" }, b.name) : b.name, b.strength === "none" ? "." : `. ${st.text}`),
    b.slice ? h("p.step-note", "Defined in the profile as the slice ", h("code", b.slice), ".") : null,
    isSlice
      ? h(
          "p.step-note",
          "Which LOINC code goes with the archetype item is decided by whoever writes the mapping (here, by hand). Neither FHIR nor openEHR derives it from the SNOMED CT code. Resources such as the LOINC Ontology, a SNOMED CT extension published with Regenstrief, can help check such pairings, but nothing applies them automatically.",
        )
      : null,
  );
}

/** For free-text items: say plainly whether FHIR gets only text, or a code guessed from the text. */
function fhirTextNote(l, pointers) {
  if (l.how !== "text") return null;
  return sentAsTextOnly(l)
    ? h("p.no-code", h("strong", "Sent as unstructured text, with no code."), " SNOMED CT is not used in the message.")
    : h("p.no-code", h("strong", "Sent as a code, but only by interpreting the free text."), " A different spelling or wording could map wrongly or not at all.");
}

/** Plain-language summary of what the FHIR side carries: "148 mmHg", "Sitting position", "high". */
function fhirSummary(pointers) {
  const parts = [];
  for (const p of pointers) {
    const v = resolvePointer(current.fhirJson, p);
    const s = summarise(v);
    if (s && !parts.includes(s)) parts.push(s);
  }
  return parts.join(" · ");
}

function summarise(v) {
  if (v == null) return "";
  if (typeof v !== "object") return String(v);
  if (Array.isArray(v)) return v.map(summarise).filter(Boolean).join(", ");
  if ("value" in v && "unit" in v) return `${v.value} ${v.unit}`;
  if (v.valueQuantity) return summarise(v.valueQuantity);
  if (v.valueCodeableConcept) return summarise(v.valueCodeableConcept);
  if (v.reference) return v.reference;
  if (v.coding) {
    const d = v.coding.map((c) => c.display || c.code);
    const main = d.find((x, i) => v.coding[i].system === "http://snomed.info/sct") || d[0];
    return main || v.text || "";
  }
  if (v.text) return v.text;
  if (v.manifestation) return `reaction: ${summarise(v.manifestation)}`;
  return "";
}

/** A small, focused piece of JSON: just the parts this item maps to. */
function snippet(json, pointers, label) {
  if (!pointers?.length) return null;
  const parts = pointers.map((p) => {
    let value = resolvePointer(json, p);
    const key = p.split("/").pop();
    if (value === null || typeof value !== "object") value = { [key]: value };
    else if (!/^\d+$/.test(key) && key) value = { [key]: trim(value) };
    else value = trim(value);
    return renderJson(value, new Map(), () => {});
  });
  return h("details.snippet", h("summary", `Show the ${label} JSON`), parts);
}

/** Shorten big containers (an OBSERVATION, a SECTION) so the snippet stays readable. */
function trim(v, depth = 0) {
  if (Array.isArray(v)) return depth > 3 ? ["…"] : v.map((x) => trim(x, depth + 1));
  if (v && typeof v === "object") {
    if (depth > 0 && v._type && !/^(ELEMENT|DV_|CODE_PHRASE|TERMINOLOGY_ID|TERM_MAPPING|PARTY_SELF)/.test(v._type)) {
      return { _type: v._type, archetype_node_id: v.archetype_node_id, "…": "…" };
    }
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = trim(x, depth + 1);
    return out;
  }
  return v;
}

// ------------------------------------------------------------------ full records (below)

function renderConcepts() {
  if (!current) return;
  const byKey = new Map();
  for (const l of current.links) {
    for (const t of l.terms) {
      const key = `${t.system}|${t.code}`;
      if (!byKey.has(key)) byKey.set(key, { ...t, links: [] });
      byKey.get(key).links.push(l);
    }
  }
  const order = { "SNOMED CT": 0, LOINC: 1, FHIR: 2 };
  const items = [...byKey.values()].sort((a, b) => (order[a.system] ?? 9) - (order[b.system] ?? 9));
  fill($("#concepts"), 
    ...items.map((t) => {
      const cls = t.system === "SNOMED CT" ? "sct" : t.system === "LOINC" ? "loinc" : "other";
      const live = h("div.live");
      const card = h(
        "div.concept",
        { "data-links": t.links.map((l) => l.id).join(" "), onclick: () => select(t.links[0].id, true) },
        h("div.concept-head", h("span.pill." + cls, t.system === "SNOMED CT" ? "SCT" : t.system), " ", codeLink(t)),
        h("div.concept-name", t.display),
        live,
        t.source === "possible, not recorded"
          ? h("div.concept-uses", "Not used: could have coded ", t.links.map((l) => l.label).join(", "), ", which was recorded as free text")
          : h("div.concept-uses", "Used for: ", t.links.map((l) => l.label).join(", ")),
      );
      if (t.system === "SNOMED CT") lookup(t.code, live);
      return card;
    }),
  );
  highlight(false);
}

function highlight(scroll) {
  for (const el of document.querySelectorAll("#sxs-json .hl")) el.classList.remove("hl");
  if (!selected) return;
  const sel = `[data-links~="${CSS.escape(selected)}"]`;
  const jsonOn = !$("#sxs-json").hidden;
  for (const pane of ["#openehr-json", "#fhir-json", "#concepts"]) {
    const els = document.querySelectorAll(`${pane} ${sel}`);
    for (const el of els) el.classList.add("hl");
    if (scroll && jsonOn && els[0]) scrollWithin($(pane), els[0]);
  }
}

function scrollWithin(container, el, offset = 12) {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top < c.top + offset || r.bottom > c.bottom) container.scrollTop += r.top - c.top - offset;
}

function codeLink(t) {
  let href = null;
  if (t.system === "SNOMED CT") href = `https://browser.ihtsdotools.org/?perspective=full&conceptId1=${t.code}&edition=MAIN&languages=en`;
  if (t.system === "LOINC") href = `https://loinc.org/${t.code}/`;
  const code = h("code", t.code);
  return href
    ? h("a", { href, target: "_blank", rel: "noopener noreferrer", title: `Open ${t.code} in the ${t.system} browser`, onclick: (e) => e.stopPropagation() }, code)
    : code;
}

async function lookup(code, target, compact = false) {
  const server = readServer().replace(/\/+$/, "");
  const key = `${server}|${code}`;
  fill(target, compact ? null : h("span.muted", "Checking terminology server…"));
  try {
    if (!lookupCache.has(key)) {
      lookupCache.set(
        key,
        fetch(`${server}/CodeSystem/$lookup?system=http://snomed.info/sct&code=${encodeURIComponent(code)}&property=inactive`, {
          headers: { Accept: "application/fhir+json" },
        }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
      );
    }
    const p = await lookupCache.get(key);
    const params = p.parameter || [];
    const fsn = params
      .filter((x) => x.name === "designation" && x.part?.some((pp) => pp.valueCoding?.code === "900000000000003001"))
      .flatMap((x) => x.part.filter((pp) => pp.name === "value").map((pp) => pp.valueString))[0];
    const inactiveProp = params
      .filter((x) => x.name === "property" && x.part?.some((pp) => pp.valueCode === "inactive"))
      .flatMap((x) => x.part.filter((pp) => pp.name === "value"))[0];
    const version = params.find((x) => x.name === "version")?.valueString || "";
    const edition = (version.match(/version\/(\d{8})/) || [])[1];
    const inactive = inactiveProp?.valueBoolean === true;
    if (compact) {
      fill(target, inactiveProp ? h("span.flag." + (inactive ? "unbound" : "ok"), { title: `${fsn || ""}${edition ? ` · edition ${edition}` : ""}` }, inactive ? "inactive" : "active") : null);
      return;
    }
    fill(target, 
      h("span.fsn", fsn || params.find((x) => x.name === "display")?.valueString || ""),
      " ",
      inactiveProp ? h("span.flag." + (inactive ? "unbound" : "ok"), inactive ? "inactive" : "active") : null,
      edition ? h("span.muted.edition", ` · edition ${edition.slice(0, 4)}-${edition.slice(4, 6)}-${edition.slice(6)}`) : null,
    );
  } catch (e) {
    lookupCache.delete(key);
    fill(target, compact ? h("span.muted", { title: `Terminology server not reachable (${e.message})` }, "?") : h("span.muted", `Terminology server not reachable (${e.message}).`));
  }
}
