import vitalSigns from "./vital-signs.js";
import diagnosis from "./diagnosis.js";
import allergy from "./allergy.js";

export const EXAMPLES = [vitalSigns, diagnosis, allergy];

/**
 * Strip `_link` markers from a JSON value and record the JSON pointer of each
 * marked node: returns { json, pointers: Map<linkId, string[]> }.
 */
export function extractLinks(value) {
  const pointers = new Map();
  const add = (id, ptr) => {
    if (!pointers.has(id)) pointers.set(id, []);
    pointers.get(id).push(ptr);
  };
  const walk = (v, ptr) => {
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${ptr}/${i}`));
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === "_link") {
          for (const id of [].concat(x)) add(id, ptr || "");
          continue;
        }
        out[k] = walk(x, `${ptr}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`);
      }
      return out;
    }
    return v;
  };
  return { json: walk(value, ""), pointers };
}

/** Prepare an example: clean JSON plus pointer maps for both sides. */
export function prepare(example) {
  const o = extractLinks(example.openehr);
  const f = extractLinks(example.fhir);
  for (const l of example.links) for (const p of l.fhirPointers || []) {
    if (!f.pointers.has(l.id)) f.pointers.set(l.id, []);
    f.pointers.get(l.id).push(p);
  }
  return { ...example, openehrJson: o.json, fhirJson: f.json, openehrPointers: o.pointers, fhirPointers: f.pointers };
}

/** Resolve a JSON pointer ("" = whole document). */
export function resolvePointer(json, ptr) {
  if (ptr === "") return json;
  let cur = json;
  for (const raw of ptr.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (cur == null || !(key in Object(cur))) return undefined;
    cur = cur[key];
  }
  return cur;
}
