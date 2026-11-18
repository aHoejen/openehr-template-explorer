// A small "ⓘ" button that opens an explanatory popup next to it.
// One popup at a time; closes on Escape, outside click or its close button,
// and returns focus to the button. On narrow screens it shows as a bottom sheet.

let open = null; // { pop, anchor }

function close() {
  if (!open) return;
  const { pop, anchor } = open;
  open = null;
  pop.remove();
  anchor.setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", onKey, true);
  document.removeEventListener("mousedown", onOutside, true);
  window.removeEventListener("resize", close);
  anchor.focus({ preventScroll: true });
}

function onKey(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    close();
  }
}

function onOutside(e) {
  if (open && !open.pop.contains(e.target) && !open.anchor.contains(e.target)) close();
}

function position(pop, anchor) {
  if (window.innerWidth < 640) {
    pop.classList.add("sheet");
    return;
  }
  const r = anchor.getBoundingClientRect();
  const width = Math.min(460, window.innerWidth - 32);
  pop.style.width = `${width}px`;
  const left = Math.max(16, Math.min(r.left - 12, window.innerWidth - width - 16));
  pop.style.left = `${left + window.scrollX}px`;
  const below = r.bottom + 8;
  pop.style.top = `${below + window.scrollY}px`;
  const h = pop.offsetHeight;
  if (below + h > window.innerHeight - 8 && r.top - h - 8 > 8) pop.style.top = `${r.top - h - 8 + window.scrollY}px`;
}

/** Open a popup for `anchor` with a title and content nodes. */
export function openInfo(anchor, title, content) {
  const same = open && open.anchor === anchor;
  close();
  if (same) return;
  const pop = document.createElement("div");
  pop.className = "info-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", title);
  pop.tabIndex = -1;
  const head = document.createElement("div");
  head.className = "info-pop-head";
  const h = document.createElement("strong");
  h.textContent = title;
  const x = document.createElement("button");
  x.type = "button";
  x.className = "info-pop-close";
  x.setAttribute("aria-label", "Close");
  x.textContent = "×";
  x.addEventListener("click", close);
  head.append(h, x);
  const body = document.createElement("div");
  body.className = "info-pop-body";
  body.append(...[].concat(content).flat(Infinity).filter((c) => c != null && c !== false));
  pop.append(head, body);
  document.body.append(pop);
  position(pop, anchor);
  anchor.setAttribute("aria-expanded", "true");
  open = { pop, anchor };
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", onOutside, true);
  window.addEventListener("resize", close);
  pop.focus({ preventScroll: true });
}

/** An "ⓘ" button; `build()` returns the popup content when it is opened. */
export function infoButton(title, build, label = `More about ${title}`) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "info-btn";
  b.setAttribute("aria-label", label);
  b.setAttribute("aria-haspopup", "dialog");
  b.setAttribute("aria-expanded", "false");
  b.title = label;
  const i = document.createElement("span");
  i.className = "material-symbols-outlined";
  i.setAttribute("aria-hidden", "true");
  i.textContent = "info";
  b.append(i);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    openInfo(b, title, build());
  });
  return b;
}

export { close as closeInfo };
