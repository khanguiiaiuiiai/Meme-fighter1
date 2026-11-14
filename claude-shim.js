/* Thay thế claude.use("room" | "db" | "user") bằng server riêng (Render) */
(function () {
  const rnd = () => Math.random().toString(36).slice(2, 10);
  const LS = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

  let uid = LS.get("mf_uid");
  if (!uid) { uid = "u" + rnd() + rnd(); LS.set("mf_uid", uid); }
  const peerId = "p" + rnd() + rnd(); // mỗi tab 1 id
  let name = LS.get("mf_name");

  const api = (m, url, b) => fetch(url, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());

  /* ---------- user ---------- */
  const user = {
    async id() {
      if (!name) {
        name = (prompt("Nhập tên của bạn:", "") || "").trim().slice(0, 20) || "Gamer" + Math.floor(Math.random() * 9000 + 1000);
        LS.set("mf_name", name);
      }
      try { await api("PUT", "/api/profile/" + uid, { name }); } catch (e) {}
      send({ t: "reg", uid, name });
      return uid;
    },
    async profiles(ids) {
      const arr = Array.isArray(ids) ? ids : [ids];
      try { return await api("GET", "/api/profiles?ids=" + encodeURIComponent(arr.join(","))); } catch (e) { return {}; }
    }
  };

  /* ---------- db ---------- */
  const db = {
    collection(col) {
      if (col !== "lb") throw new Error("collection không hỗ trợ");
      return {
        doc(id) { return { set: d => api("PUT", "/api/lb/" + id, d) }; },
        orderBy() {
          return {
            limit(n) {
              return { async get() { const rows = await api("GET", "/api/lb?limit=" + n); return { docs: rows.map(r => ({ id: r.id, data: () => r.data })) }; } };
            }
          };
        }
      };
    }
  };

  /* ---------- room (WebSocket) ---------- */
  const netCbs = new Set();
  let ws, ready, connCbs = [], wsOpen = false;
  const subs = new Map(); // room -> {peers:[], cbs:Set, pending:resolve}
  const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

  function connect() {
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    ws.onopen = () => { send({ t: "hello", peer: peerId }); if (name) send({ t: "reg", uid, name }); };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === "ready") {
        wsOpen = true; connCbs.forEach(f => f(true));
        for (const [room, s] of subs) send({ t: "join", room }); // vào lại phòng sau khi nối lại
      } else if (m.t === "peers") {
        const s = subs.get(m.room); if (!s) return;
        s.peers = m.peers.map(p => ({ peer: p.peer, kind: "viewer", sameTab: p.peer === peerId, presence: p.presence || {} }));
        s.cbs.forEach(f => { try { f(); } catch (e) { console.error(e); } });
      } else if (m.t === "joined") {
        const s = subs.get(m.room); if (s && s.pending) { s.pending(); s.pending = null; }
      } else { netCbs.forEach(f => { try { f(m); } catch (e) { console.error(e); } }); }
    };
    ws.onclose = () => { wsOpen = false; connCbs.forEach(f => f(false)); setTimeout(connect, 2000); };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }
  setInterval(() => send({ t: "ping" }), 25000); // giữ kết nối khỏi bị proxy ngắt

  function makeRoom(name) {
    const s = { peers: [], cbs: new Set(), pending: null, mine: {} };
    subs.set(name, s);
    const joined = new Promise(r => { s.pending = r; });
    if (wsOpen) send({ t: "join", room: name });
    const r = {
      peers: () => s.peers,
      onPeers(cb) { s.cbs.add(cb); return () => s.cbs.delete(cb); },
      onConnection(cb) { connCbs.push(cb); cb(wsOpen); return () => { connCbs = connCbs.filter(f => f !== cb); }; },
      presence(d) { Object.assign(s.mine, d); send({ t: "presence", room: name, data: d }); return Promise.resolve(); },
      async join(sub) { const x = makeRoom(sub); await x._joined; return x; },
      async leave() { send({ t: "leave", room: name }); subs.delete(name); },
      _joined: joined
    };
    return r;
  }

  // kênh thô cho bạn bè / chat riêng / lời mời
  window.mfNet = { uid, send, on: f => { netCbs.add(f); return () => netCbs.delete(f); } };
  let lobby;
  window.claude = {
    async use(what) {
      if (what === "user") return user;
      if (what === "db") return db;
      if (what === "room") {
        if (!lobby) { connect(); lobby = makeRoom("lobby"); }
        return lobby;
      }
      return null;
    }
  };
})();
