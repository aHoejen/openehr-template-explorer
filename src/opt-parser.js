// openEHR Operational Template (OPT 1.4 XML) parser.
//
// Environment-neutral: takes an XML string plus a DOMParser implementation, so it
// runs in the browser (window.DOMParser) and in Node (@xmldom/xmldom) for tests.
// Only DOM Level 2 APIs are used (childNodes, localName, getAttribute, textContent).

import { OPENEHR_TERMS } from "./openehr-terms.js";

const XSI = "http://www.w3.org/2001/XMLSchema-instance";

// ---------------------------------------------------------------- DOM helpers

function elements(el) {
  const out = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n);
  return out;
}
const lname = (el) => el.localName || el.nodeName.replace(/^.*:/, "");
const kids = (el, name) => elements(el).filter((c) => lname(c) === name);
const kid = (el, name) => elements(el).find((c) => lname(c) === name) || null;
function at(el, ...path) {
  let cur = el;
  for (const p of path) { cur = kid(cur, p); if (!cur) return null; }
  return cur;
}
const text = (el) => (el ? el.textContent.trim() : "");
const textAt = (el, ...path) => text(at(el, ...path));
function xsiType(el) {
  const t = (el.getAttributeNS && el.getAttributeNS(XSI, "type")) || el.getAttribute("xsi:type") || "";
  return t.replace(/^.*:/, "");
}

// ---------------------------------------------------------------- intervals

/** Parse an openEHR interval element (occurrences, existence, magnitude, …). */
export function parseInterval(el) {
  if (!el) return null;
  const num = (name) => {
    const t = textAt(el, name);
    return t === "" ? null : Number(t);
  };
  const raw = (name) => textAt(el, name);
  const lowerUnbounded = raw("lower_unbounded") === "true";
  const upperUnbounded = raw("upper_unbounded") === "true";
  return {
    lower: lowerUnbounded ? null : num("lower"),
    upper: upperUnbounded ? null : num("upper"),
    lowerIncluded: raw("lower_included") !== "false",
    upperIncluded: raw("upper_included") !== "false",
  };
}

/** "0..1", "1..*", "0..0" — the ADL style used in teaching material. */
export function formatOccurrences(iv) {
  if (!iv) return "";
  const lo = iv.lower ?? 0;
  const hi = iv.upper ?? "*";
  return `${lo}..${hi}`;
}

/** "0..<100", ">=0", "|36.0..42.0|" style text for numeric ranges. */
export function formatRange(iv) {
  if (!iv) return "";
  const { lower, upper, lowerIncluded, upperIncluded } = iv;
  if (lower == null && upper == null) return "any";
  if (lower != null && upper != null) {
    if (lower === upper && lowerIncluded && upperIncluded) return `${lower}`;
    return `${lowerIncluded ? "" : ">"}${lower}..${upperIncluded ? "" : "<"}${upper}`;
  }
  if (lower != null) return `${lowerIncluded ? ">=" : ">"}${lower}`;
  return `${upperIncluded ? "<=" : "<"}${upper}`;
}

// ---------------------------------------------------------------- codes and bindings

/**
 * Normalise a binding's terminology id + code string.
 * Handles "SNOMED-CT" + "364090009", "SNOMED-CT(2003)" + "364090009",
 * "SNOMED-CT" + "[SNOMED-CT(2003)::364090009]" and URI forms such as
 * "http://snomed.info/id/364090009".
 */
export function normaliseBinding(terminologyIdRaw, codeStringRaw) {
  let terminologyId = (terminologyIdRaw || "").trim();
  let code = (codeStringRaw || "").trim();
  const bracketed = code.match(/^\[?([^\]:]+?)::([^\]]+)\]?$/);
  if (bracketed) {
    terminologyId = bracketed[1].trim();
    code = bracketed[2].trim();
  }
  const uri = code.match(/^https?:\/\/snomed\.info\/id\/(\d+)$/) || code.match(/^https?:\/\/snomed\.info\/sct\/(\d+)$/);
  if (uri) code = uri[1];
  const loinc = code.match(/^https?:\/\/loinc\.org\/(?:rdf\/)?([\w-]+)\/?$/);
  if (loinc) code = loinc[1];
  const v = terminologyId.match(/^(.*?)\(([^)]*)\)$/);
  const terminology = v ? v[1].trim() : terminologyId;
  const version = v ? v[2].trim() : null;
  return {
    terminology,
    terminologyRaw: terminologyId,
    version,
    code,
    codeRaw: (codeStringRaw || "").trim(),
    family: terminologyFamily(terminology),
  };
}

/** Group common spellings of the same terminology. */
export function terminologyFamily(t) {
  const s = (t || "").toUpperCase().replace(/[\s_]/g, "-");
  if (/^SNOMED/.test(s) || s === "SCT" || s.includes("SNOMED.INFO")) return "SNOMED CT";
  if (/^(LOINC|LNC)/.test(s) || s.includes("LOINC.ORG")) return "LOINC";
  if (/^ICD-?10/.test(s)) return "ICD-10";
  if (/^ICD-?11/.test(s)) return "ICD-11";
  if (s === "LOCAL") return "local";
  if (s === "OPENEHR") return "openehr";
  return t || "";
}

const isAtCode = (c) => /^at\d+(\.\d+)*$/.test(c);

/** Describe an external value-set reference URI for display. */
export function describeReferenceSetUri(uri) {
  const u = uri || "";
  const out = { uri: u, kind: "terminology reference", terminology: null, valueSetUrl: null, ecl: null };
  const fhir = u.match(/ValueSet\/\$expand\?url=(.+)$/);
  if (fhir) {
    out.kind = "FHIR ValueSet";
    out.valueSetUrl = decodeURIComponent(fhir[1]);
    const ecl = out.valueSetUrl.match(/fhir_vs=ecl\/(.+)$/);
    if (ecl) { out.ecl = decodeURIComponent(ecl[1]); out.terminology = "SNOMED CT"; }
    else if (/snomed\.info/.test(out.valueSetUrl)) out.terminology = "SNOMED CT";
    else if (/loinc\.org/.test(out.valueSetUrl)) out.terminology = "LOINC";
    return out;
  }
  const t = u.match(/^terminology:(?:\/\/)?([^?/]+(?:\/\/[^?]+)?)(?:\?(.*))?$/);
  if (t) {
    out.terminology = terminologyFamily(t[1]);
    if (t[2]) out.query = t[2];
  }
  return out;
}

// ---------------------------------------------------------------- data value constraints

const DV_LIKE = /^(DV_|CODE_PHRASE$|TERMINOLOGY_ID$|PARTY_|PARTICIPATION$)/;

function primitiveSummary(item) {
  if (!item) return "";
  const type = xsiType(item);
  switch (type) {
    case "C_STRING": {
      const list = kids(item, "list").map(text);
      if (list.length) return list.map((s) => `"${s}"`).join(" | ");
      const p = textAt(item, "pattern");
      return p ? `matches /${p}/` : "any string";
    }
    case "C_INTEGER":
    case "C_REAL": {
      const list = kids(item, "list").map(text);
      if (list.length) return list.join(" | ");
      return formatRange(parseInterval(kid(item, "range")));
    }
    case "C_BOOLEAN": {
      const t = textAt(item, "true_valid") === "true";
      const f = textAt(item, "false_valid") === "true";
      return t && f ? "true | false" : t ? "true" : f ? "false" : "";
    }
    case "C_DATE":
    case "C_TIME":
    case "C_DATE_TIME":
      return textAt(item, "pattern") || "any";
    case "C_DURATION": {
      const p = textAt(item, "pattern");
      const r = kid(item, "range");
      const parts = [];
      if (p) parts.push(`pattern ${p}`);
      if (r) parts.push(formatRange(parseInterval(r)));
      return parts.join(", ") || "any";
    }
    default:
      return type;
  }
}

/** Primitive constraints on attributes of a DV object (e.g. DV_COUNT.magnitude). */
function attributeConstraints(obj) {
  const out = [];
  for (const attr of kids(obj, "attributes")) {
    const name = textAt(attr, "rm_attribute_name");
    for (const child of kids(attr, "children")) {
      if (xsiType(child) === "C_PRIMITIVE_OBJECT") {
        out.push({ attribute: name, constraint: primitiveSummary(kid(child, "item")) });
      } else {
        const nested = attributeConstraints(child);
        for (const n of nested) out.push({ attribute: `${name}/${n.attribute}`, constraint: n.constraint });
        if (!nested.length) out.push({ attribute: name, constraint: textAt(child, "rm_type_name") });
      }
    }
  }
  return out;
}

function parseCodePhrase(cp, ctx) {
  const type = xsiType(cp);
  if (type === "C_CODE_REFERENCE" || kid(cp, "referenceSetUri")) {
    return {
      kind: "external",
      terminology: textAt(cp, "terminology_id", "value") || null,
      reference: describeReferenceSetUri(textAt(cp, "referenceSetUri")),
      codes: [],
    };
  }
  const terminology = textAt(cp, "terminology_id", "value");
  const codes = kids(cp, "code_list").map(text).filter(Boolean);
  const local = terminology === "local";
  return {
    kind: local ? "local" : codes.length ? "external-list" : "external-any",
    terminology,
    codes: codes.map((code) => {
      const c = { code, text: null };
      if (local) {
        const def = ctx.terms.get(code);
        c.text = def?.text ?? null;
        c.description = def?.description ?? null;
      } else if (terminology === "openehr") {
        c.text = OPENEHR_TERMS[code]?.rubric ?? null;
      }
      return c;
    }),
  };
}

/** Turn one DV-ish C_OBJECT into a plain description. */
function parseDataValue(obj, ctx) {
  const xtype = xsiType(obj);
  const rmType = textAt(obj, "rm_type_name");
  const dv = { rmType, constraintType: xtype };

  if (xtype === "C_DV_QUANTITY") {
    const prop = kid(obj, "property");
    if (prop) {
      const code = textAt(prop, "code_string");
      dv.property = { terminology: textAt(prop, "terminology_id", "value"), code, text: OPENEHR_TERMS[code]?.rubric ?? null };
    }
    dv.units = kids(obj, "list").map((item) => ({
      units: textAt(item, "units"),
      magnitude: kid(item, "magnitude") ? parseInterval(kid(item, "magnitude")) : null,
      precision: kid(item, "precision") ? parseInterval(kid(item, "precision")) : null,
    }));
    return dv;
  }

  if (xtype === "C_DV_ORDINAL") {
    dv.ordinals = kids(obj, "list").map((item) => {
      const sym = kid(item, "symbol");
      const code = textAt(sym, "code_string");
      const terminology = textAt(sym, "terminology_id", "value");
      const def = terminology === "local" ? ctx.terms.get(code) : null;
      return { value: Number(textAt(item, "value")), code, terminology, text: def?.text ?? null, description: def?.description ?? null };
    });
    dv.codeSet = { kind: "local", terminology: "local", codes: dv.ordinals.map((o) => ({ code: o.code, text: o.text, ordinal: o.value })) };
    return dv;
  }

  if (xtype === "C_CODE_PHRASE" || xtype === "C_CODE_REFERENCE") {
    dv.codeSet = parseCodePhrase(obj, ctx);
    return dv;
  }

  // C_COMPLEX_OBJECT DV_* (DV_CODED_TEXT, DV_TEXT, DV_COUNT, DV_BOOLEAN, …)
  for (const attr of kids(obj, "attributes")) {
    const name = textAt(attr, "rm_attribute_name");
    if (name === "defining_code") {
      const options = kids(attr, "children");
      const ref = options.find((c) => xsiType(c) === "CONSTRAINT_REF");
      const cp = options.find((c) => xsiType(c) !== "CONSTRAINT_REF");
      if (cp) dv.codeSet = parseCodePhrase(cp, ctx);
      if (ref) {
        const code = textAt(ref, "reference");
        const def = ctx.constraints?.get(code);
        dv.codeSet ||= { kind: "external", terminology: null, codes: [], reference: { uri: null, kind: "constraint reference", terminology: null } };
        dv.codeSet.constraintRef = { code, text: def?.text ?? null, description: def?.description ?? null };
      }
    }
  }
  const prims = attributeConstraints(obj).filter((p) => !p.attribute.startsWith("defining_code"));
  if (prims.length) dv.attributes = prims;
  return dv;
}

// ---------------------------------------------------------------- tree

function readTerms(root, element = "term_definitions") {
  const terms = new Map();
  for (const td of kids(root, element)) {
    const entry = {};
    for (const item of kids(td, "items")) entry[item.getAttribute("id")] = text(item);
    terms.set(td.getAttribute("code"), entry);
  }
  return terms;
}

function readBindings(root) {
  const out = [];
  for (const tb of kids(root, "term_bindings")) {
    const declared = tb.getAttribute("terminology");
    for (const item of kids(tb, "items")) {
      const value = kid(item, "value");
      const b = normaliseBinding(textAt(value, "terminology_id", "value") || declared, textAt(value, "code_string"));
      b.declaredTerminology = declared;
      b.target = item.getAttribute("code");
      out.push(b);
    }
  }
  return out;
}

/** Template-level rename: ELEMENT.name constrained to a single DV_TEXT value. */
function readNameConstraint(obj, ctx) {
  for (const attr of kids(obj, "attributes")) {
    if (textAt(attr, "rm_attribute_name") !== "name") continue;
    for (const child of kids(attr, "children")) {
      const rm = textAt(child, "rm_type_name");
      if (rm === "DV_CODED_TEXT") {
        const dv = parseDataValue(child, ctx);
        const c = dv.codeSet?.codes?.[0];
        if (c) return c.text || c.code;
      }
      for (const a of kids(child, "attributes")) {
        if (textAt(a, "rm_attribute_name") !== "value") continue;
        const item = at(kids(a, "children")[0], "item");
        const list = item ? kids(item, "list").map(text) : [];
        if (list.length === 1) return list[0];
      }
    }
  }
  return null;
}

function slotInfo(obj) {
  const collect = (name) =>
    kids(obj, name).map((assertion) => {
      const found = assertion.getElementsByTagNameNS("*", "pattern");
      const pattern = [];
      for (let i = 0; i < found.length; i++) pattern.push(text(found[i]));
      return pattern.join(" | ") || text(assertion).replace(/\s+/g, " ");
    });
  return { includes: collect("includes"), excludes: collect("excludes") };
}

function pathSegment(attrName, node) {
  const key = node.archetypeId || node.nodeId;
  if (!key) return `/${attrName}`;
  if (node.namePredicate) return `/${attrName}[${key},'${node.namePredicate.replace(/'/g, "\\'")}']`;
  return `/${attrName}[${key}]`;
}

/**
 * Parse an OPT 1.4 XML string.
 * @param {string} xml
 * @param {{ DOMParser: typeof DOMParser }} [env]
 */
export function parseOpt(xml, env = {}) {
  const Parser = env.DOMParser || globalThis.DOMParser;
  if (!Parser) throw new Error("No DOMParser available");
  const doc = new Parser().parseFromString(String(xml).replace(/^\uFEFF/, ""), "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error("Not well-formed XML: " + text(err).slice(0, 200));
  const tpl = doc.documentElement;
  if (!tpl || lname(tpl) !== "template") {
    throw new Error(`Expected an OPT 1.4 <template> root element, found <${tpl ? lname(tpl) : "nothing"}>`);
  }
  const definition = kid(tpl, "definition");
  if (!definition) throw new Error("OPT has no <definition> element");

  const template = {
    templateId: textAt(tpl, "template_id", "value"),
    uid: textAt(tpl, "uid", "value") || null,
    concept: textAt(tpl, "concept"),
    language: textAt(tpl, "language", "code_string"),
    purpose: textAt(tpl, "description", "details", "purpose") || null,
    archetypes: [],
    bindings: [],
    nodes: [],
    root: null,
  };

  let seq = 0;
  const allNodes = template.nodes;

  /** Walk one C_OBJECT that becomes a tree node. */
  function walkNode(obj, ctx, parent, attrName, attrInfo) {
    const xtype = xsiType(obj) || "C_ARCHETYPE_ROOT"; // <definition> carries no xsi:type in some exports
    const isRoot = xtype === "C_ARCHETYPE_ROOT";
    let nodeCtx = ctx;
    const node = {
      id: `n${seq++}`,
      rmType: textAt(obj, "rm_type_name"),
      constraintType: xtype,
      nodeId: textAt(obj, "node_id") || null,
      archetypeId: null,
      occurrences: parseInterval(kid(obj, "occurrences")),
      rmAttribute: attrName,
      attribute: attrInfo,
      children: [],
      values: [],
      attributeValues: [],
      bindings: [],
      parentId: parent ? parent.id : null,
      depth: parent ? parent.depth + 1 : 0,
    };

    if (isRoot) {
      node.archetypeId = textAt(obj, "archetype_id", "value");
      const terms = readTerms(obj);
      const archetype = {
        archetypeId: node.archetypeId,
        nodeRef: node.id,
        terms,
        bindings: readBindings(obj),
      };
      template.archetypes.push(archetype);
      nodeCtx = { terms, constraints: readTerms(obj, "constraint_definitions"), archetype, archetypeNode: node };
    }

    const def = nodeCtx.terms.get(node.nodeId) || null;
    node.archetypeText = def?.text ?? null;
    node.description = def?.description ?? null;
    node.comment = def?.comment ?? null;
    node.templateName = readNameConstraint(obj, nodeCtx);
    node.name = node.templateName || node.archetypeText || node.archetypeId || node.rmType;
    node.archetypeRootId = nodeCtx.archetype?.archetypeId ?? null;
    node.archetypeRootRef = nodeCtx.archetypeNode?.id ?? null;
    node.removed = node.occurrences?.upper === 0;
    node.kind = isRoot ? "archetype_root" : xtype === "ARCHETYPE_SLOT" ? "slot" : node.rmType === "ELEMENT" ? "element" : "structure";
    if (node.kind === "slot") node.slot = slotInfo(obj);

    allNodes.push(node);
    return { node, nodeCtx };
  }

  function computePaths(node, parent) {
    if (!parent) {
      node.path = "/";
      node.archetypePath = "/";
    } else {
      const seg = pathSegment(node.rmAttribute, node);
      node.path = (parent.path === "/" ? "" : parent.path) + seg;
      if (node.kind === "archetype_root") {
        node.archetypePath = "/";
      } else {
        const base = parent.archetypePath === "/" ? "" : parent.archetypePath;
        node.archetypePath = base + seg;
      }
    }
    if (node.kind === "element") {
      node.valuePath = node.path + "/value";
      node.archetypeValuePath = node.archetypePath + "/value";
    }
    for (const c of node.children) computePaths(c, node);
  }

  function walkAttributes(obj, node, ctx) {
    for (const attr of kids(obj, "attributes")) {
      const attrName = textAt(attr, "rm_attribute_name");
      if (attrName === "name") continue; // handled as template rename
      const multiple = xsiType(attr) === "C_MULTIPLE_ATTRIBUTE";
      const attrInfo = {
        name: attrName,
        multiple,
        existence: parseInterval(kid(attr, "existence")),
        cardinality: multiple ? parseInterval(at(attr, "cardinality", "interval")) : null,
      };
      const children = kids(attr, "children");
      const dvKids = [];
      const structKids = [];
      for (const c of children) {
        const rm = textAt(c, "rm_type_name");
        const x = xsiType(c);
        const hasId = !!textAt(c, "node_id");
        if (x === "C_ARCHETYPE_ROOT" || x === "ARCHETYPE_SLOT" || (hasId && !DV_LIKE.test(rm)) || (!DV_LIKE.test(rm) && x === "C_COMPLEX_OBJECT")) {
          structKids.push(c);
        } else if (x !== "C_PRIMITIVE_OBJECT") {
          dvKids.push(c);
        }
      }
      if (dvKids.length) {
        const parsed = dvKids.map((c) => parseDataValue(c, ctx));
        if (node.kind === "element" && attrName === "value") node.values.push(...parsed);
        else if (attrName !== "null_flavour") node.attributeValues.push({ attribute: attrName, values: parsed });
      }
      const created = [];
      for (const c of structKids) {
        const { node: child, nodeCtx } = walkNode(c, ctx, node, attrName, attrInfo);
        node.children.push(child);
        created.push(child);
        if (child.kind !== "slot") walkAttributes(c, child, nodeCtx);
      }
      // Same at-code used for several siblings (template clones): disambiguate by name.
      const byKey = new Map();
      for (const c of created) {
        const k = c.archetypeId || c.nodeId;
        if (!k) continue;
        byKey.set(k, (byKey.get(k) || 0) + 1);
      }
      for (const c of created) {
        const k = c.archetypeId || c.nodeId;
        if (k && byKey.get(k) > 1) c.namePredicate = c.name;
      }
    }
  }

  const { node: root, nodeCtx } = walkNode(definition, { terms: new Map() }, null, null, null);
  walkAttributes(definition, root, nodeCtx);
  computePaths(root, null);
  template.root = root;

  attachBindings(template);
  computeFindings(template);
  return template;
}

// ---------------------------------------------------------------- bindings

function attachBindings(template) {
  const byRoot = new Map();
  for (const n of template.nodes) {
    if (!n.archetypeRootRef) continue;
    if (!byRoot.has(n.archetypeRootRef)) byRoot.set(n.archetypeRootRef, []);
    byRoot.get(n.archetypeRootRef).push(n);
  }
  const nodeById = new Map(template.nodes.map((n) => [n.id, n]));

  for (const arch of template.archetypes) {
    const rootNode = nodeById.get(arch.nodeRef);
    const members = byRoot.get(arch.nodeRef) || [];
    for (const b of arch.bindings) {
      const targets = [];
      const isPath = b.target.startsWith("/");
      for (const n of members) {
        // A node belongs to the archetype whose root is nearest; the archetype root node
        // itself belongs to its own archetype (archetypeRootRef === its id).
        const nodeMatches = isPath
          ? n.archetypePath === b.target || n.archetypePath.replace(/,'(?:[^'\\]|\\.)*'\]/g, "]") === b.target
          : n.nodeId === b.target;
        if (nodeMatches) targets.push({ kind: "node", node: n });
        if (!isPath && isAtCode(b.target)) {
          for (const coll of [n.values, ...n.attributeValues.map((a) => a.values)]) {
            for (const dv of coll) {
              const cs = dv.codeSet;
              if (cs?.terminology !== "local") continue;
              const code = cs.codes.find((c) => c.code === b.target);
              if (code) targets.push({ kind: "value", node: n, code });
            }
          }
        }
      }
      if (!targets.length) {
        template.bindings.push(makeRow(arch, b, null, "unmatched", rootNode));
        continue;
      }
      for (const t of targets) {
        const row = makeRow(arch, b, t.node, t.kind, rootNode, t.code);
        template.bindings.push(row);
        if (t.kind === "node") t.node.bindings.push(row);
        else (t.code.bindings ||= []).push(row);
      }
    }
  }
}

function makeRow(arch, b, node, kind, rootNode, code) {
  const text = kind === "value" ? code.text : node ? node.name : arch.terms.get(b.target)?.text ?? null;
  let path = node ? node.path : null;
  if (kind === "value" && node) path = (node.valuePath || node.path) + "/defining_code";
  return {
    archetypeId: arch.archetypeId,
    archetypeNodeRef: rootNode?.id ?? null,
    nodeRef: node ? node.id : null,
    path,
    archetypePath: node ? (kind === "value" ? (node.archetypeValuePath || node.archetypePath) + "/defining_code" : node.archetypePath) : null,
    target: b.target,
    targetKind: kind, // node | value | unmatched
    text,
    terminology: b.terminology,
    terminologyRaw: b.terminologyRaw,
    family: b.family,
    version: b.version,
    code: b.code,
    codeRaw: b.codeRaw,
  };
}

// ---------------------------------------------------------------- teaching findings

function computeFindings(template) {
  const f = {
    elements: 0,
    elementsBound: 0,
    unboundElements: [],
    localOnlyValueSets: [],
    partlyBoundValueSets: [],
    externalValueSets: [],
    versionStamped: 0,
    removed: [],
    slots: [],
    unmatchedBindings: [],
  };
  for (const n of template.nodes) {
    if (n.removed) f.removed.push(n.id);
    if (n.kind === "slot") f.slots.push(n.id);
    if (n.kind === "element" && !n.removed) {
      f.elements++;
      if (n.bindings.length) f.elementsBound++;
      else f.unboundElements.push(n.id);
    }
    for (const dv of n.values) {
      const cs = dv.codeSet;
      if (!cs) continue;
      if (cs.kind === "local" && cs.codes.length) {
        const bound = cs.codes.filter((c) => c.bindings?.length).length;
        cs.boundCount = bound;
        if (bound === 0) f.localOnlyValueSets.push(n.id);
        else if (bound < cs.codes.length) f.partlyBoundValueSets.push(n.id);
      } else if (cs.kind === "external" || cs.kind === "external-any" || cs.kind === "external-list") {
        f.externalValueSets.push(n.id);
      }
    }
  }
  f.versionStamped = template.bindings.filter((b) => b.version).length;
  f.unmatchedBindings = template.bindings.filter((b) => b.targetKind === "unmatched").length;
  template.findings = f;
}

// ---------------------------------------------------------------- export helpers

export const BINDING_COLUMNS = [
  ["archetypeId", "Archetype"],
  ["path", "Path in template"],
  ["archetypePath", "Path in archetype"],
  ["target", "Node/code"],
  ["targetKind", "Bound to"],
  ["text", "Text"],
  ["terminologyRaw", "Terminology"],
  ["code", "Code"],
  ["version", "Version stamp"],
];

/** RFC 4180 CSV for the bindings table. */
export function bindingsToCsv(rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [BINDING_COLUMNS.map(([, h]) => esc(h)).join(",")];
  for (const r of rows) lines.push(BINDING_COLUMNS.map(([k]) => esc(r[k])).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Example AQL query selecting this node, scoped by its nearest archetype root. */
export function aqlFor(node, template) {
  const archNode = template.nodes.find((n) => n.id === node.archetypeRootRef);
  if (!archNode) return null;
  const rm = archNode.rmType;
  const alias = { COMPOSITION: "c", OBSERVATION: "o", EVALUATION: "e", INSTRUCTION: "i", ACTION: "a", SECTION: "s", CLUSTER: "cl", ADMIN_ENTRY: "ad" }[rm] || "x";
  const rel = node.kind === "element" ? node.archetypeValuePath : node.archetypePath;
  const select = rel === "/" ? alias : `${alias}${rel}`;
  const from =
    rm === "COMPOSITION"
      ? `EHR e CONTAINS COMPOSITION ${alias}[${archNode.archetypeId}]`
      : `EHR e CONTAINS COMPOSITION c CONTAINS ${rm} ${alias}[${archNode.archetypeId}]`;
  return `SELECT ${select}\nFROM ${from}`;
}
