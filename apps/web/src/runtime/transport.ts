/**
 * Room transport without any server of ours (SPEC §12): the devices exchange
 * small messages through free public MQTT brokers (several at once, for
 * redundancy). Payloads are encrypted with a key derived from the room code,
 * so the brokers only relay opaque bytes.
 */
import { MqttLite } from "./mqtt";

/** Free public brokers with MQTT over secure WebSocket. */
export const PUBLIC_RELAYS = ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt", "wss://test.mosquitto.org:8081/mqtt"];

export interface Bus {
  subscribe(topic: string): void;
  publish(topic: string, payload: Uint8Array): void;
  close(): void;
}

interface BusHandlers {
  onMessage(topic: string, payload: Uint8Array): void;
  onStatus(connected: boolean): void;
}

function mqttBus(urls: string[], h: BusHandlers): Bus {
  const up = new Set<number>();
  const id = `trv${Math.random().toString(36).slice(2, 12)}`;
  const clients = urls.map(
    (url, k) =>
      new MqttLite(url, id, {
        onMessage: h.onMessage,
        onStatus(ok) {
          if (ok) up.add(k);
          else up.delete(k);
          h.onStatus(up.size > 0);
        },
      }),
  );
  return {
    subscribe: (t) => clients.forEach((c) => c.subscribe(t)),
    publish: (t, p) => clients.forEach((c) => c.publish(t, p)),
    close: () => clients.forEach((c) => c.close()),
  };
}

/** Same-browser transport (tabs of one device): used for demos and tests. */
function localBus(h: BusHandlers): Bus {
  const bc = new BroadcastChannel("trivela-rooms");
  const topics = new Set<string>();
  bc.onmessage = (ev: MessageEvent<{ topic: string; payload: Uint8Array }>) => {
    if (topics.has(ev.data.topic)) h.onMessage(ev.data.topic, ev.data.payload);
  };
  queueMicrotask(() => h.onStatus(true));
  return {
    subscribe: (t) => void topics.add(t),
    publish: (topic, payload) => bc.postMessage({ topic, payload }),
    close: () => bc.close(),
  };
}

/** `?relay=local` (same browser) or `?relay=ws://host:port` (own broker) override the public relays. */
export function relayParam(): string {
  return new URLSearchParams(location.search).get("relay") ?? "";
}

function openBus(h: BusHandlers): Bus {
  const p = relayParam();
  if (p === "local") return localBus(h);
  return mqttBus(p ? p.split(",") : PUBLIC_RELAYS, h);
}

/* ------------------------------------------------------------------ */

const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

interface Cipher {
  topic: string;
  seal(data: Uint8Array): Promise<Uint8Array>;
  open(data: Uint8Array): Promise<Uint8Array | null>;
}

async function cipherFor(code: string): Promise<Cipher> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // insecure origin (plain http on a LAN): no WebCrypto, messages travel in clear
    return { topic: `trivela/p/${code}`, seal: async (d) => d, open: async (d) => d };
  }
  const digest = async (s: string) => new Uint8Array(await subtle.digest("SHA-256", enc.encode(s)));
  const key = await subtle.importKey("raw", await digest(`trivela-key:${code}`), "AES-GCM", false, ["encrypt", "decrypt"]);
  return {
    topic: `trivela/v1/${hex((await digest(`trivela-topic:${code}`)).subarray(0, 12))}`,
    async seal(data) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const body = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, data));
      const out = new Uint8Array(12 + body.length);
      out.set(iv);
      out.set(body, 12);
      return out;
    },
    async open(data) {
      try {
        return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: data.subarray(0, 12) }, key, data.subarray(12)));
      } catch {
        return null; // not for this room
      }
    },
  };
}

export interface RoomLink {
  /** Unique id of this device in the room. */
  id: string;
  send(channel: string, msg: unknown): void;
  listen(channel: string): void;
  close(): void;
}

/**
 * Open the encrypted room channel. Sub-channels are plain suffixes ("up",
 * "pub", "host", "to/<id>"). Messages relayed twice (several brokers) are
 * delivered once.
 */
export function openRoom(code: string, onMessage: (channel: string, from: string, msg: unknown) => void, onStatus: (connected: boolean) => void): RoomLink {
  const id = Math.random().toString(36).slice(2, 10);
  let seq = 0;
  let closed = false;
  const seen = new Set<string>();
  const cipher = cipherFor(code);
  let inbox: Promise<void> = Promise.resolve();
  let outbox: Promise<void> = Promise.resolve();
  const bus = openBus({
    onStatus,
    onMessage(topic, payload) {
      inbox = inbox.then(async () => {
        const c = await cipher;
        if (closed || !topic.startsWith(`${c.topic}/`)) return;
        const plain = await c.open(payload);
        if (!plain) return;
        try {
          const m = JSON.parse(dec.decode(plain)) as { f: string; n: number; d: unknown };
          const key = `${m.f}:${m.n}`;
          if (m.f === id || seen.has(key)) return;
          seen.add(key);
          if (seen.size > 2000) seen.delete(seen.values().next().value as string);
          onMessage(topic.slice(c.topic.length + 1), m.f, m.d);
        } catch {
          /* malformed message from somebody else: ignore */
        }
      });
    },
  });
  return {
    id,
    send(channel, msg) {
      const n = ++seq;
      outbox = outbox.then(async () => {
        const c = await cipher;
        if (closed) return;
        bus.publish(`${c.topic}/${channel}`, await c.seal(enc.encode(JSON.stringify({ f: id, n, d: msg }))));
      });
    },
    listen(channel) {
      void cipher.then((c) => !closed && bus.subscribe(`${c.topic}/${channel}`));
    },
    close() {
      closed = true;
      bus.close();
    },
  };
}
