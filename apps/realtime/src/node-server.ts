/**
 * Free local server for LAN play: serves the built web app and the rooms
 * WebSocket on the same port. Run `pnpm build && pnpm server`, then open
 * http://<IP-del-PC>:8787 on every device of the same Wi-Fi.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { WebSocketServer, type WebSocket } from "ws";
import { buildIndex } from "@trivela/matcher";
import { emptyPackItems, GAME_IDS, type GameId, type Packs } from "@trivela/protocol";
import { RoomCore, roomCode, type ClientMsg, type ClientRole, type Conn } from "./room";

const here = fileURLToPath(new URL(".", import.meta.url));
const WEB = resolve(here, "../../web/dist");
const PACKS = resolve(here, "../../web/public/data");
const PORT = Number(process.env.PORT ?? 8787);

async function json<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(PACKS, name), "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function loadPacks(): Promise<Packs> {
  const items = emptyPackItems();
  for (const g of GAME_IDS) (items as Record<GameId, unknown[]>)[g] = await json(`games/${g}.json`, []);
  return {
    manifest: await json("manifest.json", { version: "empty", generatedAt: "", snapshot: "", counts: {}, sources: [] }),
    items,
    entities: await json("entities.json", []),
    teammates: await json("teammates.json", { groups: {}, byPerson: {} }),
    topics: await json("topics.json", { neighbors: {} }),
  };
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

async function main() {
  const packs = await loadPacks();
  const ctx = { index: buildIndex(packs.entities), teammates: packs.teammates };
  const rooms = new Map<string, RoomCore>();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (path === "/" || path === "") path = "/index.html";
    let file = join(WEB, path);
    try {
      if (!(await stat(file)).isFile()) file = join(WEB, "index.html");
    } catch {
      file = join(WEB, "index.html");
    }
    try {
      const body = await readFile(file);
      const type = TYPES[extname(file)] ?? "application/octet-stream";
      const gz = /gzip/.test(String(req.headers["accept-encoding"] ?? "")) && /json|javascript|css|html/.test(type);
      res.writeHead(200, { "content-type": type, ...(gz ? { "content-encoding": "gzip" } : {}) });
      res.end(gz ? gzipSync(body) : body);
    } catch {
      res.writeHead(404).end("Build the web app first: pnpm build");
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws: WebSocket, req) => {
    const url = new URL(req.url ?? "/ws", "http://x");
    let code = (url.searchParams.get("room") ?? "").toUpperCase();
    const role = (url.searchParams.get("role") ?? "screen") as ClientRole;
    if (!["screen", "host", "p1", "p2"].includes(role)) return ws.close();
    if (role === "screen" && !code) {
      do code = roomCode();
      while (rooms.has(code));
      rooms.set(code, new RoomCore(code, packs, ctx));
    }
    const room = rooms.get(code);
    if (!room) {
      ws.send(JSON.stringify({ t: "error", msg: "Stanza inesistente" }));
      return ws.close();
    }
    const conn: Conn = {
      id: randomUUID(),
      role,
      token: url.searchParams.get("token") ?? randomUUID(),
      offset: 0,
      send: (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)),
    };
    conn.send({ t: "joined", code, role, token: conn.token });
    room.join(conn);
    ws.on("message", (data) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(data)) as ClientMsg;
      } catch {
        return;
      }
      if (msg.t === "ping") {
        // offset estimate: server time minus client time at the midpoint
        conn.send({ t: "pong", c: msg.c, s: Date.now() });
        return;
      }
      if ((msg as { t: string }).t === "offset") {
        conn.offset = Number((msg as unknown as { offset: number }).offset) || 0;
        return;
      }
      room.onMessage(conn, msg);
    });
    ws.on("close", () => {
      room.leave(conn.id);
      if (room.conns.size === 0) {
        setTimeout(() => {
          if (room.conns.size === 0) {
            room.dispose();
            rooms.delete(code);
          }
        }, 10 * 60_000);
      }
    });
  });

  server.listen(PORT, "0.0.0.0", () => {
    const ips = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i && i.family === "IPv4" && !i.internal)
      .map((i) => i!.address);
    console.log(`TRIVELA server on port ${PORT}`);
    for (const ip of ips) console.log(`  apri http://${ip}:${PORT} sugli altri dispositivi della stessa Wi-Fi`);
  });
}

void main();
