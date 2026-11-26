"""Offline half of the asset pipeline (SPEC §0.8, §4.15): from the cached Commons files to the published pixel-art
assets, with a manifest that credits every file. Deterministic: the same cache gives the same files.

Outputs (all versioned):
- apps/web/public/crests/*.png   crests (original and the four variants), file names that do not name the club;
- apps/web/public/photos/*.png   player photos, reduced to 60x80 pixel art (a derivative: CC BY-SA stays CC BY-SA);
- apps/web/public/data/assets-manifest.json   every published file with source, licence, author, attribution;
- data/static/crests.json, data/static/photos.json   what the question and card generators read.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path

from PIL import Image, ImageFilter

from .assets import ASSET_CACHE, PUBLIC, SOURCES, cached, crest_source, crest_svg, strip_html
from .paths import ROOT

STATIC = ROOT / "static"
SIZE = 128  # crests: drawn pixelated on the board, so a small canvas is enough and keeps the 8-bit look
SIL_FILL = (255, 233, 168, 255)
# files on the logo property that are not a crest, checked by eye on the whole set (SPEC §4.15): never asked
NOT_A_CREST = {
    12: "solo la scritta del nome (AS Roma)",
    31: "solo la scritta del nome (Liverpool)",
    23: "una bandiera, non lo stemma (Eintracht Braunschweig)",
    1038: "una bandiera, non lo stemma (Sampdoria)",
}


def key(*parts) -> str:
    return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:12]


def fit(img: Image.Image, size: int = SIZE) -> Image.Image:
    """Trim the transparent margin and centre the crest on a square transparent canvas."""
    img = img.convert("RGBA")
    box = img.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if box:
        img = img.crop(box)
    img.thumbnail((size - 8, size - 8), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, ((size - img.width) // 2, (size - img.height) // 2), img)
    return out


def coverage(img: Image.Image) -> float:
    a = img.getchannel("A")
    return sum(1 for v in a.getdata() if v > 128) / (img.width * img.height)


def real_alpha(raw: Image.Image) -> bool:
    """A crest with a true outline: the corners are transparent and the shape does not fill the square."""
    if raw.mode != "RGBA":
        return False
    a = raw.getchannel("A")
    w, h = raw.size
    corners = [a.getpixel((x, y)) for x, y in ((1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2))]
    return sum(1 for c in corners if c < 16) >= 3 and 0.2 <= coverage(raw) <= 0.95


def mask_bits(img: Image.Image, n: int = 24) -> list[int]:
    m = img.getchannel("A").resize((n, n), Image.Resampling.BOX)
    return [1 if v > 128 else 0 for v in m.getdata()]


def iou(a: list[int], b: list[int]) -> float:
    inter = sum(1 for x, y in zip(a, b) if x and y)
    union = sum(1 for x, y in zip(a, b) if x or y)
    return inter / union if union else 1.0


def plain_shape(bits: list[int], n: int = 24) -> bool:
    """A silhouette that is just a disc or a box says nothing: most crests are round shields."""
    ys = [i // n for i, v in enumerate(bits) if v]
    xs = [i % n for i, v in enumerate(bits) if v]
    if not xs:
        return True
    x0, x1, y0, y1 = min(xs), max(xs) + 1, min(ys), max(ys) + 1
    cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    box = [1 if x0 <= i % n < x1 and y0 <= i // n < y1 else 0 for i in range(n * n)]
    disc = [1 if ((i % n + .5 - cx) / rx) ** 2 + ((i // n + .5 - cy) / ry) ** 2 <= 1 else 0 for i in range(n * n)]
    return iou(bits, box) > 0.9 or iou(bits, disc) > 0.9


def palette(img: Image.Image) -> list[tuple[str, float]]:
    """The characteristic colours: the shares of a 5-colour reduction of the fully opaque pixels away from the edges
    (anti-aliased borders blend two colours into a third one that is not in the crest), near colours merged."""
    a = img.getchannel("A").filter(ImageFilter.MinFilter(5))  # eroded alpha: the outline's blended pixels drop out
    rgb = img.convert("RGB")
    flat = rgb.filter(ImageFilter.ModeFilter(5))  # inner anti-aliasing (lettering, stripes) goes to the nearby colour
    px = [c for c, al in zip(flat.getdata(), a.getdata()) if al == 255]
    del rgb
    if len(px) < 200:
        return []
    strip = Image.new("RGB", (len(px), 1))
    strip.putdata(px)
    q = strip.quantize(colors=5, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = q.getpalette()[:15]
    counts = Counter(q.getdata())
    cols: list[list] = []
    for idx, n in counts.most_common():
        rgb = tuple(pal[idx * 3: idx * 3 + 3])
        share = n / len(px)
        near = next((c for c in cols if sum((x - y) ** 2 for x, y in zip(c[0], rgb)) < 60 ** 2), None)
        if near:
            near[1] += share
        else:
            cols.append([rgb, share])
    cols = [c for c in cols if c[1] >= 0.1]
    cols.sort(key=lambda c: -c[1])
    return [("#{:02x}{:02x}{:02x}".format(*c[0]), round(c[1], 3)) for c in cols[:4]]


def render_svg(s: str, width: int = 250) -> Image.Image | None:
    import io

    import resvg_py

    try:
        return Image.open(io.BytesIO(bytes(resvg_py.svg_to_bytes(svg_string=s, width=width)))).convert("RGBA")
    except Exception:  # noqa: BLE001 - a file resvg cannot draw is simply skipped
        return None


def no_text(svg_path: Path) -> Image.Image | None:
    """The crest without its lettering: only when the SVG has real text elements to drop, and the result is clean."""
    src = svg_path.read_text(encoding="utf-8", errors="ignore")
    if not re.search(r"<(svg:)?text\b", src):
        return None
    stripped = re.sub(r"<(svg:)?text\b.*?</(svg:)?text>", "", src, flags=re.DOTALL)
    stripped = re.sub(r"<(svg:)?text\b[^>]*/>", "", stripped)

    a, b = render_svg(src), render_svg(stripped)
    if a is None or b is None or a.size != b.size:
        return None
    ca, cb = coverage(a), coverage(b)
    changed = sum(1 for p, q in zip(a.getdata(), b.getdata()) if abs(p[3] - q[3]) > 64 or sum(abs(x - y) for x, y in zip(p[:3], q[:3])) > 90)
    frac = changed / (a.width * a.height)
    # some lettering went away, the crest itself stayed
    if not (0.01 <= frac <= 0.3) or cb < 0.6 * ca:
        return None
    return b


def photo(path: Path) -> Image.Image:
    """A 60x80 pixel portrait: a 3:4 crop from the upper part of the photo (where the face is), 32 colours."""
    img = Image.open(path).convert("RGB")
    w, h = img.size
    if w / h > 0.75:
        cw = int(h * 0.75)
        img = img.crop(((w - cw) // 2, 0, (w - cw) // 2 + cw, h))
    else:
        img = img.crop((0, 0, w, int(w / 0.75)))
    img = img.resize((60, 80), Image.Resampling.LANCZOS)
    return img.quantize(colors=32, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")


def attribution(c: dict) -> str:
    return f"«{c['title']}», {strip_html(c['author'])}, {c['licence']}, via Wikimedia Commons"


def build() -> None:
    src = json.loads(SOURCES.read_text(encoding="utf-8"))
    for d in ("crests", "photos"):
        out = PUBLIC / d
        out.mkdir(parents=True, exist_ok=True)
        for f in out.glob("*.png"):
            f.unlink()  # the build owns these folders: a file dropped from the sources leaves the site too
    assets, excluded, crests, photos = [], Counter(), {}, {}
    sil_todo: list = []

    def publish(img: Image.Image, folder: str, name: str) -> str:
        rel = f"{folder}/{name}.png"
        img.save(PUBLIC / rel, optimize=True)
        return rel

    for tm, r in sorted(src["crests"].items(), key=lambda kv: int(kv[0])):
        c = r.get("commons")
        if not c:
            excluded["stemma: file non trovato su Commons"] += 1
            continue
        if not c["publish"]:
            excluded[f"stemma: licenza {c['class']}"] += 1
            continue
        if int(tm) in NOT_A_CREST:
            excluded["stemma: non è uno stemma (solo scritta o bandiera)"] += 1
            continue
        if c["mime"] == "image/jpeg":
            # a crest is a drawing (SVG or PNG): the JPEG files on the logo property are photos (a match, a street, a
            # carved emblem), a mistake of the source
            excluded["stemma: il file è una foto, non un logo"] += 1
            continue
        f = crest_source(c, offline=True)
        if f is None:
            excluded["stemma: non ancora scaricato"] += 1
            continue
        raw = Image.open(f).convert("RGBA")
        k = key(r["qid"], c["sha1"])
        files = {"originale": publish(fit(raw), "crests", k)}
        rec = {"club": int(tm), "qid": r["qid"], "original": files["originale"], "variants": {}, "licence": c["class"],
               "attribution": attribution(c)}
        if c["modifiable"]:
            base = fit(raw)
            blur = base.convert("RGBa").filter(ImageFilter.GaussianBlur(7)).convert("RGBA")
            rec["variants"]["blur"] = files["sfocato"] = publish(blur, "crests", key(k, "blur"))
            if real_alpha(raw):
                bits = mask_bits(base)
                rec["mask"] = "".join(map(str, bits))
                if not plain_shape(bits):
                    sil_todo.append((tm, k, base, bits, files))
            svg = crest_svg(c, offline=True)
            if svg is not None:
                nt = no_text(svg)
                if nt is not None:
                    rec["variants"]["notext"] = files["senza scritte"] = publish(fit(nt), "crests", key(k, "notext"))
            pal = palette(base) if real_alpha(raw) else []  # without transparency the background would be a «colour»
            if len(pal) >= 2:
                rec["variants"]["colors"] = pal  # colours are drawn by the app as pixel bands: no image is derived
        crests[tm] = rec
        assets.append(manifest_entry("stemma", f"tm:c:{tm}", r, c, files))
    # a silhouette tells the club only if its outline is its own: the common shields and badges look all alike
    masks = {tm: [int(x) for x in r["mask"]] for tm, r in crests.items() if r.get("mask")}
    for tm, k, base, bits, files in sil_todo:
        twins = sum(1 for o, m in masks.items() if o != tm and iou(bits, m) > 0.85)
        if twins:
            excluded["silhouette: sagoma uguale a quella di altri stemmi"] += 1
            continue
        sil = Image.new("RGBA", base.size, (0, 0, 0, 0))
        sil.paste(Image.new("RGBA", base.size, SIL_FILL), (0, 0), base.getchannel("A").point(lambda a: 255 if a > 128 else 0))
        crests[tm]["variants"]["silhouette"] = files["silhouette"] = publish(sil, "crests", key(k, "sil"))
    for tm, r in sorted(src["photos"].items(), key=lambda kv: int(kv[0])):
        c = r.get("commons")
        if not c:
            excluded["foto: file non trovato su Commons"] += 1
            continue
        if not c["publish"] or not c["modifiable"]:
            # the photo is shown only as a pixel portrait, a derivative: a no-derivatives licence keeps it out
            excluded[f"foto: licenza {c['class']}"] += 1
            continue
        p = cached(c["thumb"], ".jpg", offline=True)
        if p is None:
            excluded["foto: non ancora scaricata"] += 1
            continue
        try:
            img = photo(p)
        except Exception:  # noqa: BLE001 - an unreadable file is skipped, never guessed
            excluded["foto: file illeggibile"] += 1
            continue
        rel = publish(img, "photos", key(r["qid"], c["sha1"]))
        photos[tm] = {"file": rel, "credit": f"Foto: {strip_html(c['author'])} · {c['licence']} · Wikimedia Commons (rielaborata)"}
        assets.append(manifest_entry("foto", f"tm:p:{tm}", r, c, {"ritratto": rel}))
    manifest = {
        "about": "Stemmi e foto pubblicati da TRIVELA: fonte, licenza e autore di ogni file (SPEC §0.8). Le versioni trasformate "
                 "(sfocato, silhouette, senza scritte, ritratto in pixel) sono opere derivate: restano sotto la licenza "
                 "dell'originale. I marchi restano dei rispettivi titolari e sono usati solo per indicare la squadra.",
        "sources": [{"label": "Wikidata", "url": "https://www.wikidata.org", "use": "ID Transfermarkt (P7223, P2446), stemma (P154), immagine (P18)",
                     "licence": "CC0"},
                    {"label": "Wikimedia Commons", "url": "https://commons.wikimedia.org", "use": "file, licenza e autore (imageinfo, extmetadata)",
                     "licence": "per file"}],
        "counts": {"stemmi": len(crests), "foto": len(photos)},
        "excluded": dict(sorted(excluded.items())),
        "assets": assets,
    }
    (PUBLIC / "data" / "assets-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    STATIC.mkdir(exist_ok=True)
    (STATIC / "crests.json").write_text(json.dumps(crests, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    (STATIC / "photos.json").write_text(json.dumps(photos, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    v = Counter(k for r in crests.values() for k in r["variants"])
    print(json.dumps({"stemmi": len(crests), "varianti": dict(v), "foto": len(photos), "esclusi": dict(excluded)}, ensure_ascii=False, indent=1))


def manifest_entry(kind: str, subject: str, r: dict, c: dict, files: dict) -> dict:
    return {"kind": kind, "subject": subject, "wikidata": r["qid"], "source": "Wikimedia Commons", "page": c["page"], "original_url": c["url"],
            "title": c["title"], "licence": c["licence"], "licence_class": c["class"], "licence_url": c["licence_url"], "author": strip_html(c["author"]),
            "attribution": attribution(c), "trademark": c["trademark"], "modifiable": c["modifiable"], "files": files,
            "status": "verificato: ID Transfermarkt su Wikidata, licenza di Commons"}


if __name__ == "__main__":
    build()
    print(ASSET_CACHE)
