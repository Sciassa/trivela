// Visual check: first screen of each game (screenshots in test-results/games/).
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const PORT = 8797;
mkdirSync("test-results/games", { recursive: true });
const server = spawn("pnpm", ["--filter", "@trivela/realtime", "start"], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe", detached: true });
await new Promise((res) => server.stdout.on("data", (d) => String(d).includes("TRIVELA server") && res()));
const browser = await chromium.launch();
const games = (process.argv[2] ?? "tiro_secco,prima_pagina,decina,dischetto,formazione,giramondo,frame,intruso,asta,filo_rosso,mappamondo,maglia").split(",");
const filler = ["tiro_secco", "maglia", "frame", "intruso", "mappamondo"];
for (const g of games) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const rest = filler.filter((x) => x !== g).slice(0, 3);
  await p.goto(`http://localhost:${PORT}/?games=${[g, ...rest].join(",")}`);
  await p.getByText("PREMI START").click();
  await p.getByText("SFIDA · 1 SCHERMO").click();
  const inputs = p.locator("input.input");
  await inputs.nth(3).fill("Italia");
  await inputs.nth(4).fill("Mondiale 2006");
  await p.getByText("GIOCA ▶").click();
  await p.getByText("SI PARTE ▶").click({ timeout: 15000 });
  await p.getByText("VIA! ▶").click();
  await p.waitForTimeout(2600);
  await p.screenshot({ path: `test-results/games/${g}.png` });
  console.log(g, errs.length ? `ERR ${errs.join(" | ")}` : "ok");
  await ctx.close();
}
await browser.close();
process.kill(-server.pid, "SIGTERM");
