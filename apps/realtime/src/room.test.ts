import { describe, expect, it, vi } from "vitest";
import { RoomCore, roomCode, type Conn } from "./room";
import { makeCtx, makePacks } from "../../../packages/engine/src/fixtures.test-helpers";

function conn(role: Conn["role"]) {
  const msgs: any[] = [];
  const c: Conn = { id: role, role, token: role, offset: 0, send: (m) => msgs.push(m) };
  return { c, msgs, last: () => [...msgs].reverse().find((m) => m.t === "view") };
}

function setupRoom(withHost: boolean) {
  const packs = makePacks();
  const room = new RoomCore("ABCD", packs, makeCtx(packs));
  const screen = conn("screen");
  const host = conn("host");
  const p1 = conn("p1");
  const p2 = conn("p2");
  room.join(screen.c);
  if (withHost) room.join(host.c);
  room.join(p1.c);
  room.join(p2.c);
  room.onMessage(screen.c, {
    t: "setup",
    config: { players: ["A", "B"], yearFrom: null, topics: ["Juventus", "Udinese"], forcedGames: ["tiro_secco", "maglia", "frame", "intruso"], seed: 3 },
  });
  return { room, screen, host, p1, p2 };
}

describe("room", () => {
  it("never sends answers to the screen before the reveal", () => {
    const { room, screen, host } = setupRoom(true);
    room.onMessage(host.c, { t: "intent", intent: { type: "START" } });
    room.onMessage(host.c, { t: "intent", intent: { type: "BEGIN_GAME" } });
    const sv = screen.last().state;
    expect(sv.content).toEqual({});
    expect(JSON.stringify(sv.game.items[sv.game.i])).toContain('"correct":-1');
    const hv = host.last().state;
    expect(hv.game.items[hv.game.i].correct).toBe(1);
    room.dispose();
  });

  it("uses host judging when a host is connected", () => {
    const { room } = setupRoom(true);
    expect(room.state!.config.judging).toBe("host");
    room.dispose();
  });

  it("forces the player field for controllers and blocks flow intents when a host exists", () => {
    const { room, p1, host } = setupRoom(true);
    room.onMessage(p1.c, { t: "intent", intent: { type: "START" } });
    expect(room.state!.phase).toBe("draw");
    room.onMessage(host.c, { t: "intent", intent: { type: "START" } });
    expect(room.state!.phase).toBe("intro");
    expect(room.allowed("p1", { type: "ANSWER", player: 1, payload: { choice: 0 } })).toMatchObject({ player: 0 });
    room.dispose();
  });

  it("arbitrates buzzes by corrected client time inside the window", () => {
    vi.useFakeTimers();
    const { room, p1, p2 } = setupRoom(false);
    const applied: any[] = [];
    room.apply = (i) => applied.push(i);
    p1.c.offset = 0;
    p2.c.offset = 100; // p2's clock is 100 ms behind the server
    room.handleBuzz(p1.c, 1000); // corrected 1000
    room.handleBuzz(p2.c, 850); // corrected 950: earlier
    vi.advanceTimersByTime(200);
    expect(applied).toEqual([{ type: "BUZZ", player: 1 }]);
    vi.useRealTimers();
    room.dispose();
  });

  it("creates readable room codes", () => {
    const code = roomCode(() => 0.5);
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
  });
});
