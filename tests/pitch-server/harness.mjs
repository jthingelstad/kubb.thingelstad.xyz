// A stand-in for the Durable Object around the pitch core: it carries out the core's
// effects on an in-memory store and inboxes, as PROTOCOL.md "Effects" says the real
// object must, so the tests can drive a pitch and put it to sleep.
import { rebuildPitch, step } from "../../backend/pitch-server/core.mjs";

export const CODE = "k7mpq2rstw";
export const id = (name) => `${name}-member-id`; // made-up member ids, 8+ characters

const clone = (x) =>
  x === undefined ? undefined : JSON.parse(JSON.stringify(x));

export class Harness {
  constructor({ options, now = 1_000_000, code = CODE } = {}) {
    this.code = code;
    this.options = options;
    this.now = now;
    this.store = {};
    this.inbox = new Map();
    this.attached = new Map(); // conn -> { member, role }
    this.open = new Set();
    this.closed = [];
    this.pushes = [];
    this.listings = [];
    this.alarm = null;
    this.wiped = 0;
    this.deliver = true;
    this.effects = [];
    const r = rebuildPitch({ code, stored: null, conns: [], now, options });
    this.state = r.state;
    this.apply(r.effects);
  }

  // Carry out effects in order. `stopAt` drops everything from the first effect of
  // that kind on (the object died there). Pushes are delivered at once and confirmed
  // with a `pushed` event, unless `deliver` is false (AWS did not answer).
  apply(effects, { stopAt = null, top = true } = {}) {
    if (top) this.effects = effects;
    const delivered = [];
    for (const e of effects) {
      if (e.kind === stopAt) return;
      switch (e.kind) {
        case "send":
          for (const to of e.to) {
            if (!this.open.has(to)) continue;
            this.box(to).push(JSON.parse(JSON.stringify(e.frame)));
          }
          break;
        case "close":
          this.closed.push(e);
          this.open.delete(e.conn);
          break;
        case "attach":
          if (e.member)
            this.attached.set(e.conn, { member: e.member, role: e.role });
          else this.attached.delete(e.conn);
          break;
        case "persist": {
          for (const k of ["pitch", "doc", "members", "match", "head"])
            if (e[k] !== undefined) this.store[k] = clone(e[k]);
          if (e.clearActs) this.store.acts = [];
          if (e.acts)
            this.store.acts = [...(this.store.acts ?? []), ...clone(e.acts)];
          if (e.outbox)
            this.store.outbox = [
              ...(this.store.outbox ?? []),
              ...clone(e.outbox),
            ];
          if (e.unbox)
            this.store.outbox = (this.store.outbox ?? []).filter(
              (x) => !e.unbox.includes(x.k),
            );
          break;
        }
        case "push":
          this.pushes.push(clone(e));
          if (this.deliver) delivered.push(e.k);
          break;
        case "listing":
          this.listings.push(clone(e));
          break;
        case "alarm":
          this.alarm = e.at;
          break;
        case "wipe":
          this.store = {};
          this.wiped++;
          break;
        default:
          throw new Error(`unknown effect ${e.kind}`);
      }
    }
    for (const k of delivered) {
      const r = step(this.state, { type: "pushed", k, now: this.now });
      this.apply(r.effects, { top: false });
    }
  }

  box(conn) {
    if (!this.inbox.has(conn)) this.inbox.set(conn, []);
    return this.inbox.get(conn);
  }

  // Everything conn received since the last take.
  take(conn) {
    const out = this.box(conn);
    this.inbox.set(conn, []);
    return out;
  }

  last(conn) {
    const b = this.box(conn);
    return b[b.length - 1];
  }

  connect(conn) {
    this.open.add(conn);
  }

  send(conn, msg, { dt = 0, stopAt } = {}) {
    this.now += dt;
    if (!this.open.has(conn)) this.connect(conn);
    const text = typeof msg === "string" ? msg : JSON.stringify(msg);
    const r = step(this.state, { type: "frame", conn, text, now: this.now });
    this.apply(r.effects, { stopAt });
    return r.effects;
  }

  join(conn, name, extra = {}, { dt = 0 } = {}) {
    this.send(conn, { t: "join", member: id(name), ...extra }, { dt });
    return this.take(conn).at(-1); // the joined frame (or the error), taken out
  }

  close(conn, { dt = 0 } = {}) {
    this.now += dt;
    this.open.delete(conn);
    const r = step(this.state, { type: "close", conn, now: this.now });
    this.apply(r.effects);
    return r.effects;
  }

  tick(dt = 0) {
    this.now += dt;
    const r = step(this.state, { type: "tick", now: this.now });
    this.apply(r.effects);
    return r.effects;
  }

  // The object sleeps (or restarts) and wakes: in-memory state is gone; it is rebuilt
  // from the store and the sockets still open, with their attachments.
  wake({ dt = 0, conns } = {}) {
    this.now += dt;
    const live =
      conns ??
      [...this.open].map((conn) => ({
        conn,
        ...(this.attached.get(conn) ?? { member: null, role: null }),
      }));
    const r = rebuildPitch({
      code: this.code,
      stored: clone(this.store),
      conns: live,
      now: this.now,
      options: this.options,
    });
    this.state = r.state;
    this.apply(r.effects);
    return r.effects;
  }
}

// A start message from the host.
export const start = (base, n = 1, extra = {}) => ({
  t: "start",
  id: `start-${n}`,
  base,
  n,
  doc: { teams: { A: [], B: [] }, started: true, n },
  h: "h0",
  snap: `snap-${n}-0`,
  meta: { engine: "0.9.0", setup: { seed: 1 } },
  ...extra,
});

// An action message.
export const act = (seq, extra = {}) => ({
  t: "act",
  id: `act-${seq}`,
  n: 1,
  seq,
  a: { kind: "throw", seq },
  h: `h${seq}`,
  snap: `snap-1-${seq}`,
  ...extra,
});
