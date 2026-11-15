// The room store in memory: the local server (tools/rooms-dev.mjs) and the tests. Same
// contract as dynamo-store.mjs (see core.mjs), including the conditional writes and the
// rule that an item past its `exp` (epoch seconds) is not there.

export function memoryStore({ now = Date.now } = {}) {
  const rooms = new Map();
  const docs = new Map();
  const conns = new Map();
  const parts = new Map(); // "conn id" -> { exp, got: Map(i -> text) }

  const live = (item) => (item && item.exp * 1000 > now() ? item : null);
  const copy = (item) => (item ? structuredClone(item) : null);

  return {
    rooms,
    docs,
    conns,
    parts,

    async getRoom(code) {
      return copy(live(rooms.get(code)));
    },
    async putRoom(code, room, prevRev) {
      if ((live(rooms.get(code))?.rev ?? 0) !== prevRev) return false;
      rooms.set(code, copy(room));
      return true;
    },

    async getDoc(code) {
      return copy(live(docs.get(code)));
    },
    async putDoc(code, doc, base) {
      if ((live(docs.get(code))?.v ?? 0) !== base) return false;
      docs.set(code, copy(doc));
      return true;
    },

    async touchDoc(code, exp) {
      const doc = live(docs.get(code));
      if (doc) doc.exp = exp;
    },

    async putConn(conn, who) {
      conns.set(conn, copy(who));
    },
    async getConn(conn) {
      return copy(live(conns.get(conn)));
    },
    async delConn(conn) {
      conns.delete(conn);
      for (const key of parts.keys())
        if (key.startsWith(`${conn} `)) parts.delete(key);
    },

    async addChunk(conn, id, i, n, text, exp) {
      const key = `${conn} ${id}`;
      const entry = live(parts.get(key)) ?? { exp, got: new Map() };
      entry.got.set(i, text);
      parts.set(key, entry);
      if (entry.got.size < n) return null;
      parts.delete(key);
      let whole = "";
      for (let k = 0; k < n; k++) whole += entry.got.get(k) ?? "";
      return whole;
    },
  };
}
