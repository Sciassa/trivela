// End-to-end smoke test: single-screen match + rooms (Screen + phones) through a local MQTT relay.
// Usage: pnpm build && pnpm e2e   (screenshots in test-results/)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");
const Aedes = webRequire("aedes");
const { WebSocketServer, createWebSocketStream } = webRequire("ws");

const PORT = 8799;
const BASE = `http://localhost:${PORT}`;
mkdirSync("test-results", { recursive: true });

// the same kind of relay the public brokers offer, on localhost
const broker = new (Aedes.default ?? Aedes)();
const http = createServer();
new WebSocketServer({ server: http }).on("connection", (ws) => broker.handle(createWebSocketStream(ws)));
await new Promise((res) => http.listen(0, res));
const RELAY = `ws://localhost:${http.address().port}`;
const GAMES = "tiro_secco,maglia,mercato,decina,frame";
const ROOM = `${BASE}/?relay=${encodeURIComponent(RELAY)}&games=${GAMES}`;

const server = spawn("pnpm", ["--filter", "@trivela/web", "exec", "vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "pipe", detached: true });
await new Promise((res, rej) => {
  server.stdout.on("data", (d) => String(d).includes("Local") && res());
  server.on("exit", (c) => rej(new Error(`preview exited ${c}`)));
  setTimeout(() => rej(new Error("preview timeout")), 30000);
});

const browser = await chromium.launch();
const errors = [];
const open = async (ctxOpts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...ctxOpts });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${e.message}`));
  p.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  p.dataRequests = [];
  p.on("request", (r) => r.url().includes("/data/") && p.dataRequests.push(r.url()));
  return p;
};
const PHONE = { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true };
let failed = false;
const check = (cond, msg) => {
  if (!cond) {
    failed = true;
    console.error("FAIL:", msg);
  } else console.log("ok:", msg);
};
const lobby = async () => {
  const screen = await open();
  await screen.goto(ROOM);
  await screen.getByText("PREMI START").click();
  await screen.getByText("SCHERMO + TELEFONI").click();
  await screen.getByText("IN LINEA").waitFor();
  const code = (await screen.locator(".code").first().textContent()).trim();
  return { screen, code };
};
const join = async (code, role) => {
  const p = await open(PHONE);
  await p.goto(`${BASE}/?relay=${encodeURIComponent(RELAY)}#/join/${code}?r=${role}`);
  await p.getByText("COLLEGATO", { exact: true }).waitFor();
  return p;
};

try {
  // ---------------- single-screen match
  const p = await open();
  await p.goto(`${BASE}/?games=${GAMES}`);
  await p.getByText("PREMI START").click();
  await p.getByText("PARTITA COMPLETA").click();
  await p.getByPlaceholder("Nome").first().fill("Anna");
  await p.getByPlaceholder("Nome").nth(1).fill("Bruno");
  check((await p.getByText(/argomento/i).count()) === 0, "no free-topic field in the setup");
  // league picker: everything is on by default, at least one league always stays on, the choice is remembered
  const chip = (name) => p.locator(".league-pick button", { hasText: name });
  check((await p.locator('.league-pick button[aria-pressed="true"]').count()) === 5, "all five leagues are selected by default");
  for (const n of ["Serie A", "Premier League", "LaLiga", "Bundesliga", "Ligue 1"]) await chip(n).click();
  check((await p.locator('.league-pick button[aria-pressed="true"]').count()) === 1, "the last league cannot be switched off");
  await chip("Serie A").click();
  await chip("Premier League").click();
  await chip("Serie A").click();
  await p.getByText("GIOCA ▶").click();
  await p.getByText("SI PARTE ▶").click({ timeout: 15000 });
  const gameFiles = p.dataRequests.filter((u) => u.includes("/data/games/"));
  check(gameFiles.length === 5, `the screen downloads only the 5 drawn games (${gameFiles.length} files)`);
  await p.getByText("VIA! ▶").click();
  await p.locator(".option").first().waitFor();
  check((await p.locator(".option.right").count()) === 0, "no highlighted answer before the reveal");
  await p.locator(".option").first().click();
  await p.locator(".option.right").waitFor();
  await p.screenshot({ path: "test-results/local-reveal.png" });
  // a wrong answer is written in red for the whole room: the Screen shows what was tried
  let sawWrong = false;
  for (let q = 0; q < 4 && !sawWrong; q++) {
    const wrong = await p.locator(".option.wrongpick").count();
    if (wrong) {
      const tried = (await p.locator(".option.wrongpick").first().innerText()).replace(/^[ABCD]\s*/, "").trim();
      const said = await p.locator(".said-wrong").first();
      const text = await said.innerText();
      check(text.includes(tried), `the wrong option is shown on the Screen (${text.replace(/\n/g, " ")})`);
      const color = await said.evaluate((el) => getComputedStyle(el).color);
      check(color === "rgb(255, 59, 59)", `... and it is red (${color})`);
      sawWrong = true;
      break;
    }
    await p.locator(".btn.next").first().click();
    await p.locator(".option").first().waitFor();
    await p.locator(".option").first().click();
    await p.locator(".option.right").waitFor();
  }
  check(sawWrong, "a wrong answer was shown in red");
  check(errors.length === 0, `no page errors in the single-screen match (${errors.join(" | ")})`);
  await p.context().close();

  // ---------------- Sfida Rapida (one game, 3 rounds each) and Allenamento (alone), single screen
  {
    const q = await open();
    await q.goto(BASE);
    await q.getByText("PREMI START").click();
    await q.locator(".menu .btn", { hasText: "SFIDA RAPIDA" }).click();
    await q.getByText("IL FRAME").click();
    await q.getByPlaceholder("Nome").first().fill("Anna");
    await q.getByPlaceholder("Nome").nth(1).fill("Bruno");
    await q.getByText("GIOCA ▶").click();
    await q.getByText(/SFIDA RAPIDA · 3 ROUND A TESTA/).waitFor({ timeout: 15000 });
    await q.getByText("SI PARTE ▶").click({ timeout: 15000 });
    await q.getByText("VIA! ▶").click();
    await q.locator(".option").first().waitFor();
    check((await q.locator(".turnbar .info").first().innerText()).includes("PARTITA 1/6"), "sfida rapida: six matches, three each");
    const gameFiles = await q.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes("/data/games/")));
    check(gameFiles.length === 1, `sfida rapida downloads only the chosen game (${gameFiles.length})`);
    await q.context().close();

    const t = await open();
    await t.goto(BASE);
    await t.getByText("PREMI START").click();
    await t.locator(".menu .btn", { hasText: "ALLENAMENTO" }).click();
    await t.getByText("LA DECINA").click();
    check((await t.getByPlaceholder("Nome").count()) === 1, "allenamento asks for one name only");
    await t.getByText("GIOCA ▶").click();
    await t.getByText("ALLENAMENTO", { exact: true }).first().waitFor({ timeout: 15000 });
    await t.getByText("SI PARTE ▶").click({ timeout: 15000 });
    await t.getByText("VIA! ▶").click();
    await t.locator(".slots").waitFor();
    check((await t.locator(".hud-player").count()) === 1, "allenamento shows a single player and no opponent");
    await t.screenshot({ path: "test-results/training.png" });
    check(errors.length === 0, `no page errors in sfida rapida / allenamento (${errors.join(" | ")})`);
    await t.context().close();
  }

  // ---------------- room without a host: Screen + two controllers
  {
    const { screen, code } = await lobby();
    check(/^[A-HJ-NP-Z]{5}$/.test(code), `room ${code} created without any server of ours`);
    const p1 = await join(code, "p1");
    const p2 = await join(code, "p2");
    await screen.locator('.qr-card.joined[data-role="p2"]').waitFor();
    await screen.screenshot({ path: "test-results/room-lobby.png", fullPage: true });
    await p1.screenshot({ path: "test-results/pad-wait.png" });
    await screen.getByPlaceholder("Nome").first().fill("Anna");
    await screen.getByPlaceholder("Nome").nth(1).fill("Bruno");
    await screen.getByText("INIZIA LA PARTITA ▶").click();
    await p1.getByText("SI PARTE ▶").click({ timeout: 15000 });
    await p2.getByText("VIA! ▶").click();
    await screen.locator(".option").first().waitFor();
    check((await screen.locator(".arena input").count()) === 0, "the Screen shows no inputs when the phones are connected");
    // the controller of the player on turn shows the options
    await Promise.race([p1.locator(".option").first().waitFor(), p2.locator(".option").first().waitFor()]);
    const active = (await p1.locator(".option").count()) ? p1 : p2;
    const idle = active === p1 ? p2 : p1;
    check((await idle.locator(".option").count()) === 0, "only the player on turn can answer from the phone");
    await active.waitForTimeout(900);
    await active.screenshot({ path: "test-results/pad-turn.png" });
    const hasCorrect = await active.evaluate(() => document.body.innerHTML.includes("option right"));
    check(!hasCorrect, "the controller receives no solution before answering");
    await active.locator(".option").first().click();
    await screen.locator(".option.right").waitFor();
    await screen.screenshot({ path: "test-results/room-screen-reveal.png" });
    check(true, "an answer given on the phone is judged and revealed on the Screen");
    const questionFiles = [...p1.dataRequests, ...p2.dataRequests].filter((u) => u.includes("/data/games/"));
    check(questionFiles.length === 0, "controllers download no question data (only the names index)");
    // go on to the buzzer game to check the buzz path: finish Tiro Secco (3 more questions) and La Maglia
    for (let n = 0; n < 60; n++) {
      if (await screen.getByText("IL MERCATO").count()) break;
      for (const ph of [p1, p2]) {
        if (await ph.locator(".btn.next").count()) await ph.locator(".btn.next").first().click().catch(() => undefined);
        else if (await ph.locator(".option").count()) await ph.locator(".option").first().click().catch(() => undefined);
        else if (await ph.locator(".numpad").count()) {
          await ph.getByRole("button", { name: "7", exact: true }).click().catch(() => undefined);
          await ph.getByRole("button", { name: "OK", exact: true }).click().catch(() => undefined);
        }
      }
      await screen.waitForTimeout(250);
    }
    await screen.waitForTimeout(600);
    if (await p1.getByText("VIA! ▶").count()) await p1.getByText("VIA! ▶").click();
    await p2.locator(".big-buzz:not(:disabled)").waitFor({ timeout: 15000 });
    await screen.waitForTimeout(2600); // "PRONTI…" is over: the first clue is out
    await p2.locator(".big-buzz").dispatchEvent("pointerdown");
    await screen.getByText("RISPONDE!").waitFor();
    await p2.locator("input.input").waitFor();
    // the spelling helper works on the phones too, without revealing anything
    await p2.locator("input.input").fill("Lewandowsky");
    await p2.locator(".suggest button").first().waitFor({ timeout: 15000 });
    check((await p2.locator(".suggest button").allInnerTexts()).some((t) => /Lewandowski/.test(t)), "the controller shows spelling suggestions");
    await screen.screenshot({ path: "test-results/room-buzz.png" });
    await p2.screenshot({ path: "test-results/pad-answer.png" });
    check(true, "the buzzer pressed on a phone reaches the Screen");
    await screen.context().close();
    await p1.context().close();
    await p2.context().close();
  }

  // ---------------- room with a host: Screen + Regia
  {
    const { screen, code } = await lobby();
    const host = await join(code, "host");
    await screen.locator('.qr-card.joined[data-role="host"]').waitFor();
    await screen.getByText("INIZIA LA PARTITA ▶").click();
    await host.getByText("INIZIA ▶").click({ timeout: 15000 });
    await host.getByText("VIA AL GIOCO ▶").click();
    await host.locator(".solution-box").waitFor();
    const answerLine = (await host.locator(".solution-box").innerText()).split("\n").find((l) => l.startsWith("Risposta:")) ?? "";
    await host.screenshot({ path: "test-results/host.png", fullPage: true });
    check(/^Risposta: [ABCD]\) /.test(answerLine), "the Regia sees the solution");
    await screen.locator(".option").first().waitFor();
    check((await screen.locator(".option.right").count()) === 0, "the Screen does not show the answer before the reveal");
    check((await screen.locator(".btn.next").count()) === 0, "with a Regia connected only the host moves the game on");
    check(host.dataRequests.length === 0, "the Regia downloads no data at all");
    // timer controls: pause / play, +10 s, -10 s reach the Screen at once
    await host.locator(".timerpad").waitFor();
    const secs = async () => Number((await screen.locator(".timer-num").first().innerText()).replace(/\D/g, "") || "0");
    await host.getByText("II PAUSA").click();
    await screen.locator(".timer.paused").waitFor({ timeout: 5000 });
    const frozen = await screen.locator(".timer-pause").innerText();
    await screen.waitForTimeout(1500);
    check((await screen.locator(".timer-pause").innerText()) === frozen, `the Screen countdown stays frozen while paused (${frozen})`);
    check(await host.getByText("PLAY ▶").isVisible(), "the Regia offers PLAY while paused");
    await host.getByText("PLAY ▶").click();
    await screen.locator(".timer.paused").waitFor({ state: "detached", timeout: 5000 });
    const before = await secs();
    await host.getByText("+10 s").click();
    await screen.waitForFunction((b) => Number(document.querySelector(".timer-num")?.textContent) >= b + 8, before, { timeout: 5000 });
    check(true, "+10 s on the Regia adds ten seconds on the Screen");
    await host.getByText("−10 s").click();
    await screen.waitForFunction((b) => Number(document.querySelector(".timer-num")?.textContent) <= b + 1, before, { timeout: 5000 });
    check(true, "-10 s on the Regia removes ten seconds on the Screen");
    await host.locator(".btn.ok").first().click();
    await screen.locator(".option.right").waitFor();
    await screen.getByText("ESATTO!").waitFor();
    check(true, "the verdict given by the Regia reaches the Screen");
    await screen.context().close();
    await host.context().close();
  }
  // ---------------- Sfida Rapida in a room: Screen + two controllers, a buzzer game, 3 rounds each
  {
    const { screen, code } = await lobby();
    const p1 = await join(code, "p1");
    const p2 = await join(code, "p2");
    await screen.locator('.qr-card.joined[data-role="p2"]').waitFor();
    await screen.getByRole("button", { name: "SFIDA RAPIDA" }).click();
    check(await screen.getByRole("button", { name: "SCEGLI IL GIOCO" }).isDisabled(), "the lobby asks for a game before starting a sfida rapida");
    await screen.locator(".game-pick button", { hasText: "IL MERCATO" }).click();
    await screen.getByPlaceholder("Nome").first().fill("Anna");
    await screen.getByPlaceholder("Nome").nth(1).fill("Bruno");
    await screen.getByText("INIZIA LA PARTITA ▶").click();
    await p1.getByText("SI PARTE ▶").click({ timeout: 15000 });
    await screen.waitForTimeout(500);
    if (await p1.getByText("VIA! ▶").count()) await p1.getByText("VIA! ▶").click();
    await screen.getByText(/TRASFERIMENTO 1\/6/).waitFor({ timeout: 15000 });
    check(true, "sfida rapida in a room: six transfers, three rounds each");
    await screen.context().close();
    await p1.context().close();
    await p2.context().close();
  }
  check(errors.length === 0, `no page errors in rooms (${errors.join(" | ")})`);
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill();
  }
  broker.close();
  http.closeAllConnections();
  http.close();
}
process.exit(failed ? 1 : 0);
