// "Worked examples" mode: follow one item at a time from openEHR (recorded),
// through SNOMED CT (meaning), to FHIR (sent).
import { EXAMPLES, prepare, resolvePointer } from "./examples/index.js";
import { renderJson, invert } from "./json-view.js";

const $ = (sel) => document.querySelector(sel);

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

let current = null; // prepared example
let selected = null; // link id
let filter = null; // outcome key
let openInExplorer = () => {};

export function initExamples(opts) {
  openInExplorer = opts.openInExplorer;
  $("#example-tabs").replaceChildren(
    ...EXAMPLES.map((ex) =>
      h("button", { type: "button", role: "tab", "data-id": ex.id, onclick: () => showExample(ex.id) }, h("strong", ex.title), h("span", ex.fhirTitle)),
    ),
  );
  const input = $("#tx-server");
  input.value = readServer();
  $("#tx-form").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      localStorage.setItem("txServer", input.value.trim());
    } catch {}
    lookupCache.clear();
    renderJourney();
    renderConcepts();
  });
  $("#tx-reset").addEventListener("click", () => {
    input.value = DEFAULT_SERVER;
    try {
      localStorage.removeItem("txServer");
    } catch {}
    lookupCache.clear();
    renderJourney();
    renderConcepts();
  });
  $("#item-list").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = visibleLinks();
    const i = items.findIndex((l) => l.id === selected);
    const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      select(next.id);
      document.querySelector(`#item-list [data-id="${CSS.escape(next.id)}"]`)?.focus();
    }
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

export function showExample(id) {
  const raw = EXAMPLES.find((e) => e.id === id) || EXAMPLES[0];
  current = prepare(raw);
  filter = null;
  selected = current.links[0].id;
  for (const b of document.querySelectorAll("#example-tabs button")) b.setAttribute("aria-selected", String(b.dataset.id === current.id));
  if (!location.hash.includes(`example=${current.id}`)) history.replaceState(null, "", `#example=${current.id}`);

  $("#example-story").textContent = current.story;
  $("#example-points").replaceChildren(...current.points.map((p) => h("li", p)));
  $("#openehr-title").textContent = current.openehrTitle;
  $("#fhir-title").textContent = current.fhirTitle;
  $("#openehr-json").replaceChildren(renderJson(current.openehrJson, invert(current.openehrPointers), (id) => select(id, true)));
  $("#fhir-json").replaceChildren(renderJson(current.fhirJson, invert(current.fhirPointers), (id) => select(id, true)));
  renderSummary();
  renderList();
  renderJourney();
  renderConcepts();
  highlight(false);
}

// ------------------------------------------------------------------ summary + list

function renderSummary() {
  const counts = Object.fromEntries(Object.keys(OUTCOMES).map((k) => [k, 0]));
  for (const l of current.links) counts[outcomeOf(l)]++;
  $("#outcome-summary").replaceChildren(
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
              renderList();
              renderJourney();
              highlight(false);
            },
          },
          h("span.o-icon", { "aria-hidden": "true" }, o.icon),
          h("strong", counts[k]),
          " ",
          o.label.toLowerCase(),
        ),
      ),
    ...(filter ? [h("button.linklike", { type: "button", onclick: () => { filter = null; renderSummary(); renderList(); } }, "Show all")] : []),
  );
}

function renderList() {
  const out = [];
  let group = null;
  for (const l of visibleLinks()) {
    if (l.group !== group) {
      group = l.group;
      out.push(h("li.item-group", { role: "presentation" }, group));
    }
    const k = outcomeOf(l);
    out.push(
      h(
        "li",
        { role: "presentation" },
        h(
          "button.item.o-" + k,
          {
            type: "button",
            role: "option",
            "data-id": l.id,
            "aria-selected": String(l.id === selected),
            onclick: () => select(l.id),
          },
          h("span.o-icon", { title: OUTCOMES[k].label, "aria-label": OUTCOMES[k].label }, OUTCOMES[k].icon),
          h("span.item-text", h("span.item-label", l.label), h("span.item-value", plainValue(l.value))),
        ),
      ),
    );
  }
  $("#item-list").replaceChildren(...out);
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
  }
  renderList();
  renderJourney();
  highlight(true);
  if (fromJson) $("#journey").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ------------------------------------------------------------------ journey (the selected item)

function renderJourney() {
  const box = $("#journey");
  const l = current.links.find((x) => x.id === selected);
  if (!l) return box.replaceChildren(h("p.muted", "No items match this filter."));
  const how = HOW[l.how];
  const k = how.outcome;
  const sct = l.terms.filter((t) => t.system === "SNOMED CT");
  const other = l.terms.filter((t) => t.system !== "SNOMED CT");

  const step1 = h(
    "div.step.s-openehr",
    h("div.step-head", h("span.step-no", "1"), h("div", h("h4", "Recorded in openEHR"), h("p.step-sub", "the EHR"))),
    h("p.step-value", plainValue(l.value)),
    l.openehr.localCode ? h("p.step-note", `Stored with the local code ${l.openehr.localCode}, which only has meaning inside this archetype.`) : null,
    l.how === "coded" ? h("p.step-note", "Stored with a SNOMED CT code, chosen from a value set the template defines.") : null,
    l.how === "text" ? h("p.step-note", "Stored as free text only.") : null,
    l.how === "context" ? h("p.step-note", "Nobody records this: it comes from the template or the record itself.") : null,
    snippet(current.openehrJson, current.openehrPointers.get(l.id), "openEHR"),
  );

  const step2 = h(
    "div.step.s-sct",
    h("div.step-head", h("span.step-no", "2"), h("div", h("h4", "Meaning in SNOMED CT"), h("p.step-sub", "what it means"))),
    sct.length
      ? sct.map((t) => conceptCard(t, true))
      : h("p.step-value.muted", l.how === "direct" ? "Not needed: a date or a group carries no coded meaning." : "No SNOMED CT concept for this item."),
    other.length ? h("div.other-codes", h("p.step-note", "Other codes involved:"), other.map((t) => conceptCard(t, false))) : null,
  );

  const fhirPtrs = current.fhirPointers.get(l.id) || [];
  const step3 = h(
    "div.step.s-fhir",
    h("div.step-head", h("span.step-no", "3"), h("div", h("h4", "Sent in FHIR"), h("p.step-sub", "the message"))),
    l.fhir ? [h("p.step-value", fhirSummary(fhirPtrs) || "–"), h("p.step-note", "as ", h("code", l.fhir))] : h("p.step-value", "Not sent"),
    fhirPtrs.length ? snippet(current.fhirJson, fhirPtrs, "FHIR") : null,
  );

  box.replaceChildren(
    h(
      "div.verdict.o-" + k,
      h("span.o-icon.big", { "aria-hidden": "true" }, OUTCOMES[k].icon),
      h("div", h("h3", `${l.label}: ${OUTCOMES[k].label.toLowerCase()}`), h("p", how.reason)),
    ),
    h("div.steps", step1, arrow(k), step2, arrow(k), step3),
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
      l.openehr.path !== null
        ? h("button.btn.small", { type: "button", onclick: () => openInExplorer(current.template, l.openehr.archetype, l.openehr.path) }, "Open this node in the template explorer")
        : null,
    ),
  );
}

function arrow(outcome) {
  return h("div.arrow.o-" + outcome, { "aria-hidden": "true" }, h("span", "→"));
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

function conceptCard(t, live) {
  const cls = t.system === "SNOMED CT" ? "sct" : t.system === "LOINC" ? "loinc" : "other";
  const status = h("div.live");
  const card = h(
    "div.concept.inline",
    h("div.concept-head", h("span.pill." + cls, t.system === "SNOMED CT" ? "SCT" : t.system), " ", codeLink(t)),
    h("div.concept-name", t.display),
    h("div.concept-src", SOURCE_TEXT[t.source] || t.source),
    live ? status : null,
  );
  if (live) lookup(t.code, status);
  return card;
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
  $("#concepts").replaceChildren(
    ...items.map((t) => {
      const cls = t.system === "SNOMED CT" ? "sct" : t.system === "LOINC" ? "loinc" : "other";
      const live = h("div.live");
      const card = h(
        "div.concept",
        { "data-links": t.links.map((l) => l.id).join(" "), onclick: () => select(t.links[0].id, true) },
        h("div.concept-head", h("span.pill." + cls, t.system === "SNOMED CT" ? "SCT" : t.system), " ", codeLink(t)),
        h("div.concept-name", t.display),
        live,
        h("div.concept-uses", "Used for: ", t.links.map((l) => l.label).join(", ")),
      );
      if (t.system === "SNOMED CT") lookup(t.code, live);
      return card;
    }),
  );
  highlight(false);
}

function highlight(scroll) {
  for (const el of document.querySelectorAll("#mode-examples .hl")) el.classList.remove("hl");
  if (!selected) return;
  const sel = `[data-links~="${CSS.escape(selected)}"]`;
  for (const pane of ["#openehr-json", "#fhir-json", "#concepts"]) {
    const els = document.querySelectorAll(`${pane} ${sel}`);
    for (const el of els) el.classList.add("hl");
    if (scroll && els[0] && $("#full-records").open) scrollWithin($(pane), els[0]);
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

async function lookup(code, target) {
  const server = readServer().replace(/\/+$/, "");
  const key = `${server}|${code}`;
  target.replaceChildren(h("span.muted", "Checking terminology server…"));
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
    target.replaceChildren(
      h("span.fsn", fsn || params.find((x) => x.name === "display")?.valueString || ""),
      " ",
      inactiveProp ? h("span.flag." + (inactive ? "unbound" : "ok"), inactive ? "inactive" : "active") : null,
      edition ? h("span.muted.edition", ` · edition ${edition.slice(0, 4)}-${edition.slice(4, 6)}-${edition.slice(6)}`) : null,
    );
  } catch (e) {
    lookupCache.delete(key);
    target.replaceChildren(h("span.muted", `Terminology server not reachable (${e.message}).`));
  }
}
