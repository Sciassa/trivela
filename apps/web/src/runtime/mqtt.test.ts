import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Aedes from "aedes";
import { WebSocketServer, createWebSocketStream } from "ws";
import { MqttLite, packet, parsePackets } from "./mqtt";

describe("mqtt framing", () => {
  it("encodes the remaining length as a varint and parses split frames", () => {
    const body = new Uint8Array(300).fill(7);
    const p = packet(0x30, body);
    expect([...p.subarray(0, 3)]).toEqual([0x30, 0xac, 0x02]);
    const got: number[] = [];
    let rest = parsePackets(p.subarray(0, 100), (t) => got.push(t));
    expect(got).toEqual([]);
    const joined = new Uint8Array(rest.length + p.length - 100 + 2);
    joined.set(rest);
    joined.set(p.subarray(100), rest.length);
    joined.set([0xd0, 0], rest.length + p.length - 100);
    rest = parsePackets(joined, (t, b) => got.push(t, b.length));
    expect(got).toEqual([3, 300, 13, 0]);
    expect(rest.length).toBe(0);
  });
});

describe("mqtt client against a real broker", () => {
  let http: Server;
  let url = "";
  const broker = new Aedes();
  beforeAll(async () => {
    http = createServer();
    const wss = new WebSocketServer({ server: http });
    wss.on("connection", (ws) => broker.handle(createWebSocketStream(ws) as never));
    await new Promise<void>((res) => http.listen(0, res));
    url = `ws://localhost:${(http.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await new Promise((res) => broker.close(() => res(null)));
    http.closeAllConnections();
    http.close();
  });

  it("delivers published messages to subscribers, large payloads included", async () => {
    const got: { topic: string; size: number; first: number }[] = [];
    const ready = (c: (ok: () => void) => MqttLite) => new Promise<MqttLite>((res) => {
      const client: MqttLite = c(() => res(client));
    });
    const a = await ready((ok) => new MqttLite(url, "a", { onMessage: (topic, p) => got.push({ topic, size: p.length, first: p[0]! }), onStatus: (s) => s && ok() }));
    const b = await ready((ok) => new MqttLite(url, "b", { onMessage: () => undefined, onStatus: (s) => s && ok() }));
    a.subscribe("room/x/pub");
    await new Promise((r) => setTimeout(r, 100));
    b.publish("room/x/pub", new Uint8Array([5, 6, 7]));
    b.publish("room/x/other", new Uint8Array([1]));
    b.publish("room/x/pub", new Uint8Array(70_000).fill(9));
    await new Promise((r) => setTimeout(r, 300));
    expect(got).toEqual([
      { topic: "room/x/pub", size: 3, first: 5 },
      { topic: "room/x/pub", size: 70_000, first: 9 },
    ]);
    a.close();
    b.close();
  });
});
