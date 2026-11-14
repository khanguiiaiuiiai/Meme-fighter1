// MEME FIGHTER – server: static files + WebSocket "room" + mini DB (bảng xếp hạng)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = __dirname; // file game nằm ngay thư mục gốc
const VERSION = 4;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

/* ---------- mini DB (lưu file JSON) ---------- */
let DB = { lb: {}, profiles: {} };
try { DB = Object.assign(DB, JSON.parse(fs.readFileSync(DB_FILE, "utf8"))); } catch (e) {}
let dirty = false;
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(DB)); } catch (e) { console.error("save fail", e.message); }
}, 5000);

const clean = s => String(s || "").replace(/[<>]/g, "").slice(0, 24);
const okId = s => /^[A-Za-z0-9_-]{6,40}$/.test(s || "");
const num = v => (Number.isFinite(+v) ? Math.max(-1e6, Math.min(1e6, +v)) : 0);

/* ---------- HTTP ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
function body(req) {
  return new Promise(res => {
    let b = "";
    req.on("data", c => { b += c; if (b.length > 4096) req.destroy(); });
    req.on("end", () => { try { res(JSON.parse(b || "{}")); } catch (e) { res({}); } });
  });
}
const json = (res, code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/health") return json(res, 200, { ok: 1, v: VERSION, files: fs.readdirSync(__dirname) });

  // đăng ký / đổi tên
  if (req.method === "PUT" && u.pathname.startsWith("/api/profile/")) {
    const id = u.pathname.split("/").pop();
    if (!okId(id)) return json(res, 400, { error: "id" });
    const b = await body(req);
    DB.profiles[id] = { name: clean(b.name) || "Người chơi" };
    dirty = true;
    return json(res, 200, { ok: 1 });
  }
  if (req.method === "GET" && u.pathname === "/api/profiles") {
    const out = {};
    (u.searchParams.get("ids") || "").split(",").filter(okId).slice(0, 60).forEach(id => { out[id] = DB.profiles[id] || { name: "Người chơi" }; });
    return json(res, 200, out);
  }
  // bảng xếp hạng
  if (req.method === "PUT" && u.pathname.startsWith("/api/lb/")) {
    const id = u.pathname.split("/").pop();
    if (!okId(id)) return json(res, 400, { error: "id" });
    const b = await body(req);
    DB.lb[id] = { pts: num(b.pts), w: num(b.w), l: num(b.l), tr: num(b.tr), t: Date.now() };
    dirty = true;
    return json(res, 200, { ok: 1 });
  }
  if (req.method === "GET" && u.pathname === "/api/lb") {
    const limit = Math.min(100, +u.searchParams.get("limit") || 30);
    const rows = Object.entries(DB.lb).map(([id, d]) => ({ id, data: d })).sort((a, b) => b.data.pts - a.data.pts).slice(0, limit);
    return json(res, 200, rows);
  }

  // file tĩnh: ưu tiên public/, nếu thiếu thì tìm index.html + claude-shim.js ở thư mục gốc
  let p = u.pathname === "/" ? "/index.html" : decodeURIComponent(u.pathname);
  const name = path.basename(p);
  const ALLOW = ["index.html", "claude-shim.js"];
  const cands = ALLOW.includes(name) ? [path.join(__dirname, name)] : [];
    const f = cands.find(c => fs.existsSync(c) && fs.statSync(c).isFile());
  if (!f) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found: thiếu file " + p + " (cần public/index.html và public/claude-shim.js trong repo). Hiện có: " + (fs.existsSync(PUBLIC) ? fs.readdirSync(PUBLIC).join(", ") : "không có thư mục public"));
  }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(500); return res.end("Error"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
});

/* ---------- WebSocket: phòng + presence ---------- */
// rooms: name -> Map(peerId -> presence)
const rooms = new Map();
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });

function broadcast(room) {
  const m = rooms.get(room);
  if (!m) return;
  const peers = [...m.entries()].map(([peer, presence]) => ({ peer, presence }));
  const msg = JSON.stringify({ t: "peers", room, peers });
  for (const ws of wss.clients) if (ws.readyState === 1 && ws.rooms && ws.rooms.has(room)) ws.send(msg);
}
function leave(ws, room) {
  if (!ws.rooms || !ws.rooms.has(room)) return;
  ws.rooms.delete(room);
  const m = rooms.get(room);
  if (m) { m.delete(ws.peer); if (!m.size) rooms.delete(room); else broadcast(room); }
}


/* ---------- chat toàn server ---------- */
const chatHist = [];
const onlineCount = () => { let n = 0; for (const c of wss.clients) if (c.peer) n++; return n; };
function chatBroadcast(o) {
  const msg = JSON.stringify(o);
  for (const c of wss.clients) if (c.chatOn && c.readyState === 1) c.send(msg);
}

wss.on("connection", ws => {
  ws.rooms = new Set();
  ws.alive = true;
  ws.on("pong", () => { ws.alive = true; });
  ws.on("message", raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === "chatjoin") { ws.chatOn = true; ws.send(JSON.stringify({ t: "chathist", msgs: chatHist, online: onlineCount() })); return; }
    if (m.t === "chat") {
      const now = Date.now();
      if (now - (ws.lastChat || 0) < 700) return;
      const text = String(m.text || "").replace(/[<>]/g, "").trim().slice(0, 150);
      if (!text) return;
      ws.lastChat = now;
      const msg = { t: "chat", name: clean(m.name) || "Ẩn danh", text, ts: now };
      chatHist.push(msg); if (chatHist.length > 50) chatHist.shift();
      chatBroadcast(msg);
      return;
    }
    if (m.t === "hello" && /^[A-Za-z0-9_-]{4,40}$/.test(m.peer || "")) { ws.peer = m.peer; ws.send(JSON.stringify({ t: "ready" })); chatBroadcast({ t: "online", n: onlineCount() }); return; }
    if (!ws.peer) return;
    const room = String(m.room || "").slice(0, 80);
    if (!room) return;
    if (m.t === "join") {
      if (ws.rooms.size > 4) return;
      if (!rooms.has(room)) rooms.set(room, new Map());
      rooms.get(room).set(ws.peer, {});
      ws.rooms.add(room);
      ws.send(JSON.stringify({ t: "joined", room }));
      broadcast(room);
    } else if (m.t === "presence" && ws.rooms.has(room) && m.data && typeof m.data === "object") {
      const cur = rooms.get(room).get(ws.peer) || {};
      rooms.get(room).set(ws.peer, Object.assign(cur, m.data));
      broadcast(room);
    } else if (m.t === "leave") leave(ws, room);
  });
  ws.on("close", () => { for (const r of [...ws.rooms]) leave(ws, r); setTimeout(() => chatBroadcast({ t: "online", n: onlineCount() }), 100); });
});
// dọn kết nối chết
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
}, 20000);

server.listen(PORT, () => console.log("MEME FIGHTER chạy ở cổng " + PORT));
