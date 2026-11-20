// A QR code for the end card's link (docs/REEL.md "The end card"): the symbol as a
// square of modules, true for dark. Written here rather than taken as a dependency: it
// is one short text in byte mode, so the encoder is small (ISO/IEC 18004, model 2,
// versions 1 to 10, any error correction level). Pure: no canvas, no engine.
//
// The tests decode what it draws with an independent decoder (jsQR), for every mask,
// at the levels and versions a pitch link needs (tests/reel/qr.test.mjs).

const LEVELS = { L: 0, M: 1, Q: 2, H: 3 };
// the two format bits of each level, in the order above
const FORMAT_BITS = [1, 0, 3, 2];
// Error correction codewords per block and number of blocks, versions 1..10
// (index 0 unused), levels L, M, Q, H.
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
];
const BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
];
export const MAX_VERSION = 10;

// Modules left for data and error correction once the function patterns are drawn.
function rawModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

const dataCodewords = (ver, lv) =>
  Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[lv][ver] * BLOCKS[lv][ver];

// Bytes a version holds in byte mode at a level (mode and count bits taken out).
export function byteCapacity(ver, level = "M") {
  const lv = LEVELS[level];
  const countBits = ver <= 9 ? 8 : 16;
  return Math.floor((dataCodewords(ver, lv) * 8 - 4 - countBits) / 8);
}

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const out = new Array(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j], root);
      if (j + 1 < degree) out[j] ^= out[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return out;
}

function rsRemainder(data, divisor) {
  const out = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ out.shift();
    out.push(0);
    divisor.forEach((d, i) => (out[i] ^= gfMul(d, factor)));
  }
  return out;
}

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const size = ver * 4 + 17;
  const n = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// The symbol for `text` (UTF-8, byte mode) at `level`, in the smallest version that
// holds it. `mask` forces one of the eight masks (for tests); otherwise the one with
// the lowest penalty is used. Throws when the text does not fit version 10.
export function encodeQr(text, { level = "M", mask = null } = {}) {
  const lv = LEVELS[level];
  if (lv === undefined) throw new Error(`unknown QR level ${level}`);
  if (mask !== null && !(Number.isInteger(mask) && mask >= 0 && mask < 8))
    throw new Error(`QR mask must be 0 to 7`);
  const bytes = [...new TextEncoder().encode(String(text))];
  let ver = 1;
  while (ver <= MAX_VERSION && byteCapacity(ver, level) < bytes.length) ver++;
  if (ver > MAX_VERSION) throw new Error("text too long for this QR encoder");

  // the bit stream: byte mode, the count, the bytes, a terminator, padding
  const bits = [];
  const put = (value, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(ver, lv) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // error correction, block by block, then interleaved
  const nBlocks = BLOCKS[lv][ver];
  const eccLen = ECC_PER_BLOCK[lv][ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const nShort = nBlocks - (raw % nBlocks);
  const shortLen = Math.floor(raw / nBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const len = shortLen - eccLen + (i < nShort ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const ecc = rsRemainder(dat, divisor);
    if (i < nShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= nShort) codewords.push(b[i]);
    });

  // the function patterns
  const size = ver * 4 + 17;
  const grid = () =>
    Array.from({ length: size }, () => Array(size).fill(false));
  const mod = grid();
  const fn = grid();
  const set = (x, y, dark) => {
    mod[y][x] = dark;
    fn[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
  const al = alignmentPositions(ver);
  al.forEach((ax, i) =>
    al.forEach((ay, j) => {
      const last = al.length - 1;
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === last) ||
        (i === last && j === 0)
      )
        return;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  const drawFormat = (m) => {
    const d = (FORMAT_BITS[lv] << 3) | m;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((d << 10) | rem) ^ 0x5412;
    const bit = (i) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true); // the dark module
  };
  drawFormat(0); // reserves the format areas
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((v >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  // the codewords, in two-module columns from the bottom right, zigzagging
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && i < codewords.length * 8) {
          mod[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }

  const applyMask = (m) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x];
  };
  let chosen = mask;
  if (chosen === null) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m);
      drawFormat(m);
      const p = penalty(mod);
      if (p < best) {
        best = p;
        chosen = m;
      }
      applyMask(m); // XOR again undoes it
    }
  }
  applyMask(chosen);
  drawFormat(chosen);
  return { version: ver, size, level, mask: chosen, modules: mod };
}

// The standard's penalty for a masked symbol (lower is better). It only chooses
// among valid masks, so any symbol it scores still decodes.
function penalty(m) {
  const size = m.length;
  let p = 0;
  const lines = [];
  for (let y = 0; y < size; y++) lines.push(m[y]);
  for (let x = 0; x < size; x++) lines.push(m.map((row) => row[x]));
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [...A].reverse();
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) p += 3 + (run - 5);
        run = 1;
      }
    }
    for (let i = 0; i + 11 <= size; i++)
      for (const pat of [A, B])
        if (pat.every((b, k) => line[i + k] === (b === 1))) p += 40;
  }
  let dark = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (
        x + 1 < size &&
        y + 1 < size &&
        m[y][x] === m[y][x + 1] &&
        m[y][x] === m[y + 1][x] &&
        m[y][x] === m[y + 1][x + 1]
      )
        p += 3;
    }
  p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return p;
}

// A symbol as encodeQr returns it, checked: square, 21 to 57 modules, booleans.
export function isQr(q) {
  const n = q?.size;
  return (
    Number.isInteger(n) &&
    n >= 21 &&
    n <= MAX_VERSION * 4 + 17 &&
    (n - 17) % 4 === 0 &&
    Array.isArray(q.modules) &&
    q.modules.length === n &&
    q.modules.every(
      (row) =>
        Array.isArray(row) &&
        row.length === n &&
        row.every((c) => typeof c === "boolean"),
    )
  );
}
