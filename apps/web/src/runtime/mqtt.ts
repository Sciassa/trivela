/**
 * Minimal MQTT 3.1.1 client over WebSocket (QoS 0 only): just what the rooms
 * need to exchange small messages through a free public broker. No dependencies.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function str(s: string): Uint8Array {
  const b = enc.encode(s);
  return concat([new Uint8Array([b.length >> 8, b.length & 255]), b]);
}

/** Fixed header + "remaining length" varint + body. */
export function packet(header: number, body: Uint8Array): Uint8Array {
  const len: number[] = [];
  let n = body.length;
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 128;
    len.push(b);
  } while (n > 0);
  return concat([new Uint8Array([header, ...len]), body]);
}

/** Split a byte stream into MQTT packets; returns the unconsumed tail. */
export function parsePackets(buf: Uint8Array, onPacket: (type: number, body: Uint8Array) => void): Uint8Array {
  let o = 0;
  for (;;) {
    if (buf.length - o < 2) break;
    let len = 0;
    let mult = 1;
    let i = o + 1;
    let complete = false;
    while (i < buf.length && i < o + 5) {
      const b = buf[i++]!;
      len += (b & 127) * mult;
      mult *= 128;
      if (!(b & 128)) {
        complete = true;
        break;
      }
    }
    if (!complete || buf.length - i < len) break;
    onPacket(buf[o]! >> 4, buf.subarray(i, i + len));
    o = i + len;
  }
  return buf.subarray(o);
}

export interface MqttHandlers {
  onMessage(topic: string, payload: Uint8Array): void;
  onStatus(connected: boolean): void;
}

export class MqttLite {
  private ws: WebSocket | null = null;
  private topics = new Set<string>();
  private buf: Uint8Array = new Uint8Array(0);
  private ready = false;
  private closed = false;
  private retry = 1000;
  private ping: ReturnType<typeof setInterval> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pid = 1;

  constructor(
    private url: string,
    private clientId: string,
    private h: MqttHandlers,
  ) {
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url, "mqtt");
    } catch {
      this.schedule();
      return;
    }
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      // protocol "MQTT" level 4, clean session, keep-alive 50 s
      ws.send(packet(0x10, concat([str("MQTT"), new Uint8Array([4, 2, 0, 50]), str(this.clientId)])));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") return;
      this.buf = parsePackets(concat([this.buf, new Uint8Array(ev.data as ArrayBuffer)]), (type, body) => this.onPacket(type, body));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.down();
      this.schedule();
    };
    ws.onerror = () => undefined;
  }

  private onPacket(type: number, body: Uint8Array) {
    if (type === 2) {
      // CONNACK
      if (body[1] !== 0) {
        this.ws?.close();
        return;
      }
      this.ready = true;
      this.retry = 1000;
      for (const t of this.topics) this.sendSubscribe(t);
      this.ping = setInterval(() => this.raw(new Uint8Array([0xc0, 0])), 20_000);
      this.h.onStatus(true);
    } else if (type === 3) {
      // PUBLISH (QoS 0)
      const n = (body[0]! << 8) | body[1]!;
      this.h.onMessage(dec.decode(body.subarray(2, 2 + n)), body.slice(2 + n));
    }
  }

  private down() {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    this.buf = new Uint8Array(0);
    if (this.ready) this.h.onStatus(false);
    this.ready = false;
  }

  private schedule() {
    if (this.closed) return;
    this.timer = setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(this.retry * 2, 8000);
  }

  private raw(p: Uint8Array) {
    if (this.ws?.readyState === 1) this.ws.send(p);
  }

  private sendSubscribe(topic: string) {
    this.pid = (this.pid % 65535) + 1;
    this.raw(packet(0x82, concat([new Uint8Array([this.pid >> 8, this.pid & 255]), str(topic), new Uint8Array([0])])));
  }

  subscribe(topic: string): void {
    this.topics.add(topic);
    if (this.ready) this.sendSubscribe(topic);
  }

  /** Fire and forget: messages published while offline are dropped. */
  publish(topic: string, payload: Uint8Array): void {
    if (this.ready) this.raw(packet(0x30, concat([str(topic), payload])));
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    this.down();
    try {
      if (ws?.readyState === 1) ws.send(new Uint8Array([0xe0, 0]));
      ws?.close();
    } catch {
      /* ignore */
    }
  }
}
