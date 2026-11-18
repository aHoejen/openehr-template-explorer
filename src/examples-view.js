// "Learn" mode: worked examples that link openEHR data, SNOMED CT and FHIR.
import { EXAMPLES, prepare } from "./examples/index.js";
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

export const HOW = {
  bound: { label: "Bound in the archetype", tone: "good", text: "The archetype binds this node to a terminology code, so the meaning travels with no extra decision." },
  coded: { label: "SNOMED CT recorded as the value", tone: "good", text: "The data itself holds a SNOMED CT code, from a value set the template and the FHIR profile share." },
  mapped: { label: "Mapped by the integration", tone: "warn", text: "No binding exists, so someone decided which code to use. Consistency depends on that decision." },
  "fhir-code": { label: "FHIR's own code", tone: "info", text: "FHIR requires a code from its own code system. A fixed table translates the openEHR local code." },
  direct: { label: "Copied as is", tone: "plain", text: "Same structure or data type on both sides, such as a date or a nested group." },
  context: { label: "From the template or the EHR", tone: "ctx", text: "Not a recorded value. It follows from where the data sits: the template, the section, the patient's EHR." },
  text: { label: "Free text only", tone: "bad", text: "The template allows text, so the message can't carry a reliable code." },
  none: { label: "No place in FHIR", tone: "bad", text: "The openEHR record keeps it, but the standard FHIR resource has no element for it." },
};

const DEFAULT_SERVER = "https://implementation-demo.snomedtools.org/snowstorm-lite/fhir";
const lookupCache = new Map();

let current = null; // prepared example
let selected = null; // link id
let openInExplorer = () => {};

export function initExamples(opts) {
  openInExplorer = opts.openInExplorer;
  const tabs = $("#example-tabs");
  tabs.replaceChildren(
    ...EXAMPLES.map((ex) =>
      h("button", { type: "button", role: "tab", "data-id": ex.id, onclick: () => showExample(ex.id) }, h("strong", ex.title), h("span", ex.fhirTitle)),
    ),
  );
  $("#legend").replaceChildren(...Object.entries(HOW).map(([k, v]) => h("li", h("span.how." + v.tone, v.label), " ", v.text)));
  const input = $("#tx-server");
  input.value = readServer();
  $("#tx-form").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      localStorage.setItem("txServer", input.value.trim());
    } catch {}
    lookupCache.clear();
    renderConcepts();
  });
  $("#tx-reset").addEventListener("click", () => {
    input.value = DEFAULT_SERVER;
    try {
      localStorage.removeItem("txServer");
    } catch {}
    lookupCache.clear();
    renderConcepts();
  });
}

function readServer() {
  try {
    return localStorage.getItem("txServer") || DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}

export function showExample(id) {
  const raw = EXAMPLES.find((e) => e.id === id) || EXAMPLES[0];
  current = prepare(raw);
  selected = null;
  for (const b of document.querySelectorAll("#example-tabs button")) b.setAttribute("aria-selected", String(b.dataset.id === current.id));
  if (!location.hash.includes(`example=${current.id}`)) history.replaceState(null, "", `#example=${current.id}`);

  $("#example-story").textContent = current.story;
  $("#example-points").replaceChildren(...current.points.map((p) => h("li", p)));
  $("#openehr-title").textContent = current.openehrTitle;
  $("#fhir-title").textContent = current.fhirTitle;
  $("#openehr-json").replaceChildren(renderJson(current.openehrJson, invert(current.openehrPointers), select));
  $("#fhir-json").replaceChildren(renderJson(current.fhirJson, invert(current.fhirPointers), select));
  renderTable();
  renderConcepts();
  highlight();
}

// ------------------------------------------------------------------ mapping table

function termChip(t) {
  const cls = t.system === "SNOMED CT" ? "sct" : t.system === "LOINC" ? "loinc" : "other";
  return h(
    "span.term",
    h("span.pill." + cls, t.system === "SNOMED CT" ? "SCT" : t.system, " ", t.code),
    " ",
    h("span.term-name", t.display),
    h("span.term-src", t.source),
  );
}

function renderTable() {
  const body = $("#mapping-body");
  const rows = [];
  let group = null;
  for (const l of current.links) {
    if (l.group !== group) {
      group = l.group;
      rows.push(h("tr.group", h("th", { colspan: 5, scope: "colgroup" }, group)));
    }
    const how = HOW[l.how];
    rows.push(
      h(
        "tr.link-row",
        { "data-id": l.id, tabindex: "0", onclick: () => select(l.id), onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select(l.id)) },
        h("td", h("strong", l.label)),
        h("td", h("div", l.value), h("code.small", l.openehr.path ?? l.openehr.rm)),
        h("td", l.terms.length ? l.terms.map(termChip) : h("span.muted", "–")),
        h("td", l.fhir ? h("code.small", l.fhir) : h("span.muted", "not carried")),
        h("td", h("span.how." + how.tone, { title: how.text }, how.label)),
      ),
    );
    if (selected === l.id) rows.push(detailRow(l));
  }
  body.replaceChildren(...rows);
}

function detailRow(l) {
  const how = HOW[l.how];
  return h(
    "tr.detail-row",
    h(
      "td",
      { colspan: 5 },
      h("p", h("span.how." + how.tone, how.label), " ", how.text),
      l.note ? h("p", l.note) : null,
      l.openehr.path !== null
        ? h(
            "button.btn.small",
            { type: "button", onclick: () => openInExplorer(current.template, l.openehr.archetype, l.openehr.path) },
            "Show this node in the template explorer",
          )
        : null,
    ),
  );
}

function select(id) {
  selected = selected === id ? null : id;
  renderTable();
  highlight(true);
}

function highlight(scroll) {
  for (const el of document.querySelectorAll("#mode-examples .hl")) el.classList.remove("hl");
  if (!selected) return;
  const sel = `[data-links~="${CSS.escape(selected)}"]`;
  const targets = [
    ...document.querySelectorAll(`#openehr-json ${sel}`),
    ...document.querySelectorAll(`#fhir-json ${sel}`),
    ...document.querySelectorAll(`#concepts ${sel}`),
    ...document.querySelectorAll(`#mapping-body tr[data-id="${CSS.escape(selected)}"]`),
  ];
  for (const el of targets) el.classList.add("hl");
  if (scroll) {
    const three = document.querySelector("#mode-examples .three");
    const mapping = document.querySelector("#mode-examples .mapping");
    if (three.getBoundingClientRect().bottom > window.innerHeight && mapping.getBoundingClientRect().top > 0) {
      window.scrollBy({ top: mapping.getBoundingClientRect().top - 8, behavior: "smooth" });
    }
    const row = document.querySelector(`#mapping-body tr[data-id="${CSS.escape(selected)}"]`);
    if (row) scrollWithin(document.querySelector("#mode-examples .mapping .table-wrap"), row, 40);
    for (const pane of ["#openehr-json", "#fhir-json", "#concepts"]) {
      const first = document.querySelector(`${pane} ${sel}`);
      if (first) scrollWithin(document.querySelector(pane), first);
    }
  }
}

function scrollWithin(container, el, offset = 12) {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top < c.top + offset || r.bottom > c.bottom) container.scrollTop += r.top - c.top - offset;
}

// ------------------------------------------------------------------ concepts panel

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
  const box = $("#concepts");
  box.replaceChildren(
    ...items.map((t) => {
      const cls = t.system === "SNOMED CT" ? "sct" : t.system === "LOINC" ? "loinc" : "other";
      const live = h("div.live");
      const card = h(
        "div.concept",
        { "data-links": t.links.map((l) => l.id).join(" "), onclick: () => select(t.links[0].id) },
        h("div.concept-head", h("span.pill." + cls, t.system === "SNOMED CT" ? "SCT" : t.system), " ", codeLink(t)),
        h("div.concept-name", t.display),
        live,
        h("div.concept-uses", "Used for: ", t.links.map((l) => l.label).join(", ")),
      );
      if (t.system === "SNOMED CT") lookup(t.code, live);
      return card;
    }),
  );
  highlight();
}

function codeLink(t) {
  let href = null;
  if (t.system === "SNOMED CT") href = `https://browser.ihtsdotools.org/?perspective=full&conceptId1=${t.code}&edition=MAIN&languages=en`;
  if (t.system === "LOINC") href = `https://loinc.org/${t.code}/`;
  const code = h("code", t.code);
  return href ? h("a", { href, target: "_blank", rel: "noopener noreferrer", onclick: (e) => e.stopPropagation() }, code) : code;
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
