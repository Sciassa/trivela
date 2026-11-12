import { describe, expect, it, vi } from "vitest";
import { createMatch } from "@trivela/engine";
import { isRoomCode, RoomCore, roomCode, type Channel, type DownMsg } from "./roomCore";
import { makeCtx, makePacks } from "../../../../packages/engine/src/fixtures.test-helpers";

function setupRoom(withHost: boolean) {
  const packs = makePacks();
  const sent: { ch: Channel; msg: DownMsg }[] = [];
  const room = new RoomCore(makeCtx(packs), (ch, msg) => sent.push({ ch, msg }));
  if (withHost) room.onMessage("h", { t: "hello", role: "host", rev: 0 });
  room.onMessage("a", { t: "hello", role: "p1", rev: 0 });
  room.onMessage("b", { t: "hello", role: "p2", rev: 0 });
  const r = createMatch({ judging: room.judging(), players: ["A", "B"], yearFrom: null, seed: 3, forcedGames: ["tiro_secco", "maglia", "frame", "mercato", "decina"] }, packs);
  if (!r.ok) throw new Error(r.reason);
  room.start(r.state);
  const last = (ch: "pub" | "host") => [...sent].reverse().find((x) => x.ch === ch && x.msg.t === "view")!.msg as Extract<DownMsg, { t: "view" }>;
  return { room, sent, last };
}

describe("room authority", () => {
  it("never sends answers to the controllers, only to the Regia", () => {
    const { room, last } = setupRoom(true);
    room.onMessage("h", { t: "intent", intent: { type: "START" } });
    room.onMessage("h", { t: "intent", intent: { type: "BEGIN_GAME" } });
    const pub = last("pub").state!;
    expect(pub.content).toEqual({});
    expect(JSON.stringify(pub.game!.items[pub.game!.i])).toContain('"correct":-1');
    const host = last("host").state!;
    expect(host.content).toEqual({}); // the Regia gets the current game only, not the whole match
    expect(host.game!.items[host.game!.i].correct).toBe(1);
    room.dispose();
  });

  it("uses host judging when a Regia is connected", () => {
    expect(setupRoom(true).room.state!.config.judging).toBe("host");
    expect(setupRoom(false).room.state!.config.judging).toBe("auto");
  });

  it("forces the player field for controllers and blocks flow intents when a host exists", () => {
    const { room } = setupRoom(true);
    room.onMessage("a", { t: "intent", intent: { type: "START" } });
    expect(room.state!.phase).toBe("draw");
    room.intent("screen", { type: "START" });
    expect(room.state!.phase).toBe("draw");
    room.onMessage("h", { t: "intent", intent: { type: "START" } });
    expect(room.state!.phase).toBe("intro");
    expect(room.allowed("p1", { type: "ANSWER", player: 1, payload: { choice: 0 } })).toMatchObject({ player: 0 });
    room.dispose();
  });

  it("ignores intents from unknown devices and timeouts from anybody", () => {
    const { room } = setupRoom(false);
    room.onMessage("stranger", { t: "intent", intent: { type: "START" } });
    expect(room.state!.phase).toBe("draw");
    room.onMessage("a", { t: "intent", intent: { type: "START" } });
    expect(room.state!.phase).toBe("intro");
    room.onMessage("a", { t: "intent", intent: { type: "TIMEOUT", timerId: 1 } });
    expect(room.state!.phase).toBe("intro");
    room.dispose();
  });

  it("arbitrates buzzes by corrected time inside the window", () => {
    vi.useFakeTimers();
    const { room } = setupRoom(false);
    const applied: unknown[] = [];
    room.apply = (i) => applied.push(i);
    room.onMessage("a", { t: "buzz", at: 1000 });
    room.onMessage("b", { t: "buzz", at: 950 }); // arrived later but pressed earlier
    vi.advanceTimersByTime(300);
    expect(applied).toEqual([{ type: "BUZZ", player: 1 }]);
    vi.useRealTimers();
    room.dispose();
  });

  it("drops the phones that stop sending heartbeats", () => {
    let t = 0;
    const room = new RoomCore(makeCtx(makePacks()), () => undefined, () => t);
    room.onMessage("a", { t: "hello", role: "p1", rev: 0 });
    expect(room.roster().p1).toBe(true);
    t = 20_000;
    room.sweep();
    expect(room.roster().p1).toBe(false);
  });

  it("answers a stale heartbeat with the current view", () => {
    const { room, sent } = setupRoom(false);
    const before = sent.length;
    room.onMessage("a", { t: "hello", role: "p1", rev: room.rev });
    expect(sent.length).toBe(before);
    room.onMessage("a", { t: "hello", role: "p1", rev: room.rev - 1 });
    expect(sent.length).toBe(before + 1);
    room.dispose();
  });

  it("creates readable room codes", () => {
    const code = roomCode(() => 0.5);
    expect(code).toMatch(/^[A-HJ-NP-Z]{5}$/);
    expect(isRoomCode(code)).toBe(true);
    expect(isRoomCode("ABIOX")).toBe(false);
  });
});
