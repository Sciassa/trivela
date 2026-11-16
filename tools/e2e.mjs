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
const GAMES = "tiro_secco,maglia,mercato,decina,formazione";
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
  // record the vibrations asked by the app (SPEC §12.9)
  await ctx.addInitScript(() => {
    window.__vib = [];
    Object.defineProperty(Navigator.prototype, "vibrate", { configurable: true, value: (p) => (window.__vib.push(Array.isArray(p) ? p.join(",") : String(p)), true) });
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${e.message}`));
  p.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  p.dataRequests = [];
  p.on("request", (r) => r.url().includes("/data/") && p.dataRequests.push(r.url()));
  return p;
};
// the answers of a controller are the buttons pinned to the bottom of the phone
const PAD_OPT = ".phone-actions .btn:not(.next)";
const PHONE = { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true };
let failed = false;
const check = (cond, msg) => {
  if (!cond) {
    failed = true;
    console.error("FAIL:", msg);
  } else console.log("ok:", msg);
};
/** Type on the game's own keyboard (touch devices never open the keyboard of the system). */
const typeVK = async (page, text) => {
  for (const ch of text.toUpperCase()) await page.locator(`.vk-key[data-key="${ch}"]`).tap();
};
const boxOf = async (loc) => (await loc.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
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
  await p.getByText("PARTITA CLASSICA").click();
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
  // the exit control is discreet, asks for a confirmation, and leaves the game running when cancelled
  await p.locator(".exit-btn").waitFor();
  const exitOpacity = await p.locator(".exit-btn").evaluate((el) => Number(getComputedStyle(el).opacity));
  check(exitOpacity < 0.6, `the exit button is half transparent until hovered (${exitOpacity})`);
  await p.locator(".exit-btn").click();
  check(await p.getByText("SEI SICURO DI VOLER TERMINARE LA SFIDA?").isVisible(), "ending the match asks for a confirmation");
  await p.getByRole("button", { name: "CONTINUA" }).click();
  check((await p.locator(".option").count()) === 4, "cancelling the confirmation leaves the game as it was");
  // a wrong answer is written in red for the whole room: the Screen shows what was tried
  let sawWrong = false;
  let sawPop = false;
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
    if ((await p.locator(".option.wrongpick").count()) === 0 && (await p.locator(".pop-plus.up").count()) > 0) sawPop = true;
  }
  check(sawWrong, "a wrong answer was shown in red");
  if (sawPop) check(true, "a right answer makes a +N pop up");
  // ending the match for good goes back to the menu
  await p.locator(".exit-btn").click();
  await p.getByRole("button", { name: "SÌ, TERMINA" }).click();
  await p.locator(".menu-card").first().waitFor();
  check(true, "confirming the exit goes back to the home menu");
  check(errors.length === 0, `no page errors in the single-screen match (${errors.join(" | ")})`);
  await p.context().close();

  // ---------------- Sfida Rapida (one game, 3 rounds each) and Allenamento (alone), single screen
  {
    const q = await open();
    await q.goto(BASE);
    await q.getByText("PREMI START").click();
    await q.locator(".menu-card", { hasText: "SFIDA RAPIDA" }).click();
    await q.locator(".game-pick button", { hasText: "TIRO SECCO" }).click();
    await q.getByPlaceholder("Nome").first().fill("Anna");
    await q.getByPlaceholder("Nome").nth(1).fill("Bruno");
    await q.getByText("GIOCA ▶").click();
    await q.getByText(/SFIDA RAPIDA · 3 ROUND A TESTA/).waitFor({ timeout: 15000 });
    await q.getByText("SI PARTE ▶").click({ timeout: 15000 });
    await q.getByText("VIA! ▶").click();
    await q.locator(".option").first().waitFor();
    check((await q.locator(".turnbar .info").first().innerText()).includes("DOMANDA 1/6"), "sfida rapida: six questions, three each");
    const gameFiles = await q.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes("/data/games/")));
    check(gameFiles.length === 1, `sfida rapida downloads only the chosen game (${gameFiles.length})`);
    await q.context().close();

    const t = await open();
    await t.goto(BASE);
    await t.getByText("PREMI START").click();
    await t.locator(".menu-card", { hasText: "ALLENAMENTO" }).click();
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

  // ---------------- a phone held sideways (touch): in-game keyboard, grace period, rotation, safe areas
  {
    const m = await open({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    await m.goto(`${BASE}/?games=decina,mercato,tiro_secco,maglia,formazione`);
    // a notch on the left, the camera on the right, the home bar below
    await m.evaluate(() => ["--sal:47px", "--sar:47px", "--sab:21px"].forEach((x) => document.documentElement.style.setProperty(...x.split(":"))));
    await m.getByText("PREMI START").tap();
    await m.locator(".menu-settings").waitFor();
    await m.waitForTimeout(600);
    check(await m.locator(".menu-settings").isVisible(), "the tap on PREMI START does not press the menu card under the finger");
    check(await m.evaluate(() => document.fullscreenElement !== null), "on a phone's browser the first tap goes full screen (no address bar)");
    // the test browser cannot be resized while in full screen: leave it, the app keeps working the same
    await m.evaluate(() => document.exitFullscreen());
    check((await m.locator('.set-seg button[aria-pressed="true"]').innerText()) === "ON", "the timer is on by default, in sight on the home screen");
    const cards = await m.locator(".menu-card").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).every((b) => b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight));
    check(cards, "every card of the home fits a phone held sideways");
    await m.screenshot({ path: "test-results/home-phone.png" });
    await m.getByText("PARTITA CLASSICA").tap();
    await m.getByText("GIOCA ▶").tap();
    await m.getByText("SI PARTE ▶").tap({ timeout: 15000 });
    await m.getByText("VIA! ▶").tap();
    const t0 = Date.now();
    await m.locator(".vk-layer.over .vk-key").first().waitFor();
    check(true, "on a phone held sideways the keyboard opens by itself with its own strip");
    const hud = await boxOf(m.locator(".hud-player.p1"));
    const q = await boxOf(m.locator('.vk-key[data-key="Q"]'));
    const okKey = await boxOf(m.locator('.vk-key[data-key="OK"]'));
    const exit = await boxOf(m.locator(".exit-btn"));
    check(hud.x >= 47 && q.x >= 47 && okKey.x + okKey.width <= 844 - 47 + 1 && okKey.y + okKey.height <= 390 - 21 + 1 && exit.x + exit.width <= 844 - 47 + 1,
      `scoreboard and keyboard stay clear of notch, camera and home bar (hud ${Math.round(hud.x)}, exit right ${Math.round(exit.x + exit.width)}, Q ${Math.round(q.x)}, INVIA right ${Math.round(okKey.x + okKey.width)}, bottom ${Math.round(okKey.y + okKey.height)})`);
    check(exit.width >= 48 && exit.height >= 48, `the exit button is at least 48×48 real pixels on a phone (${Math.round(exit.width)}×${Math.round(exit.height)})`);
    check((await m.evaluate(() => getComputedStyle(document.documentElement).touchAction)) === "manipulation", "double-tap zoom is off (touch-action: manipulation)");
    const between = await m.evaluate(() => {
      const r = document.querySelector('.vk-key[data-key="A"]').getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top - 2)?.closest(".vk-key")?.getAttribute("data-key");
    });
    check(between === "A" || between === "Q", `the gaps between keys still hit a key (${between})`);
    await typeVK(m, "Lewandowsky");
    check((await m.locator(".vk-mirror").innerText()).trim() === "Lewandowsky", "what is typed is written above the keys");
    const kb = await boxOf(m.locator(".vk"));
    const sg = await boxOf(m.locator(".vk-top .suggest button").first());
    check(sg.height > 0 && sg.y + sg.height <= kb.y + 1, "the suggestions are above the keys, never under them");
    check((await m.locator(".vk-prompt").innerText()).length > 10 && (await m.locator(".vk-ctx .timer-num").count()) === 1, "the strip shows the question and the countdown");
    await m.screenshot({ path: "test-results/phone-keyboard.png" });
    for (let k = 0; k < 11; k++) await m.locator('.vk-key[data-key="DEL"]').tap();
    await typeVK(m, "Mar");
    // grace period: the countdown runs out, ten more seconds to finish typing
    await m.locator('.vk-ctx .timer[data-grace="true"]').waitFor({ timeout: 40000 });
    const graceAt = Date.now() - t0;
    check((await m.evaluate(() => window.__vib)).includes("120,60,120"), "the phone vibrates when the ten extra seconds start");
    check(graceAt > 27000, `the grace period starts when the 30 seconds are over (${(graceAt / 1000).toFixed(1)} s)`);
    check((await m.locator(".lives").allInnerTexts()).every((x) => !x.includes("♡")), "no error is counted when the countdown runs out");
    await m.screenshot({ path: "test-results/phone-grace.png" });
    // the phone is turned upright by mistake, then back
    await m.setViewportSize({ width: 390, height: 844 });
    await m.locator(".rotate-overlay").waitFor();
    check((await m.locator(".rotate-overlay").innerText()).includes("ruota il dispositivo") && !(await m.locator(".vk-layer").isVisible()), "held upright, the phone shows the rotate notice over everything");
    await m.screenshot({ path: "test-results/phone-rotated.png" });
    await m.setViewportSize({ width: 844, height: 390 });
    await m.locator(".vk-layer.over").waitFor();
    check((await m.locator(".vk-mirror").innerText()).trim() === "Mar", "turned back, the typed text is still there");
    check((await m.locator('.vk-ctx .timer[data-grace="true"]').count()) === 1 && (await m.locator(".hud-score").first().innerText()) === "0", "turned back, countdown and scores are where they were");
    await typeVK(m, "io");
    check((await m.locator(".vk-mirror").innerText()).trim() === "Mario", "typing goes on during the grace period");
    await m.waitForFunction(() => [...document.querySelectorAll(".lives")].some((e) => e.textContent.includes("♡")), null, { timeout: 15000 });
    const lostAt = Date.now() - t0;
    check(lostAt - graceAt > 8000 && lostAt - graceAt < 12500, `the answer is lost only when the ten extra seconds are over too (${((lostAt - graceAt) / 1000).toFixed(1)} s)`);
    // the keys cover the board: the keyboard itself says whether the name just sent was right
    await m.locator(".vk-layer.over .vk-key").first().waitFor();
    await typeVK(m, "Qwxz");
    await m.locator('.vk-key[data-key="OK"]').tap();
    const verdict = m.locator(".vk-layer.over .vk-verdict");
    await verdict.waitFor({ timeout: 3000 });
    check((await verdict.getAttribute("class")).includes("ko") && (await verdict.innerText()).toUpperCase().includes("QWXZ"), `a wrong name is shown in red on the keyboard strip, with what was typed (${(await verdict.innerText()).replace(/\s+/g, " ")})`);
    check((await m.evaluate(() => window.__vib)).includes("70,40,70,40,70"), "and the phone buzzes the 'wrong' pattern");
    await m.screenshot({ path: "test-results/phone-verdict.png" });
    await m.context().close();

    // a tablet has room: the keyboard is docked and the board stays in sight above it
    const tb = await open({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });
    await tb.goto(`${BASE}/?games=decina,mercato,tiro_secco,maglia,formazione`);
    await tb.getByText("PREMI START").tap();
    await tb.getByText("PARTITA CLASSICA").tap();
    await tb.getByText("GIOCA ▶").tap();
    await tb.getByText("SI PARTE ▶").tap({ timeout: 15000 });
    await tb.getByText("VIA! ▶").tap();
    await tb.locator(".vk-layer.dock .vk-key").first().waitFor();
    await typeVK(tb, "Lewandowsky");
    await tb.locator(".arena .suggest button").first().waitFor();
    const tkb = await boxOf(tb.locator(".vk"));
    const wrap = await boxOf(tb.locator(".stage-wrap"));
    const fieldBox = await boxOf(tb.locator(".arena input.vk-field"));
    const tsg = await boxOf(tb.locator(".arena .suggest button").first());
    check(Math.abs(wrap.y + wrap.height - tkb.y) <= 2, "on a tablet the stage shrinks to end where the keyboard begins");
    check(fieldBox.y + fieldBox.height <= tkb.y + 1 && tsg.y + tsg.height <= tkb.y + 1 && (await tb.locator(".slots").isVisible()), "field, suggestions and board are all visible above the docked keyboard");
    await tb.screenshot({ path: "test-results/tablet-keyboard.png" });
    await tb.context().close();
    check(errors.length === 0, `no page errors with the in-game keyboard (${errors.join(" | ")})`);
  }

  // ---------------- timer off: no countdown, clues by hand, "non lo so"
  {
    const o = await open();
    await o.goto(`${BASE}/?games=mercato,decina,tiro_secco,maglia,formazione`);
    await o.getByText("PREMI START").click();
    await o.locator(".set-seg button", { hasText: "OFF" }).click();
    await o.locator(".set-step button").last().click();
    check((await o.locator(".set-value").innerText()) === "DAL 2014 IN POI", "the year filter is set on the home screen");
    await o.reload();
    await o.getByText("PREMI START").click();
    check((await o.locator('.set-seg button[aria-pressed="true"]').innerText()) === "OFF" && (await o.locator(".set-value").innerText()) === "DAL 2014 IN POI", "timer and year filter are remembered");
    await o.locator(".set-step button").first().click();
    await o.getByText("PARTITA CLASSICA").click();
    check((await o.getByText(/TIMER SPENTO/).count()) === 1, "the set-up page says that the timer is off");
    await o.getByText("GIOCA ▶").click();
    await o.getByText("SI PARTE ▶").click({ timeout: 15000 });
    await o.getByText("VIA! ▶").click();
    await o.getByText("PROSSIMO INDIZIO ▶").waitFor({ timeout: 8000 });
    await o.waitForTimeout(9500);
    check((await o.locator(".clue.shown").count()) === 1 && (await o.locator(".timer:not(.idle)").count()) === 0, "timer off: no countdown, and no clue comes out by itself");
    await o.getByText("PROSSIMO INDIZIO ▶").click();
    check((await o.locator(".clue.shown").count()) === 2, "PROSSIMO INDIZIO uncovers one clue (and the points go down)");
    await o.keyboard.press("a");
    await o.getByText("NON LO SO").waitFor();
    await o.waitForTimeout(11000);
    check((await o.locator(".arena input.input").count()) === 1, "timer off: the answer has no time limit");
    await o.getByText("NON LO SO").click();
    await o.locator(".buzz-btn.p1", { hasText: "FUORI" }).waitFor();
    check(true, "timer off: the player can give up the answer");
    await o.screenshot({ path: "test-results/timer-off.png" });
    check(errors.length === 0, `no page errors with the timer off (${errors.join(" | ")})`);
    await o.context().close();
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
    const painted = (page, sel) => page.locator(sel).first().evaluate((c) => {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n / (c.width * c.height);
    });
    const cover = await painted(p1, "canvas.voxel");
    check(cover > 0.2 && cover < 0.9, `the waiting phone shows the voxel ball (${Math.round(cover * 100)}% of its canvas painted)`);
    check((await p1.locator("canvas.voxel").evaluate((c) => getComputedStyle(c).imageRendering)) === "pixelated", "the voxel canvas is enlarged with nearest-neighbour pixels");
    await screen.getByPlaceholder("Nome").first().fill("Anna");
    await screen.getByPlaceholder("Nome").nth(1).fill("Bruno");
    await screen.getByText("INIZIA LA PARTITA ▶").click();
    // consensus (SPEC §12.8): one phone alone does not move the game on
    await p1.getByText("SI PARTE ▶").click({ timeout: 15000 });
    await p1.getByText("1/2 · IN ATTESA DELL'AVVERSARIO…").waitFor({ timeout: 5000 });
    check(await p1.locator('.btn[data-vote="next"]').isDisabled(), "the first phone to press SI PARTE waits: 1/2, button disabled");
    await screen.locator(".vote-badge.live .vote-who.on").waitFor({ timeout: 5000 });
    check((await screen.locator(".vote-badge .vote-who.on").count()) === 1 && (await screen.locator(".draw-grid").count()) === 1, "the Screen shows one green check and stays on the draw");
    check((await screen.locator(".btn.next").count()) === 0, "with two phones the Screen has no AVANTI of its own");
    check((await p2.getByText(/SI PARTE ▶ · 1\/2/).count()) === 1, "the other phone sees that the opponent is ready");
    await screen.screenshot({ path: "test-results/room-vote-screen.png" });
    await p1.screenshot({ path: "test-results/pad-vote.png" });
    await p2.getByText(/SI PARTE ▶/).click();
    await p1.getByText("VIA! ▶").click({ timeout: 15000 });
    await p2.getByText(/VIA! ▶/).click();
    await screen.locator(".option").first().waitFor();
    check(true, "with both phones pressing, the game starts");
    check((await screen.locator(".arena input").count()) === 0, "the Screen shows no inputs when the phones are connected");
    // the controller of the player on turn shows the options
    await Promise.race([p1.locator(PAD_OPT).first().waitFor(), p2.locator(PAD_OPT).first().waitFor()]);
    const active = (await p1.locator(PAD_OPT).count()) ? p1 : p2;
    const idle = active === p1 ? p2 : p1;
    check((await idle.locator(PAD_OPT).count()) === 0, "only the player on turn can answer from the phone");
    await active.waitForTimeout(900);
    await active.screenshot({ path: "test-results/pad-turn.png" });
    const hasCorrect = await active.evaluate(() => document.body.innerHTML.includes("option right"));
    check((await active.locator(PAD_OPT).count()) === 4, "the four answers sit in the thumb area of the controller");
    const box = await active.locator(PAD_OPT).last().boundingBox();
    check(!!box && box.y + box.height <= 780 + 1 && box.height >= 56, `... fully visible without scrolling, tall enough to tap (${Math.round(box?.height ?? 0)} px)`);
    check(!hasCorrect, "the controller receives no solution before answering");
    await active.locator(PAD_OPT).first().click();
    await screen.locator(".option.right").waitFor();
    await screen.screenshot({ path: "test-results/room-screen-reveal.png" });
    check(true, "an answer given on the phone is judged and revealed on the Screen");
    const questionFiles = [...p1.dataRequests, ...p2.dataRequests].filter((u) => u.includes("/data/games/"));
    check(questionFiles.length === 0, "controllers download no question data (only the names index)");
    // go on to the buzzer game to check the buzz path: finish Tiro Secco (3 more questions) and La Maglia
    for (let n = 0; n < 60; n++) {
      if (await screen.locator(".hud-game", { hasText: "IL MERCATO" }).count()) break; // the intro of the buzzer game
      for (const ph of [p1, p2]) {
        if (await ph.locator(".btn.next").count()) await ph.locator(".btn.next").first().click().catch(() => undefined);
        else if (await ph.locator(PAD_OPT).count()) await ph.locator(PAD_OPT).first().click().catch(() => undefined);
        else if (await ph.locator(".numpad").count()) {
          await ph.getByRole("button", { name: "7", exact: true }).click().catch(() => undefined);
          await ph.getByRole("button", { name: "OK", exact: true }).click().catch(() => undefined);
        }
      }
      await screen.waitForTimeout(250);
    }
    await screen.waitForTimeout(600);
    for (const ph of [p1, p2]) if (await ph.getByText(/^VIA! ▶/).count()) await ph.getByText(/^VIA! ▶/).click();
    await p2.locator(".buzz3d:not(:disabled)").waitFor({ timeout: 15000 }).catch(async (e) => {
      await screen.screenshot({ path: "test-results/debug-screen.png" });
      await p1.screenshot({ path: "test-results/debug-p1.png" });
      await p2.screenshot({ path: "test-results/debug-p2.png" });
      throw e;
    });
    await screen.waitForTimeout(2600); // "PRONTI…" is over: the first clue is out
    await p2.screenshot({ path: "test-results/pad-buzzer.png" });
    await p2.locator(".buzz3d").dispatchEvent("pointerdown");
    check(await p2.locator(".buzz3d.down").count() === 1, "the 3D button sinks while it is pressed");
    const capZ = await p2.locator(".buzz3d .b3-cap").evaluate((e) => getComputedStyle(e).transform);
    check(capZ !== "none", `the top of the 3D button moves along Z (${capZ.slice(0, 40)}…)`);
    check((await p2.evaluate(() => window.__vib)).includes("50"), "pressing the buzzer vibrates once (50 ms)");
    await p1.waitForFunction(() => window.__vib.includes("30,50,30"), null, { timeout: 5000 });
    check(true, "the phone that was beaten to the buzzer vibrates twice (30, 50, 30)");
    await screen.getByText("RISPONDE!").waitFor();
    await p2.locator("input.input").waitFor();
    // the controller writes with the game's keyboard: the system one never opens, so nothing covers the suggestions
    const field = p2.locator("input.input.vk-field");
    check((await field.getAttribute("inputmode")) === "none" && (await field.getAttribute("readonly")) !== null, "on a phone the answer field never opens the system keyboard");
    await p2.locator(".vk-layer.dock .vk-key").first().waitFor();
    await typeVK(p2, "Lewandowsky");
    check((await field.inputValue()) === "Lewandowsky", `the keys of the in-game keyboard write in the field (${await field.inputValue()})`);
    // the spelling helper works on the phones too, without revealing anything
    await p2.locator(".suggest button").first().waitFor({ timeout: 15000 });
    check((await p2.locator(".suggest button").allInnerTexts()).some((t) => /Lewandowski/.test(t)), "the controller shows spelling suggestions");
    const kb = await boxOf(p2.locator(".vk"));
    const sg = await boxOf(p2.locator(".suggest button").first());
    check(sg.y + sg.height <= kb.y + 1 && sg.y >= 0, `the suggestions sit above the keyboard, in sight (${Math.round(sg.y + sg.height)} <= ${Math.round(kb.y)})`);
    const shell = await boxOf(p2.locator(".phone-shell"));
    check(Math.abs(shell.y + shell.height - kb.y) <= 2, "the controller page ends where the keyboard begins");
    check(kb.y + kb.height <= 780 + 1 && (await boxOf(p2.locator('.vk-key[data-key="Q"]'))).height >= 38, "the keyboard fits the phone and its keys are big enough");
    await p2.locator(".suggest button", { hasText: "Robert Lewandowski" }).tap();
    check((await field.inputValue()) === "Robert Lewandowski", "a suggestion can be tapped while the keyboard is open");
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
    const end = await boxOf(host.locator(".phone-end"));
    check(end.width >= 48 && end.height >= 48, `the end button of the Regia is a 48 px target (${Math.round(end.width)}×${Math.round(end.height)})`);
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
    await screen.locator(".pop-plus.up").first().waitFor({ timeout: 3000 });
    check((await screen.locator(".pop-plus.up").first().innerText()).includes("+2"), "a right answer makes a green +2 rise on the Screen");
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
    await screen.evaluate(() => localStorage.setItem("trivela.timer", "off")); // set on the home screen of the Screen
    await screen.getByText("INIZIA LA PARTITA ▶").click();
    await p1.getByText("SI PARTE ▶").click({ timeout: 15000 });
    await p2.getByText(/SI PARTE ▶/).click();
    await p1.getByText("VIA! ▶").click({ timeout: 15000 });
    await p2.getByText(/VIA! ▶/).click();
    await screen.getByText(/TRASFERIMENTO 1\/6/).waitFor({ timeout: 15000 });
    check(true, "sfida rapida in a room: six transfers, three rounds each");
    // timer off: PROSSIMO INDIZIO needs both phones
    await p1.getByText("PROSSIMO INDIZIO ▶").waitFor({ timeout: 8000 });
    check((await screen.locator(".clue.shown").count()) === 1, "timer off in a room: one clue, and nothing comes out by itself");
    await p1.getByText("PROSSIMO INDIZIO ▶").click();
    await p1.getByText("1/2 · IN ATTESA DELL'AVVERSARIO…").waitFor({ timeout: 5000 });
    await screen.locator(".vote-badge.live").waitFor({ timeout: 5000 });
    await screen.waitForTimeout(800);
    check((await screen.locator(".clue.shown").count()) === 1, "one phone asking for the next clue is not enough");
    check((await screen.locator(".vote-badge.live").innerText()).includes("PROSSIMO INDIZIO") && (await screen.locator(".vote-badge .vote-who.on").count()) === 1, "the Screen shows who asked for the next clue");
    await screen.screenshot({ path: "test-results/room-vote-clue.png" });
    await p2.getByText(/PROSSIMO INDIZIO ▶/).click();
    await screen.waitForFunction(() => document.querySelectorAll(".clue.shown").length === 2, null, { timeout: 5000 });
    check(true, "when the second phone asks too, the next clue comes out");
    check((await p1.getByText("PROSSIMO INDIZIO ▶").count()) === 1, "after the clue the buttons are free again");
    await screen.context().close();
    await p1.context().close();
    await p2.context().close();
  }
  // ---------------- Testa a Testa in a room: played from the controller, no value reaches Screen or phones before its turn
  {
    const { screen, code } = await lobby();
    const p1 = await join(code, "p1");
    const p2 = await join(code, "p2");
    await screen.locator('.qr-card.joined[data-role="p2"]').waitFor();
    await screen.getByRole("button", { name: "SFIDA RAPIDA" }).click();
    await screen.locator(".game-pick button", { hasText: "TESTA A TESTA" }).click();
    await screen.getByPlaceholder("Nome").first().fill("Anna");
    await screen.getByPlaceholder("Nome").nth(1).fill("Bruno");
    await screen.getByText("INIZIA LA PARTITA ▶").click();
    await p1.getByText("SI PARTE ▶").click({ timeout: 15000 });
    await p2.getByText(/SI PARTE ▶/).click();
    await p1.getByText("VIA! ▶").click({ timeout: 15000 });
    await p2.getByText(/VIA! ▶/).click();
    await screen.locator(".tt-card.challenger").waitFor({ timeout: 15000 });
    await Promise.race([p1.locator(".duel-more").waitFor(), p2.locator(".duel-more").waitFor()]);
    const active = (await p1.locator(".duel-more").count()) ? p1 : p2;
    const idle = active === p1 ? p2 : p1;
    check((await idle.locator(".duel-more").count()) === 0, "Testa a Testa: only the player on turn gets PIÙ / MENO");
    const more = await boxOf(active.locator(".duel-more"));
    check(more.height >= 48, `PIÙ / MENO are big enough to tap (${Math.round(more.height)} px)`);
    check((await screen.locator(".tt-card.challenger .tt-value").innerText()).includes("???"), "the Screen shows ??? for the challenger's value");
    const before = (await screen.content()) + (await p1.content()) + (await p2.content());
    await active.screenshot({ path: "test-results/pad-testa.png" });
    // the duel: MORE every time, from whichever phone is on turn, until somebody is wrong or the chain ends
    let passed = false;
    for (let n = 0; n < 12 && !(await screen.locator(".tt-ladder").count()); n++) {
      const who = (await p1.locator(".duel-more").count()) ? p1 : (await p2.locator(".duel-more").count()) ? p2 : null;
      if (who) {
        if (n > 0 && who !== active) passed = true;
        await who.locator(".duel-more").click();
      }
      await screen.waitForTimeout(2300);
    }
    await screen.locator(".tt-ladder").waitFor({ timeout: 8000 });
    const labels = await screen.locator(".tt-ladder span").allInnerTexts();
    const shown = labels[0].split(" ").slice(-2).join(" ");
    const hidden = labels.slice(1).map((l) => l.split(" ").slice(-2).join(" ")).filter((l) => l !== shown);
    const leaked = hidden.filter((l) => before.includes(`>${l}<`));
    check(labels.length === 9 && leaked.length === 0, `Screen and phones got no value before it was compared (${leaked.join(", ") || "none"})`);
    const banner = await screen.locator(".tt-banner").innerText();
    check(/VINCE IL DUELLO \+3|CATENA COMPLETA/.test(banner), `the duel ends with a winner (+3) or a full chain (${banner})`);
    check(passed || /VINCE/.test(banner), "after a right guess the chain passes to the other phone");
    await screen.screenshot({ path: "test-results/room-testa-reveal.png" });
    await screen.context().close();
    await p1.context().close();
    await p2.context().close();
  }
  {
    const v = await open();
    await v.goto(`${BASE}/?voxel`);
    await v.waitForTimeout(400);
    const shots = [];
    for (let k = 0; k < 2; k++) {
      shots.push(await v.locator(".voxel-trophy canvas").evaluate((c) => c.toDataURL()));
      await v.waitForTimeout(600);
    }
    check(shots[0] !== shots[1], "the voxel cup turns (two frames differ)");
    await v.context().close();
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
