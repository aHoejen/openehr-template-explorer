// Render JSON as an indented DOM tree. Nodes whose JSON pointer appears in
// `pointerToLinks` get a `data-links` attribute so the example view can
// highlight and click them.

/**
 * @param {unknown} json
 * @param {Map<string, string[]>} pointerToLinks  pointer -> link ids
 * @param {(linkId: string) => void} onPick
 */
export function renderJson(json, pointerToLinks, onPick) {
  const pre = document.createElement("pre");
  pre.className = "json";
  pre.append(node(json, "", 0, null, false));
  pre.addEventListener("click", (e) => {
    const el = e.target.closest("[data-links]");
    if (el && pre.contains(el)) onPick(el.dataset.links.split(" ")[0]);
  });
  return pre;

  function node(value, ptr, depth, key, last) {
    const line = document.createElement("span");
    line.className = "jl";
    const links = pointerToLinks.get(ptr);
    if (links) {
      line.dataset.links = links.join(" ");
      line.classList.add("linked");
      line.title = "Click to follow this item across openEHR, SNOMED CT and FHIR";
    }
    const indent = "  ".repeat(depth);
    const comma = last ? "" : ",";
    const keyPart = key != null ? [span("jk", JSON.stringify(key)), ": "] : [];

    if (value && typeof value === "object") {
      const isArr = Array.isArray(value);
      const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value);
      const [open, close] = isArr ? ["[", "]"] : ["{", "}"];
      if (!entries.length) {
        line.append(indent, ...keyPart, open + close + comma, "\n");
        return line;
      }
      line.append(indent, ...keyPart, open, "\n");
      entries.forEach(([k, v], i) => {
        const childPtr = `${ptr}/${String(k).replace(/~/g, "~0").replace(/\//g, "~1")}`;
        line.append(node(v, childPtr, depth + 1, isArr ? null : k, i === entries.length - 1));
      });
      line.append(indent, close + comma, "\n");
      return line;
    }
    const cls = typeof value === "string" ? "js" : typeof value === "number" ? "jn" : "jb";
    line.append(indent, ...keyPart, span(cls, JSON.stringify(value)), comma, "\n");
    return line;
  }

  function span(cls, text) {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = text;
    return s;
  }
}

/** Invert link -> pointers into pointer -> links. */
export function invert(linkPointers) {
  const out = new Map();
  for (const [id, ptrs] of linkPointers) {
    for (const p of ptrs) {
      if (!out.has(p)) out.set(p, []);
      out.get(p).push(id);
    }
  }
  return out;
}
