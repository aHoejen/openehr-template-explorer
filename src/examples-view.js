// "Worked examples" mode: follow one item at a time from openEHR (recorded),
// through SNOMED CT (meaning), to FHIR (sent).
import { EXAMPLES, prepare, resolvePointer } from "./examples/index.js";
import { renderJson, invert } from "./json-view.js";
import { parseOpt } from "./opt-parser.js";

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
    const items = groupedLinks().flatMap((g) => g.items);
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

/** The scenarios home: what the scenarios are, before diving into one. */
export function showScenarios() {
  $("#scenarios-home").hidden = false;
  $("#scenario-detail").hidden = true;
  fill(
    $("#scenario-cards"),
    EXAMPLES.map((ex) =>
      h(
        "article.scenario-card",
        h("p.sc-number", `Scenario ${ex.scenario.number}`),
        h("h3", ex.title),
        h("p.sc-setting", ex.scenario.setting),
        h("p.sc-meta", `Recorded by: ${ex.scenario.recordedBy} · ${ex.scenario.when}`),
        h("p.sc-label", "What was recorded"),
        h("ul.sc-recorded", ex.scenario.recorded.map((r) => h("li", r))),
        h("p.sc-label", "Recorded with template"),
        h("p.sc-template", templateLabel(ex)),
        h("p.sc-label", "Then"),
        h("p.sc-exchange", ex.scenario.exchange),
        h("a.btn.primary.sc-open", { href: `#example=${ex.id}` }, "Open this scenario →"),
      ),
    ),
  );
  window.scrollTo(0, 0);
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
  fill($("#scenario-title"), h("span.sc-number", `Scenario ${current.scenario.number} of ${EXAMPLES.length}`), " ", current.title);
  const nextLink = $("#next-scenario");
  nextLink.href = `#example=${next.id}`;
  nextLink.textContent = `Next scenario: ${next.title} →`;
  fill(
    $("#instance-banner"),
    h("span.instance-tag", "Recorded data"),
    h(
      "div",
      h("p.banner-story", current.story),
      h(
        "p.banner-meta",
        `${current.scenario.setting} · recorded by ${current.scenario.recordedBy.toLowerCase()}, ${current.scenario.when} · one (fictional) patient. `,
        `This record is one instance of the template ${templateLabel(current)}; below, follow each recorded item from the EHR into the FHIR message.`,
      ),
    ),
  );
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
  $("#openehr-title").textContent = current.openehrTitle;
  $("#fhir-title").textContent = current.fhirTitle;
  fill($("#openehr-json"), renderJson(current.openehrJson, invert(current.openehrPointers), (id) => select(id, true)));
  fill($("#fhir-json"), renderJson(current.fhirJson, invert(current.fhirPointers), (id) => select(id, true)));
  currentTemplate = null;
  renderSummary();
  renderContext();
  renderList();
  renderJourney();
  renderConcepts();
  highlight(false);
  loadTemplate(current.template).then((t) => {
    if (!t || current.template !== raw.template) return;
    currentTemplate = t;
    renderContext();
    renderList();
    renderJourney();
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

function renderContext() {
  const box = $("#items-context");
  if (!currentTemplate) {
    fill(box, h("h3", "Pick an item"), h("p.ctx-line.muted", `From template “${current.template}”…`));
    return;
  }
  const t = currentTemplate;
  const roots = archetypeRoots();
  const top = roots[0];
  const inside = roots.slice(1);
  const usedInside = inside.filter((r) => r.used || current.links.some((l) => l.openehr.archetype === r.id));
  const word = RM_WORD[top.rm] || top.rm.toLowerCase();

  fill(box, 
    h("h3", `Pick a recorded item`),
    h(
      "p.ctx-line",
      `These items were recorded in a ${word} built from the template `,
      h("strong", `“${t.templateId}”`),
      `. The template defines a ${top.rm} that contains `,
      h("strong", `${inside.length} archetype${inside.length === 1 ? "" : "s"}`),
      reused(inside),
      usedInside.length < inside.length ? `. This example uses ${usedInside.length} of them.` : ".",
    ),
    templateSourceLine(),
    ...(top.rm === "SECTION" ? [h("p.ctx-line.muted", "A section template: in practice it is placed inside a composition, such as an International Patient Summary.")] : []),
    h(
      "details.ctx-archetypes",
      h("summary", "Show the archetypes"),
      h(
        "ul",
        h("li.root", rmBadge(top.rm), " ", h("span", top.name), h("code.small", top.id)),
        inside.map((r) =>
          h(
            "li" + (r.used ? ".used" : ".unused") + (r.parent && r.parent.archetypeId !== top.id ? ".nested" : ""),
            rmBadge(r.rm),
            " ",
            h("span", r.name),
            r.used ? null : h("span.ctx-tag", "not in this example"),
            h("code.small", r.id),
          ),
        ),
      ),
    ),
  );
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

function renderList() {
  const out = [];
  for (const g of groupedLinks()) {
    out.push(
      h(
        "li.item-group" + (g.parent && !g.isTop && g.parent !== archetypeRoots()[0]?.node ? ".nested" : ""),
        { role: "presentation", title: g.id },
        rmBadge(g.rm),
        " ",
        h("span", g.name),
        g.isTop ? h("span.group-note", " (the template's root)") : null,
        g.parent && !g.isTop && g.parent.archetypeId !== archetypeRoots()[0]?.id ? h("span.group-note", ` inside ${g.parent.name}`) : null,
      ),
    );
    for (const l of g.items) {
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
  }
  fill($("#item-list"), ...out);
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
        (fhirOnly.length ? ` The FHIR profile also requires ${codeList(fhirOnly)}, which the archetype does not provide; the mapping adds it.` : "")
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
      if (l.fhirBinding?.strength === "fixed") {
        return `${cap(arch)} has no terminology binding for ${item}. The FHIR profile fixes the LOINC code, so that part is decided by FHIR. The SNOMED CT code is optional and was chosen by the mapping; another system could choose a different one or leave it out.`;
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
  fixed: { label: "Fixed by the profile", text: "The FHIR profile fixes this exact code." },
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

function renderJourney() {
  const box = $("#journey");
  const l = current.links.find((x) => x.id === selected);
  if (!l) return fill(box, h("p.muted", "No items match this filter."));
  const k = HOW[l.how].outcome;
  const notUsed = (t) => t.source === "possible, not recorded";
  const sct = l.terms.filter((t) => t.system === "SNOMED CT" && !notUsed(t));
  const other = l.terms.filter((t) => t.system !== "SNOMED CT" && !notUsed(t));
  const couldHave = l.terms.filter(notUsed);

  const step1 = h(
    "div.step.s-openehr",
    h("div.step-head", h("span.step-no", "1"), h("div", h("h4", "Recorded in openEHR"), h("p.step-sub", "the EHR"))),
    h("p.step-value", plainValue(l.value)),
    storedNote(l) ? h("p.step-note", storedNote(l)) : null,
    snippet(current.openehrJson, current.openehrPointers.get(l.id), "openEHR"),
  );

  const step2 = h(
    "div.step.s-sct",
    h("div.step-head", h("span.step-no", "2"), h("div", h("h4", "Meaning in SNOMED CT"), h("p.step-sub", "what it means"))),
    sct.length
      ? sct.map((t) => conceptCard(t, true))
      : l.how === "direct"
        ? h("p.step-value.muted", "Not needed: a date or a group carries no coded meaning.")
        : l.how === "text"
          ? sentAsTextOnly(l)
            ? h("p.no-code", h("strong", "No SNOMED CT code is recorded or sent."), " Only the words travel; a receiving system has to guess what they mean.")
            : h("p.no-code", h("strong", "No SNOMED CT code is recorded."), " FHIR needs one of its own codes here, so the words have to be interpreted to choose it.")
          : other.some((t) => t.system === "FHIR")
            ? h("p.step-value.muted", "No SNOMED CT concept is used here. FHIR uses one of its own codes instead (see step 3).")
            : h("p.step-value.muted", "No SNOMED CT concept for this item."),
    couldHave.length
      ? h(
          "div.could-have",
          h("p.could-have-head", "Could have been used, but was not"),
          h("p.step-note", "If the template had offered a coded list here, this concept could have carried the meaning:"),
          couldHave.map((t) => conceptCard(t, true, true)),
        )
      : null,
  );

  const fhirPtrs = current.fhirPointers.get(l.id) || [];
  const step3 = h(
    "div.step.s-fhir",
    h("div.step-head", h("span.step-no", "3"), h("div", h("h4", "Sent in FHIR"), h("p.step-sub", "the message"))),
    l.fhir ? [h("p.step-value", sentValue(l, fhirPtrs)), h("p.step-note", "as ", h("code", l.fhir)), fhirTextNote(l, fhirPtrs)] : h("p.step-value", "Not sent"),
    l.fhir && l.fhirBinding ? bindingLine(l.fhirBinding) : null,
    l.fhir && other.length
      ? h(
          "div.other-codes",
          h("p.step-note", sct.length ? "Sent together with the SNOMED CT code:" : "Code in the message:"),
          other.map((t) => conceptCard(t, false)),
        )
      : null,
    fhirPtrs.length ? snippet(current.fhirJson, fhirPtrs, "FHIR") : null,
  );

  fill(box, 
    h(
      "div.verdict.o-" + k,
      h("span.o-icon.big", { "aria-hidden": "true" }, OUTCOMES[k].icon),
      h("div", h("h3", `${l.label}: ${OUTCOMES[k].label.toLowerCase()}`), h("p", reasonFor(l))),
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
  return h(
    "div.binding-line",
    h("span.binding-label", "FHIR binding: "),
    h("span.strength.st-" + b.strength, { title: st.text }, st.label),
    h("p.step-note", b.url ? h("a", { href: b.url, target: "_blank", rel: "noopener noreferrer" }, b.name) : b.name, b.strength === "none" ? "." : `. ${st.text}`),
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

function conceptCard(t, live, notUsed = false) {
  const cls = t.system === "SNOMED CT" ? "sct" : t.system === "LOINC" ? "loinc" : "other";
  const status = h("div.live");
  const card = h(
    "div.concept.inline" + (notUsed ? ".not-used" : ""),
    notUsed ? h("span.not-used-tag", "not in the record · not sent") : null,
    h("div.concept-head", h("span.pill." + cls, t.system === "SNOMED CT" ? "SCT" : t.system), " ", codeLink(t)),
    h("div.concept-name", t.system === "FHIR" ? `from FHIR code system “${t.display}”` : t.display),
    notUsed ? null : h("div.concept-src", SOURCE_TEXT[t.source] || t.source),
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
  fill(target, h("span.muted", "Checking terminology server…"));
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
    fill(target, 
      h("span.fsn", fsn || params.find((x) => x.name === "display")?.valueString || ""),
      " ",
      inactiveProp ? h("span.flag." + (inactive ? "unbound" : "ok"), inactive ? "inactive" : "active") : null,
      edition ? h("span.muted.edition", ` · edition ${edition.slice(0, 4)}-${edition.slice(4, 6)}-${edition.slice(6)}`) : null,
    );
  } catch (e) {
    lookupCache.delete(key);
    fill(target, h("span.muted", `Terminology server not reachable (${e.message}).`));
  }
}
