// LobbyDO: one object (named "open") holding the open games list. Pitches report their
// own entries over RPC (the core's `listing` effect); the Worker reads the list for
// GET /open. The rules are ./lobby.mjs.
import { DurableObject } from "cloudflare:workers";
import { listing, report } from "./lobby.mjs";

export class LobbyDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS open (pitch TEXT PRIMARY KEY, at INTEGER NOT NULL, seq INTEGER NOT NULL, exp INTEGER NOT NULL, entry TEXT)",
    );
  }

  purge(now) {
    this.sql.exec("DELETE FROM open WHERE exp <= ?", now);
  }

  rows() {
    return this.sql
      .exec("SELECT pitch, at, seq, exp, entry FROM open")
      .toArray()
      .map((r) => ({ ...r, entry: r.entry ? JSON.parse(r.entry) : null }));
  }

  // From a pitch: { pitch, entry | null, at, seq }. `now` is for the tests.
  report(msg, now = Date.now()) {
    this.purge(now);
    const sql = this.sql;
    const store = {
      get(pitch) {
        const r = sql
          .exec("SELECT at, seq FROM open WHERE pitch = ?", pitch)
          .toArray()[0];
        return r ?? undefined;
      },
      set(pitch, row) {
        sql.exec(
          "INSERT OR REPLACE INTO open (pitch, at, seq, exp, entry) VALUES (?, ?, ?, ?, ?)",
          pitch,
          row.at,
          row.seq,
          row.exp,
          row.entry ? JSON.stringify(row.entry) : null,
        );
      },
    };
    return report(store, msg, now);
  }

  list(now = Date.now()) {
    this.purge(now);
    return listing(this.rows(), now);
  }
}
