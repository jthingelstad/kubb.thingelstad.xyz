// The home page's Open games list (src/site/pages.mjs): pitches whose host made them
// open, newest first, from the pitch server's GET /open (backend/pitch-server/PROTOCOL.md
// "open"): plain HTTPS, again every 30 seconds while the page is in view. Each row says
// only how many are on the pitch, whether it has started and how long ago it was made,
// with JOIN to its link and WATCH to the same link with ?observe=1 (watching without a
// seat, docs/OBSERVER.md).
(function () {
  var section = document.querySelector("[data-pitchserver]");
  if (!section || typeof fetch !== "function") return;
  var server = section.getAttribute("data-pitchserver");
  // Only when testing (127.0.0.1 or localhost), the ?pitchserver= and ?api= overrides,
  // as the game takes them (src/main.js); the JOIN links carry them on.
  var carry = "";
  var local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  var params = new URLSearchParams(location.search);
  var override = local && params.get("pitchserver");
  if (override && /^wss?:\/\//.test(override)) {
    server = override;
    carry = "pitchserver=" + encodeURIComponent(override);
    var api = params.get("api");
    if (api) carry += "&api=" + encodeURIComponent(api);
  }
  // the socket's host, over http(s): wss://host -> https://host/open
  var url = server.replace(/^ws/, "http").replace(/\/+$/, "") + "/open";
  var list = section.querySelector("[data-open-list]");
  var status = section.querySelector("[data-open-status]");
  // The same pattern as infra/viewer-request.js and the rooms server.
  var CODE = /^[2-9a-hjkmnp-z]{8,24}$/;
  var EVERY = 30000;
  var timer = null;
  var busy = false;
  section.hidden = false;

  function ago(ms) {
    var min = Math.floor(Math.max(0, ms) / 60000);
    if (min < 1) return "made just now";
    if (min < 60) return "made " + min + " min ago";
    var h = Math.floor(min / 60);
    return "made " + h + (h === 1 ? " hour ago" : " hours ago");
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function show(games, now) {
    while (list.firstChild) list.removeChild(list.firstChild);
    var shown = 0;
    for (var i = 0; i < games.length; i++) {
      var g = games[i];
      if (!g || !CODE.test(g.pitch)) continue;
      var li = el("li", "open-game");
      li.appendChild(
        el(
          "span",
          "open-game__text",
          g.players +
            " of " +
            g.seats +
            " on the pitch · " +
            (g.state === "playing" ? "in play" : "waiting to start") +
            " · " +
            ago(now - g.made),
        ),
      );
      var acts = el("span", "open-game__acts");
      var a = el("a", "button open-game__join", "Join");
      a.href = "/p/" + g.pitch + (carry ? "?" + carry : "");
      acts.appendChild(a);
      var w = el("a", "button open-game__watch", "Watch");
      w.href = "/p/" + g.pitch + "?observe=1" + (carry ? "&" + carry : "");
      w.setAttribute("data-watch", "");
      acts.appendChild(w);
      li.appendChild(acts);
      list.appendChild(li);
      shown++;
    }
    status.textContent = shown
      ? ""
      : "No open games right now. Start a pitch and make it open, and it shows here.";
  }

  function look() {
    if (busy || document.hidden) return;
    busy = true;
    var ctl =
      typeof AbortController === "function" ? new AbortController() : null;
    var guard = setTimeout(function () {
      if (ctl) ctl.abort();
    }, 10000);
    fetch(url, {
      cache: "no-store",
      credentials: "omit",
      signal: ctl && ctl.signal,
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (msg) {
        if (!msg || !Array.isArray(msg.games)) throw new Error("not a list");
        show(msg.games, typeof msg.now === "number" ? msg.now : Date.now());
      })
      .catch(function () {
        if (!list.firstChild)
          status.textContent = "The open games could not be loaded just now.";
      })
      .then(function () {
        clearTimeout(guard);
        busy = false;
      });
  }

  function schedule() {
    clearInterval(timer);
    timer = document.hidden ? null : setInterval(look, EVERY);
  }

  document.addEventListener("visibilitychange", function () {
    schedule();
    if (!document.hidden) look();
  });
  schedule();
  look();
})();
