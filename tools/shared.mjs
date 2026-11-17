// What this site shares with Jamie's other sites is vendored, because CI
// checks out only this repository: the shared type (thingelstad.com/shared/,
// ../../thingelstad.com/shared since the move into the throwingwood folder;
// tokens.css and its Inter fonts) into public/shared/, and the list of sites
// with the owner's h-card (sites.json) into src/site/.
//
//   node tools/shared.mjs sync    copy the sibling's files in
//   node tools/shared.mjs check   fail if a copy has drifted (skips when the
//                                 sibling is not checked out, as on CI)
import fs from "node:fs/promises";
import path from "node:path";

const SOURCE = "../../thingelstad.com/shared";
const PUBLIC = [
  "tokens.css",
  "fonts/OFL-Inter.txt",
  "fonts/OFL-InterTight.txt",
  "fonts/inter-latin-wght-normal.woff2",
  "fonts/inter-latin-ext-wght-normal.woff2",
  "fonts/inter-latin-wght-italic.woff2",
  "fonts/inter-latin-ext-wght-italic.woff2",
  "fonts/inter-tight-latin-wght-normal.woff2",
  "fonts/inter-tight-latin-ext-wght-normal.woff2",
];
const FILES = [
  ...PUBLIC.map((file) => [file, path.join("public/shared", file)]),
  ["sites.json", "src/site/sites.json"],
];
const mode = process.argv[2];
try {
  await fs.access(path.join(SOURCE, "tokens.css"));
} catch {
  console.log(`No ${SOURCE}/ beside this checkout; nothing to compare.`);
  process.exit(0);
}
let drift = 0;
for (const [file, to] of FILES) {
  const from = path.join(SOURCE, file);
  const same = await Promise.all([
    fs.readFile(from),
    fs.readFile(to).catch(() => null),
  ]).then(([a, b]) => b !== null && a.equals(b));
  if (same) continue;
  if (mode === "sync") {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    console.log(`Copied ${file}`);
  } else {
    console.error(`Drifted: ${file}`);
    drift++;
  }
}
if (drift) process.exit(1);
if (mode !== "sync") console.log(`Shared files match (${FILES.length})`);
