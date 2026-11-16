// A small element builder: h("div.card.wide", { onclick }, "text", child).
// The tag may carry classes after dots. Attributes starting with "on" are
// listeners; "dataset" and "style" take objects; null children are skipped.
export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.className = classes.join(" ");
  if (
    attrs &&
    (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))
  ) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function")
      el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "style") Object.assign(el.style, v);
    else if (k === "class") el.className += (el.className ? " " : "") + v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

// A button in the game's look. kind: "" | "small" | "go" | "plain".
export function button(label, onclick, kind = "", attrs = {}) {
  return h(
    `button.btn${kind ? "." + kind.split(" ").join(".") : ""}`,
    { type: "button", onclick, ...attrs },
    label,
  );
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}
