// The end card's QR code (backend/reels/qr.mjs, overlay.mjs, render.mjs; docs/REEL.md
// "The end card"): what the encoder makes, decoded by an independent decoder (jsQR),
// and the end card itself drawn in each format and decoded back to its exact link,
// for a room code of the usual length and the longest the rooms accept. A code that
// cannot be made or drawn leaves the card as it was.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import jsQR from "jsqr";
import { encodeQr, byteCapacity, isQr } from "../../backend/reels/qr.mjs";
import * as O from "../../backend/reels/overlay.mjs";
import {
  FORMATS,
  loadFonts,
  endCardCode,
  drawEndCard,
} from "../../backend/reels/render.mjs";

// The symbol alone, `px` pixels a module, on white with its quiet zone.
function symbolImage(q, px = 4) {
  const n = (q.size + 8) * px;
  const data = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < q.size; y++)
    for (let x = 0; x < q.size; x++)
      if (q.modules[y][x])
        for (let a = 0; a < px; a++)
          for (let b = 0; b < px; b++) {
            const i = (((y + 4) * px + a) * n + (x + 4) * px + b) * 4;
            data[i] = data[i + 1] = data[i + 2] = 0;
          }
  return { data, n };
}
const decode = ({ data, width, height }) =>
  jsQR(data, width, height, { inversionAttempts: "dontInvert" })?.data ?? null;

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const link = (code) => `https://throwingwood.com/p/${code}`;
const SHORT = "7hq4mz2kpa"; // the browser's codes are 10 characters
const LONGEST = ALPHABET.repeat(2).slice(0, 24); // the rooms take 8 to 24

test("every level, mask and version 1 to 10 decodes to its text", () => {
  for (const level of ["L", "M", "Q", "H"])
    for (let ver = 1; ver <= 10; ver++) {
      const len = byteCapacity(ver, level);
      const text = link(ALPHABET.repeat(8)).slice(0, len);
      for (let mask = 0; mask < 8; mask++) {
        const q = encodeQr(text, { level, mask });
        assert.equal(q.version, ver, `${level} ${len} bytes`);
        assert.ok(isQr(q));
        const { data, n } = symbolImage(q);
        assert.equal(
          decode({ data, width: n, height: n }),
          text,
          `${level} v${ver} mask ${mask}`,
        );
      }
    }
});

test("a pitch link is version 3 (10 characters) or 4 (24) at level M", () => {
  assert.equal(encodeQr(link(SHORT)).version, 3);
  assert.equal(encodeQr(link(LONGEST)).version, 4);
  assert.throws(() => encodeQr("x".repeat(300)), /too long/);
});

for (const format of ["tall", "wide"])
  for (const code of [SHORT, LONGEST])
    test(`the ${format} end card decodes to its link (${code.length} characters)`, () => {
      loadFonts();
      const { W, H } = FORMATS[format];
      const canvas = createCanvas(W, H);
      const ctx = canvas.getContext("2d");
      const L = O.layoutFor(format, W, H);
      const address = `throwingwood.com/p/${code}`;
      const qr = endCardCode(address);
      assert.ok(qr);
      // a pitch-coloured frame under it, as the reel has
      ctx.fillStyle = "#cfd8b8";
      ctx.fillRect(0, 0, W, H);
      O.endCard(ctx, L, {
        winner: "B",
        teams: { A: "North", B: "Riverside Rovers" },
        line: "Took the king in 14 turns",
        address,
        qr,
      });
      assert.ok(O.qrModule(qr, O.QR_TARGET[format]) >= 10);
      assert.equal(decode(ctx.getImageData(0, 0, W, H)), link(code));
    });

const card = (qr) => ({
  winner: "A",
  teams: { A: "North", B: "South" },
  line: "Took the king in 9 turns",
  address: `throwingwood.com/p/${SHORT}`,
  qr,
});
function drawn(format, draw) {
  loadFonts();
  const { W, H } = FORMATS[format];
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#cfd8b8";
  ctx.fillRect(0, 0, W, H);
  draw(ctx, O.layoutFor(format, W, H), () => {
    ctx.fillStyle = "#cfd8b8";
    ctx.fillRect(0, 0, W, H);
  });
  return canvas.toBuffer("image/png");
}

test("a code that cannot be made is no code: the card as it was", () => {
  const lines = [];
  const qr = endCardCode("throwingwood.com/p/x", {
    log: (m) => lines.push(m),
    encode: () => {
      throw new Error("boom");
    },
  });
  assert.equal(qr, null);
  assert.match(lines[0], /without its QR code \(boom\)/);
  assert.equal(
    endCardCode("x", { log: () => {}, encode: () => ({ size: 3 }) }),
    null,
  );
});

for (const format of ["tall", "wide"])
  test(`a code that cannot be drawn leaves the ${format} card with the URL only`, () => {
    const plain = drawn(format, (ctx, L) => O.endCard(ctx, L, card(undefined)));
    const lines = [];
    let after;
    const fell = drawn(format, (ctx, L, redraw) => {
      after = drawEndCard(ctx, L, card({ size: 29, modules: null }), {
        log: (m) => lines.push(m),
        redraw,
      });
    });
    assert.equal(after, null);
    assert.equal(lines.length, 1);
    assert.ok(plain.equals(fell), "the same pixels as the card without a code");
    // and the card with no code at all is today's
    const none = drawn(format, (ctx, L) => drawEndCard(ctx, L, card(null)));
    assert.ok(plain.equals(none));
  });
