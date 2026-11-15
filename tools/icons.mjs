// Renders the PNG icons of the installable app from apps/web/public/icon.svg (pixel art, no smoothing).
// Usage: node tools/icons.mjs   (writes apps/web/public/icons/)
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const svg = readFileSync("apps/web/public/icon.svg", "utf8");
const OUT = "apps/web/public/icons";
mkdirSync(OUT, { recursive: true });
// maskable: the launcher may crop to a circle, so the logo keeps to the inner 70% safe zone
const ICONS = [
  { file: "icon-192.png", size: 192, pad: 0 },
  { file: "icon-512.png", size: 512, pad: 0 },
  { file: "maskable-512.png", size: 512, pad: 0.15 },
  { file: "apple-touch-icon.png", size: 180, pad: 0.08 },
];
const browser = await chromium.launch();
try {
  for (const { file, size, pad } of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const inner = Math.round(size * (1 - 2 * pad));
    await page.setContent(`<html><body style="margin:0;background:#0b0b1a;display:grid;place-items:center;width:${size}px;height:${size}px">
      <div style="width:${inner}px;height:${inner}px;image-rendering:pixelated">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
    await page.screenshot({ path: `${OUT}/${file}`, omitBackground: false });
    await page.close();
    console.log("wrote", `${OUT}/${file}`);
  }
} finally {
  await browser.close();
}
