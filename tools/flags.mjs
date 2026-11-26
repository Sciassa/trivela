// Copies the flags used by Le Bandiere (SPEC §4.14) and by the player cards (SPEC §14.3) from the `flag-icons` package
// (MIT) into apps/web/public/flags/. Run after `pnpm data:generate`: node tools/flags.mjs. Only the flags in use are
// copied; the files are committed.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const pack = JSON.parse(readFileSync(join(root, "apps/web/public/data/games/bandiere.json"), "utf8"));
const cardsDir = join(root, "apps/web/public/data/cards");
const cards = existsSync(cardsDir) ? readdirSync(cardsDir).flatMap((f) => Object.values(JSON.parse(readFileSync(join(cardsDir, f), "utf8")))) : [];
const codes = [...new Set([...pack.flatMap((it) => it.players.map((p) => p.flag)), ...cards.map((c) => c.flag).filter(Boolean)])].sort();
const req = createRequire(join(root, "apps/web/package.json"));
const src = join(dirname(req.resolve("flag-icons/package.json")), "flags", "4x3");
const out = join(root, "apps/web/public/flags");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const missing = codes.filter((c) => !readdirSync(src).includes(`${c}.svg`));
if (missing.length) throw new Error(`flags missing in flag-icons: ${missing.join(", ")}`);
for (const c of codes) copyFileSync(join(src, `${c}.svg`), join(out, `${c}.svg`));
console.log(`${codes.length} flags copied to apps/web/public/flags`);
