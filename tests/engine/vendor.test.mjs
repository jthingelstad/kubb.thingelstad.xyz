// tools/vendor.mjs carrying more than one engine, against a stand-in kubb-engine
// made at test time (engine-fixture.mjs) and vendored into a temporary root: the
// real vendor/ is only checked, never written.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  check,
  drop,
  readPin,
  sync,
  vendorPaths,
} from "../../tools/vendor.mjs";
import {
  bundleLua,
  carriedEngines,
  engineVersion,
} from "../../tools/lua-bundle.mjs";
import { makeEngineRepo, makeVendorRoot } from "./engine-fixture.mjs";

const repo = makeEngineRepo(["0.6.2", "0.7.4", "0.7.5", "0.8.0", "0.9.0"]);
test.after(() => repo.clean());

function fresh(t) {
  const root = makeVendorRoot();
  t.after(() => root.clean());
  return root.dir;
}

test("the checkout's own vendor/ matches its pins", () => {
  const { problems } = check();
  assert.deepEqual(problems, []);
});

test("one engine: a patch replaces it, a newer minor must say keep or drop", (t) => {
  const root = fresh(t);
  sync({ root, repo: repo.dir, tag: "v0.7.4" });
  assert.deepEqual(check({ root }).problems, []);
  assert.deepEqual(readPin(root).older, {});

  sync({ root, repo: repo.dir, tag: "v0.7.5" });
  assert.equal(readPin(root).tag, "v0.7.5");
  assert.equal(engineVersion(vendorPaths(root).newest), "0.7.5");
  assert.equal(fs.existsSync(vendorPaths(root).olderDir), false);

  assert.throws(
    () => sync({ root, repo: repo.dir, tag: "v0.8.0" }),
    /new minor: say what happens to 0\.7.*--keep.*--drop/,
  );
  // Refused: nothing moved.
  assert.equal(readPin(root).tag, "v0.7.5");
  assert.deepEqual(check({ root }).problems, []);
});

test("--keep moves the old minor beside the new one, and both are checked", (t) => {
  const root = fresh(t);
  const paths = vendorPaths(root);
  sync({ root, repo: repo.dir, tag: "v0.7.4" });
  const said = sync({ root, repo: repo.dir, tag: "v0.8.0", keep: true });
  assert.match(
    said.join("\n"),
    /kept kubb-engine v0\.7\.4 in vendor\/engines\/0\.7/,
  );

  const pin = readPin(root);
  assert.equal(pin.tag, "v0.8.0");
  assert.deepEqual(Object.keys(pin.older), ["0.7"]);
  assert.equal(pin.older["0.7"].tag, "v0.7.4");
  assert.deepEqual(check({ root }).problems, []);
  assert.deepEqual(
    carriedEngines(paths.vendor).map(({ mm, version }) => [mm, version]),
    [
      ["0.8", "0.8.0"],
      ["0.7", "0.7.4"],
    ],
  );
  // Each engine's bundle is its own sources.
  assert.match(bundleLua(paths.newest).version, /"0\.8\.0"/);
  assert.match(bundleLua(paths.older("0.7")).version, /"0\.7\.4"/);

  // A patch to the older engine moves only that engine.
  sync({ root, repo: repo.dir, tag: "v0.7.5" });
  assert.equal(readPin(root).older["0.7"].tag, "v0.7.5");
  assert.equal(readPin(root).tag, "v0.8.0");
  assert.deepEqual(check({ root }).problems, []);

  // A third minor keeps the second; the set is newest first in the pin.
  sync({ root, repo: repo.dir, tag: "v0.9.0", keep: true });
  assert.deepEqual(Object.keys(readPin(root).older), ["0.8", "0.7"]);
  assert.deepEqual(check({ root }).problems, []);

  // sync with no tag writes every pin again at its own tag.
  fs.writeFileSync(path.join(paths.older("0.7"), "core", "tw.lua"), "-- x\n");
  assert.match(
    check({ root }).problems.join("\n"),
    /engines\/0\.7\/core\/tw\.lua was edited/,
  );
  sync({ root, repo: repo.dir });
  assert.deepEqual(check({ root }).problems, []);
});

test("--drop replaces the newest without keeping it; drop stops carrying an older one", (t) => {
  const root = fresh(t);
  const paths = vendorPaths(root);
  sync({ root, repo: repo.dir, tag: "v0.7.4" });
  sync({ root, repo: repo.dir, tag: "v0.8.0", drop: true });
  assert.deepEqual(readPin(root).older, {});
  assert.equal(fs.existsSync(paths.olderDir), false);
  assert.deepEqual(check({ root }).problems, []);

  sync({ root, repo: repo.dir, tag: "v0.9.0", keep: true });
  assert.throws(() => drop({ root, mm: "0.9" }), /newest engine/);
  assert.throws(() => drop({ root, mm: "0.5" }), /no older engine 0\.5/);
  drop({ root, mm: "0.8" });
  assert.deepEqual(readPin(root).older, {});
  assert.equal(fs.existsSync(paths.older("0.8")), false);
  assert.deepEqual(check({ root }).problems, []);
});

test("an engine the site does not carry is not added back under the newest", (t) => {
  const root = fresh(t);
  sync({ root, repo: repo.dir, tag: "v0.7.4" });
  assert.throws(
    () => sync({ root, repo: repo.dir, tag: "v0.6.2" }),
    /does not carry 0\.6/,
  );
  assert.throws(
    () => sync({ root, repo: repo.dir, tag: "v0.7.5", keep: true }),
    /--keep and --drop are for a newer minor/,
  );
  assert.throws(
    () => sync({ root, repo: repo.dir, tag: "v0.8.9", keep: true }),
    /v0\.8\.9/,
  );
  assert.equal(readPin(root).tag, "v0.7.4");
  assert.deepEqual(check({ root }).problems, []);
});

test("check finds an unpinned folder, a missing one and a mislabelled pin", (t) => {
  const root = fresh(t);
  const paths = vendorPaths(root);
  sync({ root, repo: repo.dir, tag: "v0.7.4" });
  sync({ root, repo: repo.dir, tag: "v0.8.0", keep: true });

  fs.cpSync(paths.older("0.7"), paths.older("0.6"), { recursive: true });
  assert.match(
    check({ root }).problems.join("\n"),
    /vendor\/engines\/0\.6 is not pinned/,
  );
  fs.rmSync(paths.older("0.6"), { recursive: true });

  fs.rmSync(paths.older("0.7"), { recursive: true });
  assert.match(
    check({ root }).problems.join("\n"),
    /vendor\/engines\/0\.7 is missing/,
  );
  sync({ root, repo: repo.dir });
  assert.deepEqual(check({ root }).problems, []);

  const pin = JSON.parse(fs.readFileSync(paths.pin, "utf8"));
  pin.older["0.9"] = pin.older["0.7"];
  fs.writeFileSync(paths.pin, JSON.stringify(pin));
  const problems = check({ root }).problems.join("\n");
  assert.match(problems, /older engine 0\.9 is pinned at v0\.7\.4/);
  assert.match(problems, /0\.9 is not older than the newest/);
});
