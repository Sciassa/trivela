// End-to-end smoke test: local single-screen match + multi-device room.
// Usage: pnpm build && pnpm e2e   (screenshots in test-results/)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const PORT = 8799;
const BASE = `http://localhost:${PORT}`;
mkdirSync("test-results", { recursive: true });

const server = spawn("pnpm", ["--filter", "@trivela/realtime", "start"], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe", detached: true });
await new Promise((res, rej) => {
  server.stdout.on("data", (d) => String(d).includes("TRIVELA server") && res());
  server.on("exit", (c) => rej(new Error(`server exited ${c}`)));
  setTimeout(() => rej(new Error("server timeout")), 30000);
});

const browser = await chromium.launch();
const errors = [];
const page = async (ctxOpts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...ctxOpts });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${e.message}`));
  p.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
  return p;
};
let failed = false;
const check = (cond, msg) => {
  if (!cond) {
    failed = true;
    console.error("FAIL:", msg);
  } else console.log("ok:", msg);
};

try {
  // ---------------- local single-screen match
  const p = await page();
  await p.goto(BASE);
  await p.getByText("PREMI START").click();
  await p.getByText("SFIDA · 1 SCHERMO").click();
  const inputs = p.locator("input.input");
  await inputs.nth(0).fill("Anna");
  await inputs.nth(1).fill("Bruno");
  await inputs.nth(3).fill("Juventus");
  await inputs.nth(4).fill("Mondiale 2022");
  await p.waitForTimeout(500);
  await p.screenshot({ path: "test-results/setup.png" });
  await p.getByText("GIOCA ▶").click();
  await p.getByText("IL SORTEGGIO").waitFor();
  await p.waitForTimeout(4500);
  await p.screenshot({ path: "test-results/draw.png" });
  await p.getByText("SI PARTE ▶").click();
  const gameRequests = await p.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes("/data/games/")));
  check(gameRequests.length <= 6, `screen downloads only the drawn games (${gameRequests.length} game files)`);
  await p.getByText("VIA! ▶").click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: "test-results/game1.png" });
  check(errors.length === 0, `no page errors in local match (${errors.join(" | ")})`);

  // ---------------- multi-device room
  const screen = await page();
  await screen.goto(BASE);
  await screen.getByText("PREMI START").click();
  await screen.getByText("SFIDA · PIÙ SCHERMI (REGIA / PULSANTIERE)").click();
  await screen.getByText(/STANZA [A-Z]{4}/).waitFor();
  const code = (await screen.getByText(/STANZA [A-Z]{4}/).textContent()).match(/STANZA ([A-Z]{4})/)[1];
  const host = await page({ viewport: { width: 400, height: 860 }, hasTouch: true });
  const phoneDataRequests = [];
  host.on("request", (r) => r.url().includes("/data/") && phoneDataRequests.push(r.url()));
  await host.goto(`${BASE}/#/join/${code}?r=host`);
  await host.getByText("In attesa").waitFor();
  const sIn = screen.locator("input.input");
  await sIn.nth(3).fill("Italia");
  await sIn.nth(4).fill("Germania");
  await screen.waitForTimeout(500);
  await screen.getByText("CREA LA PARTITA ▶").click();
  await screen.waitForTimeout(1500);
  await screen.screenshot({ path: "test-results/room-after-setup.png" });
  await host.screenshot({ path: "test-results/room-host-wait.png" });
  await host.getByText("INIZIA ▶").click();
  await host.getByText("VIA AL GIOCO ▶").click();
  await host.waitForTimeout(800);
  const solution = await host.locator(".panel").first().innerText();
  const answerLine = solution.split("\n").find((l) => l.startsWith("Risposta:")) ?? "";
  const shown = await screen.locator(".stage").innerText();
  await screen.screenshot({ path: "test-results/room-screen.png" });
  await host.screenshot({ path: "test-results/room-host.png" });
  check(!!code, `room ${code} created`);
  const answerText = answerLine.replace(/^Risposta: (\w\) )?/, "");
  const optionTexts = await screen.locator(".option").allInnerTexts();
  const multipleChoice = optionTexts.some((t) => answerText && t.includes(answerText));
  const highlighted = await screen.locator(".option.right").count();
  check(
    multipleChoice ? highlighted === 0 : !answerText || answerText.length < 4 || !shown.includes(answerText),
    `screen does not show the answer before the reveal (${multipleChoice ? "multiple choice, no highlighted option" : "open answer hidden"})`,
  );
  check(errors.length === 0, `no page errors in rooms (${errors.join(" | ")})`);
  check(phoneDataRequests.length === 0, `the Regia phone downloads no question data (${phoneDataRequests.length} requests)`);
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
}
process.exit(failed ? 1 : 0);
