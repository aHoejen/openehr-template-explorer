// UI for the openEHR Template Explorer. No framework, no build step.
import { parseOpt, formatOccurrences, formatRange, bindingsToCsv, aqlFor } from "./opt-parser.js";
import { initExamples, showExample, showScenarios, scenarioForTemplate } from "./examples-view.js";
import { infoButton } from "./info-pop.js";

const $ = (sel) => document.querySelector(sel);

/** Tiny element builder: h("div.cls", {attr}, ...children). Text is always set safely. */
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
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Containers that add nesting but little meaning for a reader; hidden unless asked for.
const STRUCTURAL = new Set(["HISTORY", "ITEM_TREE", "ITEM_LIST", "ITEM_SINGLE", "ITEM_TABLE", "EVENT_CONTEXT", "ITEM_STRUCTURE"]);

const FILTERS = {
  unbound: { label: "Elements without a binding", test: (n) => n.kind === "element" && !n.removed && !n.bindings.length },
  bound: { label: "Elements with a binding", test: (n) => n.kind === "element" && n.bindings.length > 0 },
  localOnly: { label: "Local value sets with no bindings", test: (n) => state.t.findings.localOnlyValueSets.includes(n.id) },
  partly: { label: "Partly bound local value sets", test: (n) => state.t.findings.partlyBoundValueSets.includes(n.id) },
  external: { label: "External terminology constraints", test: (n) => state.t.findings.externalValueSets.includes(n.id) },
  stamped: { label: "Bindings with a version stamp", test: (n) => nodeBindings(n).some((b) => b.version) },
  removed: { label: "Removed nodes (0..0)", test: (n) => n.removed },
};

const state = {
  t: null,
  byId: new Map(),
  selected: null,
  collapsed: new Set(),
  filter: null,
  search: "",
  showStructure: false,
  showSlots: false,
  tech: false,
  bindingsSort: { key: null, dir: 1 },
};

// ------------------------------------------------------------------ loading

let sampleList = [];
let loadedSample = null;

async function loadSamples() {
  try {
    const res = await fetch("samples/index.json");
    sampleList = await res.json();
    const sel = $("#sample-select");
    for (const s of sampleList) sel.append(h("option", { value: s.file, title: s.note }, s.label));
    sel.addEventListener("change", () => {
      if (sel.value) location.hash = `sample=${encodeURIComponent(sel.value)}`;
    });
  } catch {
    $("#sample-select").closest("label").hidden = true; // e.g. opened from file:// without a server
  }
}

async function loadSample(file) {
  if (loadedSample === file && state.t) return true;
  const r = await fetch(`samples/${encodeURIComponent(file)}`);
  if (!r.ok) {
    showError(`Could not load sample (${r.status}).`);
    return false;
  }
  $("#sample-select").value = file;
  load(await r.text(), file, true);
  loadedSample = file;
  return true;
}

// ------------------------------------------------------------------ modes and routing

function setMode(mode) {
  $("#mode-examples").hidden = mode !== "examples";
  $("#mode-explore").hidden = mode !== "explore";
  $("#loaders").hidden = mode !== "explore";
  $("#mode-link-examples").setAttribute("aria-current", String(mode === "examples"));
  $("#mode-link-explore").setAttribute("aria-current", String(mode === "explore"));
  if (mode === "examples") document.title = "Clinical scenarios – openEHR, FHIR and SNOMED CT";
  else if (state.t) document.title = `${state.t.concept || state.t.templateId} – Template explorer`;
  else document.title = "Template explorer – openEHR, FHIR and SNOMED CT";
}

async function route() {
  const params = new URLSearchParams(location.hash.slice(1));
  const sample = params.get("sample");
  if (sample && sampleList.some((s) => s.file === sample)) {
    setMode("explore");
    await loadSample(sample);
  } else if (params.has("explore") || params.has("sample")) {
    setMode("explore");
  } else if (params.get("example")) {
    setMode("examples");
    showExample(params.get("example"));
    window.scrollTo(0, 0);
  } else {
    setMode("examples");
    showScenarios();
  }
}

/** Called from a worked example: open its template and select one node. */
async function openInExplorer(file, archetypeId, path) {
  history.pushState(null, "", `#sample=${encodeURIComponent(file)}`);
  setMode("explore");
  if (!(await loadSample(file))) return;
  const node = state.t.nodes.find((n) => n.archetypeRootId === archetypeId && n.archetypePath === path);
  if (node) {
    setFilter(null);
    select(node.id);
  }
  window.scrollTo(0, 0);
}

let loadedSampleFor = null;

function load(xml, sourceName, fromSample = false) {
  loadedSampleFor = fromSample ? sourceName : null;
  hideError();
  let t;
  try {
    t = parseOpt(xml);
  } catch (e) {
    return showError(`${sourceName ? sourceName + ": " : ""}${e.message}`);
  }
  state.t = t;
  state.byId = new Map(t.nodes.map((n) => [n.id, n]));
  state.selected = null;
  state.collapsed = new Set(t.nodes.filter((n) => n.kind === "slot").map((n) => n.id));
  state.filter = null;
  state.search = "";
  $("#tree-search").value = "";
  $("#bindings-search").value = "";
  $("#welcome").hidden = true;
  $("#explorer").hidden = false;
  renderHeader();
  renderFindings();
  renderTree();
  renderBindingsTable();
  const first = t.nodes.find((n) => n.kind === "element") || t.root;
  select(first.id, { scroll: false });
}

function showError(msg) {
  const el = $("#error");
  el.textContent = msg;
  el.hidden = false;
}
function hideError() {
  $("#error").hidden = true;
}

// ------------------------------------------------------------------ header + findings

function renderHeader() {
  const t = state.t;
  $("#tpl-title").textContent = t.concept || t.templateId;
  const inside = t.nodes.filter((n) => n.kind === "archetype_root").length - 1;
  const scenario = loadedSampleFor ? scenarioForTemplate(loadedSampleFor) : null;
  $("#tpl-meta").replaceChildren(
    `A template: what can be recorded, built from ${inside} archetype${inside === 1 ? "" : "s"}. No patient data.`,
    ...(scenario ? [" ", h("a", { href: `#example=${scenario.id}` }, `See it used in Scenario ${scenario.scenario.number} →`)] : []),
  );
  $("#tpl-info").replaceChildren(infoButton("About this template", () => templateInfo(t, inside)));
  $("#bindings-count").textContent = t.bindings.length;
  document.title = `${t.concept || t.templateId} – Template explorer`;
}

/** The longer template facts, shown in the ⓘ popup next to the title. */
function templateInfo(t, inside) {
  const sample = sampleList.find((x) => x.file === loadedSampleFor);
  const roots = t.nodes.filter((n) => n.kind === "archetype_root" && n !== t.root);
  return [
    h(
      "p",
      "A template is a ",
      h("strong", "definition"),
      `: it combines archetypes for one use and constrains them further. This one builds a ${t.root.rmType} from ${inside} archetype${inside === 1 ? "" : "s"}. It holds no patient data. Each puzzle-piece row in the tree is an archetype.`,
    ),
    t.purpose && !/^not specified\.?$/i.test(t.purpose.trim()) ? h("p", h("strong", "Purpose: "), t.purpose) : null,
    h(
      "dl.info-dl",
      h("dt", "Template id"),
      h("dd", h("code", t.templateId)),
      t.language ? [h("dt", "Language"), h("dd", t.language)] : null,
      h("dt", "Size"),
      h("dd", `${roots.length + 1} archetype roots, ${t.nodes.length} nodes, ${t.bindings.length} terminology bindings`),
      h("dt", "Source"),
      h(
        "dd",
        sample
          ? [sample.sourceUrl ? h("a", { href: sample.sourceUrl, target: "_blank", rel: "noopener noreferrer" }, sample.source) : sample.source, ` · Licence: ${sample.licence}`]
          : "Your own file, opened in this browser only.",
      ),
    ),
    h("p", h("strong", "Archetypes inside")),
    h("ul.info-archetypes", roots.map((r) => h("li", h("span", r.name), " ", h("code", shortArchetype(r.archetypeId))))),
  ];
}

function renderFindings() {
  const f = state.t.findings;
  const pct = f.elements ? Math.round((100 * f.elementsBound) / f.elements) : 0;
  const notInTemplate = f.unmatchedBindings;
  const chips = [
    { key: "bound", value: `${f.elementsBound}/${f.elements}`, label: `elements bound (${pct}%)`, tone: "ok" },
    { key: "unbound", value: f.unboundElements.length, label: "with no binding", tone: f.unboundElements.length ? "warn" : "ok" },
    { key: "localOnly", value: f.localOnlyValueSets.length, label: "local codes only", tone: f.localOnlyValueSets.length ? "warn" : "ok" },
    { key: "partly", value: f.partlyBoundValueSets.length, label: "partly bound", tone: f.partlyBoundValueSets.length ? "warn" : "ok", hideIfZero: true },
    { key: "external", value: f.externalValueSets.length, label: "external value sets", tone: "info", hideIfZero: true },
    { key: "stamped", value: f.versionStamped, label: "version-stamped", tone: f.versionStamped ? "warn" : "ok" },
    { key: "removed", value: f.removed.length, label: "removed", tone: "muted", hideIfZero: true },
    { key: null, tab: "bindings", value: notInTemplate, label: "bindings not used", tone: "muted", hideIfZero: true },
  ];
  const box = $("#findings");
  box.replaceChildren(
    ...chips
      .filter((c) => !(c.hideIfZero && !c.value))
      .map((c) =>
        h(
          "button.chip." + c.tone,
          {
            type: "button",
            "aria-pressed": String(state.filter === c.key && !!c.key),
            title: c.key ? `Show only: ${FILTERS[c.key].label}` : "Open the bindings table",
            onclick: () => {
              if (c.tab) {
                $("#bindings-hide-unmatched").checked = false;
                showTab("bindings");
                renderBindingsTable();
                return;
              }
              setFilter(state.filter === c.key ? null : c.key);
            },
          },
          h("strong", c.value),
          " ",
          c.label,
        ),
      ),
  );
}

function setFilter(key) {
  state.filter = key;
  showTab("tree");
  renderFindings();
  renderTree();
  const af = $("#active-filter");
  if (key) {
    af.replaceChildren(
      `Showing: ${FILTERS[key].label}. `,
      h("button.linklike", { type: "button", onclick: () => setFilter(null) }, "Show everything"),
    );
    af.hidden = false;
  } else af.hidden = true;
}

// ------------------------------------------------------------------ tree

function nodeBindings(n) {
  const out = [...n.bindings];
  for (const dv of n.values) for (const c of dv.codeSet?.codes || []) if (c.bindings) out.push(...c.bindings);
  return out;
}

function searchText(n) {
  const parts = [n.name, n.archetypeText, n.nodeId, n.archetypeId, n.rmType];
  for (const b of nodeBindings(n)) parts.push(b.code, b.terminologyRaw);
  for (const dv of n.values) {
    parts.push(dv.rmType);
    for (const c of dv.codeSet?.codes || []) parts.push(c.code, c.text);
    for (const u of dv.units || []) parts.push(u.units);
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function isVisibleKind(n) {
  if (n.kind === "slot") return state.showSlots;
  if (n.kind === "structure" && STRUCTURAL.has(n.rmType)) return state.showStructure;
  return true;
}

/** Build the visible tree: hidden nodes are skipped and their children lifted up. */
function buildView(node, matcher) {
  const kids = [];
  for (const c of node.children) {
    const v = buildView(c, matcher);
    if (!v) continue;
    if (Array.isArray(v)) kids.push(...v);
    else kids.push(v);
  }
  const visible = isVisibleKind(node) || node === state.t.root;
  const selfMatch = !matcher || matcher(node);
  if (!visible) {
    // Lift children; drop hidden nodes that lead nowhere.
    return kids.length ? kids : null;
  }
  if (matcher && !selfMatch && !kids.length) return null;
  return { node, kids, match: !!matcher && selfMatch };
}

function currentMatcher() {
  const parts = [];
  if (state.filter) parts.push(FILTERS[state.filter].test);
  const q = state.search.trim().toLowerCase();
  if (q) parts.push((n) => searchText(n).includes(q));
  if (!parts.length) return null;
  return (n) => parts.every((p) => p(n));
}

function renderTree() {
  const matcher = currentMatcher();
  const view = buildView(state.t.root, matcher);
  const ul = $("#tree");
  if (!view || (Array.isArray(view) && !view.length)) {
    ul.replaceChildren(h("li.empty", "No nodes match."));
    return;
  }
  const roots = Array.isArray(view) ? view : [view];
  ul.replaceChildren(...roots.map((v) => renderItem(v, !!matcher)));
}

function renderItem(v, filtering) {
  const n = v.node;
  const hasKids = v.kids.length > 0;
  const open = filtering || !state.collapsed.has(n.id);
  const li = h("li", { role: "treeitem", "aria-expanded": hasKids ? String(open) : null, "aria-selected": String(state.selected === n.id) });
  const row = h(
    "div.row",
    {
      class: ["row", `k-${n.kind}`, n.removed ? "removed" : "", state.selected === n.id ? "selected" : "", v.match ? "match" : ""].join(" "),
      dataset: { id: n.id },
    },
    hasKids
      ? h("button.caret", { type: "button", "aria-label": open ? "Collapse" : "Expand", onclick: (e) => { e.stopPropagation(); toggle(n.id); } }, open ? "▾" : "▸")
      : h("span.caret-spacer"),
    h(
      "button.node",
      { type: "button", onclick: () => select(n.id) },
      state.tech ? h("span.rm", { title: n.constraintType }, rmLabel(n)) : kindIcon(n),
      h("span.name", n.name),
      state.tech
        ? [
            n.kind === "archetype_root" ? h("span.code.arch", { title: n.archetypeId }, shortArchetype(n.archetypeId)) : n.nodeId ? h("span.code", n.nodeId) : null,
            h("span.occ", { title: "occurrences" }, formatOccurrences(n.occurrences)),
            typeSummary(n),
          ]
        : h("span.kind-label", plainKind(n)),
      bindingPills(n.bindings),
      state.tech ? flags(n) : filterFlag(n),
    ),
  );
  li.append(row);
  if (hasKids && open) li.append(h("ul", { role: "group" }, v.kids.map((k) => renderItem(k, filtering))));
  return li;
}

const PLAIN_DV = {
  DV_QUANTITY: "quantity", DV_CODED_TEXT: "coded text", DV_TEXT: "text", DV_COUNT: "count", DV_DATE_TIME: "date/time",
  DV_DATE: "date", DV_TIME: "time", DV_ORDINAL: "ordinal", DV_SCALE: "scale", DV_BOOLEAN: "yes/no", DV_PROPORTION: "proportion",
  DV_DURATION: "duration", DV_IDENTIFIER: "identifier", DV_MULTIMEDIA: "multimedia", DV_URI: "link", DV_EHR_URI: "link",
  DV_PARSABLE: "parsable text", DV_INTERVAL: "interval",
};
const ROOT_ICON = { COMPOSITION: "description", SECTION: "folder" };

/** Plain-language kind for the simple tree: the data type of an element, else the RM class. */
function plainKind(n) {
  if (n.kind === "element") return [...new Set(n.values.map((v) => PLAIN_DV[v.rmType] || v.rmType))].join(" or ");
  if (n.kind === "slot") return "slot";
  const rm = n.rmType.toLowerCase().replace(/_/g, " ");
  return n.kind === "archetype_root" ? `${rm} archetype` : rm;
}

function kindIcon(n) {
  const icon =
    n.kind === "archetype_root" ? ROOT_ICON[n.rmType] || "extension" : n.kind === "element" ? "radio_button_unchecked" : n.kind === "slot" ? "input" : "folder_open";
  return h("span.kind-icon.material-symbols-outlined", { "aria-hidden": "true", title: n.rmType }, icon);
}

/** In the simple tree, show a flag only for the highlight the user picked. */
function filterFlag(n) {
  if (!state.filter || state.filter === "bound") return null;
  const f = flags(n);
  if (!f) return null;
  const want = { unbound: "unbound", localOnly: "local", partly: "local", external: "ext", stamped: "stamp", removed: "removed" }[state.filter];
  for (const x of [...f.children]) if (!x.classList.contains(want)) x.remove();
  return f.children.length ? f : null;
}

function rmLabel(n) {
  if (n.kind === "slot") return "SLOT";
  return n.rmType;
}

function shortArchetype(id) {
  const m = (id || "").match(/^[^-]+-[^-]+-([A-Z_]+)\.(.+)$/);
  return m ? `${m[1]}.${m[2]}` : id;
}

function typeSummary(n) {
  if (n.kind !== "element" || !n.values.length) return null;
  return h("span.dtype", n.values.map((v) => v.rmType).join(" | "));
}

function bindingPills(bindings) {
  if (!bindings.length) return null;
  return h(
    "span.pills",
    bindings.map((b) =>
      h(
        "span.pill." + familyClass(b.family),
        { title: `${b.terminologyRaw}::${b.code}${b.version ? ` (version stamp: ${b.version})` : ""}` },
        `${familyShort(b.family)} ${b.code}`,
      ),
    ),
  );
}

function flags(n) {
  const out = [];
  if (n.kind === "element" && !n.removed && !n.bindings.length) out.push(h("span.flag.unbound", { title: "No terminology binding on this element" }, "unbound"));
  const f = state.t.findings;
  if (f.localOnlyValueSets.includes(n.id)) out.push(h("span.flag.local", { title: "Local at-codes only: no value in this list is bound" }, "local codes only"));
  if (f.partlyBoundValueSets.includes(n.id)) out.push(h("span.flag.local", { title: "Only some local codes are bound" }, "partly bound"));
  const fullyBound = n.values.find((v) => v.codeSet?.kind === "local" && v.codeSet.codes.length && v.codeSet.boundCount === v.codeSet.codes.length);
  if (fullyBound) out.push(h("span.flag.ok", { title: "Every local code in this value set is bound" }, "values bound"));
  if (f.externalValueSets.includes(n.id)) out.push(h("span.flag.ext", { title: "Values come from an external terminology" }, "external"));
  if (nodeBindings(n).some((b) => b.version)) out.push(h("span.flag.stamp", { title: "Binding carries a terminology version stamp such as SNOMED-CT(2003)" }, "stamped"));
  if (n.removed) out.push(h("span.flag.removed", { title: "occurrences 0..0: excluded by the template" }, "removed"));
  return out.length ? h("span.flags", out) : null;
}

function familyClass(f) {
  return { "SNOMED CT": "sct", LOINC: "loinc" }[f] || "other";
}
function familyShort(f) {
  return { "SNOMED CT": "SCT", LOINC: "LOINC" }[f] || f;
}

function toggle(id) {
  if (state.collapsed.has(id)) state.collapsed.delete(id);
  else state.collapsed.add(id);
  renderTree();
}

function select(id, { scroll = true } = {}) {
  state.selected = id;
  for (const r of document.querySelectorAll("#tree .row.selected")) r.classList.remove("selected");
  // Make sure the node is visible: expand ancestors.
  let p = state.byId.get(id);
  let changed = false;
  while (p && p.parentId) {
    if (state.collapsed.delete(p.parentId)) changed = true;
    p = state.byId.get(p.parentId);
  }
  const n = state.byId.get(id);
  if (n && !isVisibleKind(n) && n !== state.t.root) {
    if (n.kind === "slot") $("#show-slots").checked = state.showSlots = true;
    else $("#show-structure").checked = state.showStructure = true;
    changed = true;
  }
  if (changed || !document.querySelector(`#tree .row[data-id="${id}"]`)) renderTree();
  const row = document.querySelector(`#tree .row[data-id="${id}"]`);
  if (row) {
    row.classList.add("selected");
    if (scroll) row.scrollIntoView({ block: "nearest" });
  }
  renderDetail(n);
}

// ------------------------------------------------------------------ detail panel

function renderDetail(n) {
  const t = state.t;
  const d = $("#detail");
  if (!n) return d.replaceChildren(h("p.muted", "Select a node to see its details."));
  const archRoot = state.byId.get(n.archetypeRootRef);
  const facts = [
    ["RM type", n.rmType],
    ["Constraint", n.constraintType],
    n.nodeId && ["Node id", n.nodeId],
    n.archetypeId && ["Archetype id", n.archetypeId],
    !n.archetypeId && archRoot && ["In archetype", archRoot.archetypeId],
    ["Occurrences", formatOccurrences(n.occurrences)],
    n.attribute && [
      "Parent attribute",
      `${n.rmAttribute}${n.attribute.multiple ? ` (multiple, cardinality ${formatOccurrences(n.attribute.cardinality)})` : " (single)"}${n.attribute.existence ? `, existence ${formatOccurrences(n.attribute.existence)}` : ""}`,
    ],
    n.templateName && n.archetypeText && n.templateName !== n.archetypeText && ["Archetype name", n.archetypeText],
  ].filter(Boolean);

  const sections = [
    h(
      "div.detail-head",
      kindIcon(n),
      h("h3", n.name),
      h("span.kind-label", plainKind(n)),
      n.templateName && n.templateName !== n.archetypeText ? h("span.tag", { title: "Renamed in the template" }, "renamed in template") : null,
      flags(n),
    ),
    n.description && n.description !== "@ internal @" ? h("p.desc", n.description) : null,
    n.comment ? h("p.desc.muted", n.comment) : null,
    n.values.length ? h("section", h("h4", "Data value"), n.values.map((v) => dataValue(v, n))) : null,
    h("section", h("h4", "Terminology bindings on this node"), n.bindings.length ? bindingList(n.bindings) : h("p.muted", n.kind === "element" ? "None. This element has no term binding in its archetype." : "None.")),
    n.slot
      ? h(
          "section",
          h("h4", "Slot"),
          h("p", "Archetypes allowed here:"),
          h("ul.mono", n.slot.includes.map((s) => h("li", s))),
          n.slot.excludes.length ? [h("p", "Excluded:"), h("ul.mono", n.slot.excludes.map((s) => h("li", s)))] : null,
        )
      : null,
    h(
      "details.tech-details",
      { open: state.tech || null },
      h("summary", "Technical details: RM, paths and AQL"),
      h("dl.facts", facts.map(([k, v]) => [h("dt", k), h("dd", v)])),
      pathsSection(n, t),
      n.attributeValues.length
        ? h(
            "section",
            h("h4", "Other attribute constraints"),
            n.attributeValues.map((a) => h("div.attr-block", h("div.attr-name", a.attribute), a.values.map((v) => dataValue(v, n)))),
          )
        : null,
    ),
  ];
  d.replaceChildren(...sections.filter(Boolean));
}

function pathsSection(n, t) {
  const rows = [];
  rows.push(["Path in template", n.kind === "element" ? n.valuePath : n.path]);
  if (n.archetypeRootRef !== n.id) rows.push(["Path in archetype", n.kind === "element" ? n.archetypeValuePath : n.archetypePath]);
  const aql = aqlFor(n, t);
  return h(
    "section",
    h("h4", "AQL"),
    rows.map(([label, value]) => h("div.copy-row", h("div.copy-label", label), h("code.path", value), copyButton(value))),
    aql ? h("div.copy-row", h("div.copy-label", "Example query"), h("pre.aql", aql), copyButton(aql)) : null,
  );
}

function copyButton(text) {
  return h(
    "button.btn.small.copy",
    {
      type: "button",
      title: "Copy to clipboard",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = h("textarea", { style: "position:fixed;opacity:0" }, text);
          document.body.append(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        toast("Copied");
      },
    },
    "Copy",
  );
}

function dataValue(v, n) {
  const out = [h("div.dv-type", v.rmType, v.constraintType && !v.constraintType.startsWith("C_COMPLEX") ? h("span.muted", ` (${v.constraintType})`) : null)];
  if (v.property) out.push(h("p", "Property: ", h("strong", v.property.text || v.property.code), h("span.muted", ` (${v.property.terminology}::${v.property.code})`)));
  if (v.units) {
    out.push(
      v.units.length
        ? h(
            "table.mini",
            h("thead", h("tr", h("th", "Units"), h("th", "Magnitude"), h("th", "Precision"))),
            h(
              "tbody",
              v.units.map((u) =>
                h("tr", h("td.mono", u.units || "any"), h("td", u.magnitude ? formatRange(u.magnitude) : "any"), h("td", u.precision ? formatRange(u.precision) : "")),
              ),
            ),
          )
        : h("p.muted", "Any units."),
    );
  }
  if (v.codeSet) out.push(codeSet(v.codeSet, v));
  if (v.attributes) out.push(h("ul.attrs", v.attributes.map((a) => h("li", h("span.mono", a.attribute), ": ", a.constraint))));
  return h("div.dv", out);
}

function codeSet(cs, v) {
  if (cs.kind === "external") {
    const r = cs.reference || {};
    return h(
      "div.codeset.external",
      h("p", h("strong", "External value set"), r.terminology ? ` (${r.terminology})` : "", r.kind ? h("span.muted", ` – ${r.kind}`) : null),
      r.uri ? h("div.copy-row", h("div.copy-label", "referenceSetUri"), h("code.path", r.uri), copyButton(r.uri)) : null,
      r.valueSetUrl ? h("p", "ValueSet: ", h("code", r.valueSetUrl)) : null,
      r.ecl ? h("p", "ECL: ", h("code", r.ecl)) : null,
      cs.constraintRef ? h("p", "Constraint reference: ", h("code", cs.constraintRef.code), cs.constraintRef.text ? ` – ${cs.constraintRef.text}` : "") : null,
    );
  }
  if (cs.kind === "external-any") {
    return h("div.codeset.external", h("p", h("strong", "Any code from "), h("code", cs.terminology)));
  }
  const local = cs.kind === "local";
  const head = local
    ? `Local codes (${cs.codes.length})${cs.boundCount != null ? ` – ${cs.boundCount} bound` : ""}`
    : `Codes from ${cs.terminology} (${cs.codes.length})`;
  const hasOrdinal = cs.codes.some((c) => c.ordinal != null);
  return h(
    "div.codeset" + (local && !cs.boundCount ? ".local-only" : ""),
    h("p", h("strong", head)),
    h(
      "table.mini",
      h("thead", h("tr", hasOrdinal ? h("th", "Ordinal") : null, h("th", "Code"), h("th", "Text"), local ? h("th", "Bindings") : null)),
      h(
        "tbody",
        cs.codes.map((c) =>
          h(
            "tr",
            hasOrdinal ? h("td", c.ordinal) : null,
            h("td.mono", local ? c.code : codeLink(cs.terminology, c.code)),
            h("td", c.text ?? h("span.muted", "–")),
            local ? h("td", c.bindings?.length ? bindingPills(c.bindings) : h("span.muted", "none")) : null,
          ),
        ),
      ),
    ),
  );
}

function bindingList(bindings) {
  return h(
    "table.mini",
    h("thead", h("tr", h("th", "Terminology"), h("th", "Code"), h("th", "As written"))),
    h(
      "tbody",
      bindings.map((b) =>
        h(
          "tr",
          h("td", b.terminology, b.version ? h("span.flag.stamp", { title: "Version stamp" }, b.version) : null),
          h("td.mono", codeLink(b.family, b.code)),
          h("td.mono.muted", `${b.terminologyRaw} / ${b.codeRaw}`),
        ),
      ),
    ),
  );
}

/** Link a code to a public browser, for teaching. */
function codeLink(terminology, code) {
  const fam = terminology === "SNOMED CT" || /^SNOMED/i.test(terminology || "") ? "SNOMED CT" : /^(LOINC|LNC)/i.test(terminology || "") ? "LOINC" : null;
  let href = null;
  if (fam === "SNOMED CT" && /^\d+$/.test(code)) href = `https://browser.ihtsdotools.org/?perspective=full&conceptId1=${code}&edition=MAIN&languages=en`;
  if (fam === "LOINC" && /^\d+-\d$/.test(code)) href = `https://loinc.org/${code}/`;
  return href ? h("a", { href, target: "_blank", rel: "noopener noreferrer", title: `Open ${code} in the ${fam} browser` }, code) : code;
}

// ------------------------------------------------------------------ bindings table

function filteredBindings() {
  const t = state.t;
  const q = $("#bindings-search").value.trim().toLowerCase();
  const term = $("#bindings-terminology").value;
  const hideUnmatched = $("#bindings-hide-unmatched").checked;
  let rows = t.bindings.filter((b) => {
    if (hideUnmatched && b.targetKind === "unmatched") return false;
    if (term && b.family !== term) return false;
    if (q) {
      const hay = [b.archetypeId, b.path, b.target, b.text, b.terminologyRaw, b.code].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const { key, dir } = state.bindingsSort;
  if (key) rows = [...rows].sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? ""), undefined, { numeric: true }) * dir);
  return rows;
}

function renderBindingsTable() {
  const t = state.t;
  const sel = $("#bindings-terminology");
  const fams = [...new Set(t.bindings.map((b) => b.family))].sort();
  const prev = sel.value;
  sel.replaceChildren(h("option", { value: "" }, "All terminologies"), ...fams.map((f) => h("option", { value: f }, f)));
  if (fams.includes(prev)) sel.value = prev;

  const cols = [
    ["archetypeId", "Archetype"],
    ["archetypePath", "Path in archetype"],
    ["target", "Node/code"],
    ["text", "Text"],
    ["terminologyRaw", "Terminology"],
    ["code", "Code"],
  ];
  const table = $("#bindings-table");
  table.tHead.replaceChildren(
    h(
      "tr",
      cols.map(([k, label]) =>
        h(
          "th",
          { "aria-sort": state.bindingsSort.key === k ? (state.bindingsSort.dir > 0 ? "ascending" : "descending") : null },
          h(
            "button.sort",
            {
              type: "button",
              onclick: () => {
                const s = state.bindingsSort;
                state.bindingsSort = { key: k, dir: s.key === k ? -s.dir : 1 };
                renderBindingsTable();
              },
            },
            label,
            state.bindingsSort.key === k ? (state.bindingsSort.dir > 0 ? " ▲" : " ▼") : "",
          ),
        ),
      ),
    ),
  );
  const rows = filteredBindings();
  const body = table.tBodies[0];
  if (!rows.length) {
    body.replaceChildren(h("tr", h("td.muted", { colspan: cols.length }, t.bindings.length ? "No bindings match." : "This template has no terminology bindings.")));
    return;
  }
  body.replaceChildren(
    ...rows.map((b) =>
      h(
        "tr",
        { class: b.targetKind === "unmatched" ? "unmatched" : null },
        h("td.mono", { title: b.archetypeId }, shortArchetype(b.archetypeId)),
        h(
          "td.mono.path-cell",
          b.path
            ? h("button.linklike", { type: "button", title: `Show in tree: ${b.path}`, onclick: () => { showTab("tree"); setFilter(null); select(b.nodeRef); } }, b.archetypePath || b.path)
            : h("span.muted", { title: "The archetype binds this code, but the node is not part of this template" }, "not in this template"),
        ),
        h("td.mono", b.target.startsWith("/") ? h("span", { title: b.target }, "path") : b.target, b.targetKind === "value" ? h("span.tag", "value") : null),
        h("td", b.text ?? ""),
        h("td.nowrap", b.terminology, b.version ? h("span.flag.stamp", { title: `Written as ${b.terminologyRaw}` }, b.version) : null),
        h("td.mono", codeLink(b.family, b.code)),
      ),
    ),
  );
}

function exportCsv() {
  const csv = bindingsToCsv(filteredBindings());
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `${(state.t.templateId || "template").replace(/[^\w.-]+/g, "_")}-bindings.csv` });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

// ------------------------------------------------------------------ tabs, toast, wiring

function showTab(name) {
  for (const tab of ["tree", "bindings"]) {
    $(`#tab-${tab}`).setAttribute("aria-selected", String(tab === name));
    $(`#panel-${tab}`).hidden = tab !== name;
  }
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1400);
}

function wire() {
  $("#file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) {
      history.replaceState(null, "", "#explore");
      $("#sample-select").value = "";
      loadedSample = null;
      setMode("explore");
      load(await file.text(), file.name);
    }
    e.target.value = "";
  });

  // Drag-and-drop anywhere on the page.
  let depth = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (++depth === 1) document.body.classList.add("dragging");
  });
  window.addEventListener("dragleave", () => {
    if (--depth === 0) document.body.classList.remove("dragging");
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove("dragging");
    const file = e.dataTransfer.files[0];
    if (file) {
      history.replaceState(null, "", "#explore");
      $("#sample-select").value = "";
      loadedSample = null;
      setMode("explore");
      load(await file.text(), file.name);
    }
  });

  $("#tab-tree").addEventListener("click", () => showTab("tree"));
  $("#tab-bindings").addEventListener("click", () => showTab("bindings"));

  let searchTimer;
  $("#tree-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value;
      renderTree();
    }, 120);
  });
  try {
    state.tech = localStorage.getItem("explorerTech") === "1";
  } catch {}
  $("#show-tech").checked = state.tech;
  $("#show-tech").addEventListener("change", (e) => {
    state.tech = e.target.checked;
    try {
      localStorage.setItem("explorerTech", state.tech ? "1" : "0");
    } catch {}
    renderTree();
    if (state.selected) renderDetail(state.byId.get(state.selected));
  });
  $("#show-structure").addEventListener("change", (e) => {
    state.showStructure = e.target.checked;
    renderTree();
  });
  $("#show-slots").addEventListener("change", (e) => {
    state.showSlots = e.target.checked;
    renderTree();
  });
  $("#expand-all").addEventListener("click", () => {
    state.collapsed.clear();
    renderTree();
  });
  $("#collapse-all").addEventListener("click", () => {
    state.collapsed = new Set(state.t.nodes.filter((n) => n.children.length && n !== state.t.root && n.kind === "archetype_root").map((n) => n.id));
    renderTree();
  });
  $("#bindings-search").addEventListener("input", renderBindingsTable);
  $("#bindings-terminology").addEventListener("change", renderBindingsTable);
  $("#bindings-hide-unmatched").addEventListener("change", renderBindingsTable);
  $("#export-csv").addEventListener("click", exportCsv);
}

wire();
initExamples({ openInExplorer });
window.addEventListener("hashchange", route);
loadSamples().then(route);

// Exposed for debugging in the console.
window.templateExplorer = { state, load };
