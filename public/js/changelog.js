// /changelog/'s filter: show one part (Web, iPhone, Playdate, Engine, Notation) or
// everything. Without this script every entry shows and the buttons stay hidden. The
// choice is in the address (?part=engine), so a link can open one part.
const bar = document.querySelector("[data-filter]");
if (bar) {
  const buttons = [...bar.querySelectorAll("button[data-part]")];
  const entries = [...document.querySelectorAll(".change[data-part]")];
  const days = [...document.querySelectorAll(".change-day")];
  const known = new Set(buttons.map((b) => b.dataset.part));
  const show = (part, push) => {
    if (!known.has(part)) part = "";
    for (const b of buttons)
      b.setAttribute("aria-pressed", String(b.dataset.part === part));
    for (const e of entries) e.hidden = part !== "" && e.dataset.part !== part;
    for (const d of days)
      d.hidden = !d.querySelector(".change[data-part]:not([hidden])");
    if (push) {
      const url = new URL(location.href);
      if (part) url.searchParams.set("part", part);
      else url.searchParams.delete("part");
      history.replaceState(null, "", url);
    }
  };
  for (const b of buttons)
    b.addEventListener("click", () => show(b.dataset.part, true));
  bar.hidden = false;
  show(new URL(location.href).searchParams.get("part") ?? "", false);
}
