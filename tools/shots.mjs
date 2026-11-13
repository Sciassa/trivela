// Visual check: plays a local match through every game at several viewports.
// Usage: pnpm build && node tools/shots.mjs [game,game,...]   (screenshots in test-results/shots/)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const PORT = 8798;
const OUT = "test-results/shots";
mkdirSync(OUT, { recursive: true });
const ALL = ["tiro_secco", "maglia", "frame", "anomalia", "decina", "dischetto", "formazione", "asta", "mercato", "giramondo"];
const games = (process.argv[2] ?? ALL.join(",")).split(",");
const VIEWPORTS = { pc: { width: 1366, height: 768 }, phone: { width: 844, height: 390 }, tablet: { width: 1024, height: 768 } };

const server = spawn("pnpm", ["--filter", "@trivela/web", "exec", "vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "pipe", detached: true });
await new Promise((res, rej) => {
  server.stdout.on("data", (d) => String(d).includes("Local") && res());
  setTimeout(() => rej(new Error("preview timeout")), 20000);
});
const browser = await chromium.launch();
const only = process.env.VP ? [process.env.VP] : Object.keys(VIEWPORTS);
try {
  for (const vp of only) {
    for (let k = 0; k < games.length; k += 5) {
      const chunk = games.slice(k, k + 5);
      while (chunk.length < 5) chunk.push(ALL.find((g) => !chunk.includes(g)));
      const ctx = await browser.newContext({ viewport: VIEWPORTS[vp] });
      const p = await ctx.newPage();
      p.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
      await p.goto(`http://localhost:${PORT}/?games=${chunk.join(",")}`);
      await p.getByText("PREMI START").click();
      await p.waitForTimeout(900);
      if (k === 0) await p.screenshot({ path: `${OUT}/${vp}-menu.png` });
      await p.getByText("PARTITA COMPLETA").click();
      await p.getByPlaceholder("Nome").first().fill("Annalisa");
      await p.getByPlaceholder("Nome").nth(1).fill("Bruno");
      if (k === 0) await p.screenshot({ path: `${OUT}/${vp}-setup.png` });
      await p.getByText("GIOCA ▶").click();
      await p.getByText("SI PARTE ▶").waitFor({ timeout: 15000 });
      if (k === 0) await p.screenshot({ path: `${OUT}/${vp}-draw.png` });
      await p.getByText("SI PARTE ▶").click();
      for (const g of chunk) {
        await p.getByText("VIA! ▶").waitFor();
        await p.waitForTimeout(1300);
        if (g === games[0]) await p.screenshot({ path: `${OUT}/${vp}-intro.png` });
        await p.getByText("VIA! ▶").click();
        await p.waitForTimeout(g === "mercato" || g === "giramondo" ? 12500 : 900);
        if (g === "formazione") {
          await p.locator(".btn.p1").click();
          await p.waitForTimeout(600);
        }
        if (games.includes(g)) await p.screenshot({ path: `${OUT}/${vp}-${g}.png` });
        // rush to the end of the game: answer something / let time pass via the engine
        let shot = false;
        for (let n = 0; n < 80; n++) {
          if (await p.getByText("VIA! ▶").count()) break;
          if (await p.getByText("FINE", { exact: true }).count()) break;
          const next = p.locator(".btn.next");
          if (await next.count()) {
            if (!shot && games.includes(g) && (await p.locator(".copione").count())) {
              await p.waitForTimeout(700);
              await p.screenshot({ path: `${OUT}/${vp}-${g}-reveal.png` });
              shot = true;
            }
            await next.first().click();
            await p.waitForTimeout(250);
            continue;
          }
          if (await p.locator(".option:not(:disabled)").count()) await p.locator(".option").first().click();
          else if (await p.getByText("CONFERMA IL RISULTATO").count()) await p.getByText("CONFERMA IL RISULTATO").click();
          else if (await p.locator(".numpad").count()) {
            await p.keyboard.press("7");
            await p.keyboard.press("Enter");
          } else if (await p.getByText("PASSO").count()) await p.getByText("PASSO").click();
          else if (await p.getByText("MI ARRENDO").count()) await p.getByText("MI ARRENDO").click();
          else if (await p.getByText("HO FINITO").count()) await p.getByText("HO FINITO").click();
          else if (await p.getByText("INVIA", { exact: true }).count()) {
            const inp = p.locator(".arena input.input").first();
            if (await inp.count()) await inp.fill("Tizio Qualunque");
            await p.getByText("INVIA", { exact: true }).click();
          } else if (await p.getByText("TIRA!").count()) {
            await p.locator(".arena input.input").first().fill("Tizio Qualunque");
            await p.getByText("TIRA!").click();
          } else if (await p.locator(".buzz-btn.p1:not(:disabled)").count()) {
            await p.keyboard.press("a");
          } else if (await p.locator(".buzz-btn.p2:not(:disabled)").count()) {
            await p.keyboard.press("l");
          }
          await p.waitForTimeout(350);
        }
        if (await p.getByText("FINE", { exact: true }).count()) break;
      }
      await p.waitForTimeout(1200);
      if (k + 5 >= games.length) await p.screenshot({ path: `${OUT}/${vp}-end.png` });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill();
  }
}
