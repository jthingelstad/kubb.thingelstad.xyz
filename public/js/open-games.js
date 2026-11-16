// The home page's Open games list (src/site/pages.mjs): pitches whose host made them
// open, newest first, from the rooms server's `list` message (docs/ROOMS.md section 9).
// A socket of its own for each look, closed as soon as the answer comes; again every
// 30 seconds while the page is in view. Each row says only how many are on the pitch,
// whether it has started and how long ago it was made, with JOIN to its link.
(function () {
  var section = document.querySelector("[data-rooms]");
  if (!section || typeof WebSocket !== "function") return;
  var url = section.getAttribute("data-rooms");
  // Only when testing (127.0.0.1 or localhost), a ?rooms= override, as the game takes
  // (src/main.js); the JOIN links carry it on.
  var carry = "";
  var local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  var override = local && new URLSearchParams(location.search).get("rooms");
  if (override && /^wss?:\/\//.test(override)) {
    url = override;
    carry = "?rooms=" + encodeURIComponent(override);
  }
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
      if (!g || !CODE.test(g.room)) continue;
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
      var a = el("a", "button open-game__join", "Join");
      a.href = "/p/" + g.room + carry;
      li.appendChild(a);
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
    var done = false;
    var ws;
    var finish = function (games, now) {
      if (done) return;
      done = true;
      busy = false;
      clearTimeout(guard);
      try {
        ws.close();
      } catch (e) {}
      if (games) show(games, now);
      else if (!list.firstChild)
        status.textContent = "The open games could not be loaded just now.";
    };
    var guard = setTimeout(function () {
      finish(null);
    }, 10000);
    try {
      ws = new WebSocket(url);
    } catch (e) {
      finish(null);
      return;
    }
    ws.onopen = function () {
      ws.send(JSON.stringify({ t: "list", id: 1 }));
    };
    ws.onmessage = function (e) {
      var msg;
      try {
        msg = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      if (msg && msg.t === "list" && Array.isArray(msg.games))
        finish(msg.games, typeof msg.now === "number" ? msg.now : Date.now());
      else if (msg && msg.t === "error") finish(null);
    };
    ws.onerror = function () {
      finish(null);
    };
    ws.onclose = function () {
      finish(null);
    };
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
