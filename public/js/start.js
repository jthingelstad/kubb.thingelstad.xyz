// The web game's buttons (on / and PLAY NOW on /engine/): every link marked data-pitch goes to a pitch of
// its own, /p/<code>, the code made here as the link is used. Without this
// script the links go to /p/, which sends the browser on to a new code.
// Also the choice beside START A PITCH: invite only or open.
(function () {
  // The same alphabet as src/site/site.mjs and infra/viewer-request.js.
  var ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
  var LENGTH = 8;
  function code() {
    var out = "";
    var bytes = new Uint8Array(16);
    while (out.length < LENGTH) {
      crypto.getRandomValues(bytes);
      for (var i = 0; i < bytes.length && out.length < LENGTH; i++)
        // 248 is the largest multiple of 31 under 256: drop the bytes above
        // it so every letter is as likely as the next.
        if (bytes[i] < 248) out += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return out;
  }
  function point(link) {
    link.href = "/p/" + code() + (link.dataset.pitch || "");
  }
  var links = document.querySelectorAll("a[data-pitch]");
  for (var i = 0; i < links.length; i++) {
    point(links[i]);
    links[i].addEventListener("pointerdown", function () {
      point(this);
    });
  }
  // Who can join the pitch START A PITCH makes: invite only (the link) or open
  // (?open=1: the lobby starts open, listed under Open games). Shown only with this
  // script; without it a pitch starts invite only and the lobby can open it.
  var access = document.querySelector("[data-access]");
  var start = document.querySelector("a[data-start]");
  if (access && start) {
    access.hidden = false;
    var pick = function () {
      var open = access.querySelector('input[value="open"]');
      start.dataset.pitch = open && open.checked ? "?open=1" : "";
      point(start);
    };
    access.addEventListener("change", pick);
    pick();
  }
})();
