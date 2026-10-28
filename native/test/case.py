"""Builds a synthetic jigsaw for jigsaw2pdf and checks the rendered result.

  case.py make <dir>                 writes sheets, layout.txt and expected-<n>.png
  case.py compare <expected> <actual>  fails unless the images match

Pages are cut into tiles and scattered across JPEG sheets the way Scribd does it.
The expected images come from compositing the decoded sheets with PIL, which is
what the old scribd/generate_pdf_pure.py did.
"""
import random
import sys

from PIL import Image, ImageChops, ImageDraw, ImageStat

TILE_W, TILE_H = 40, 30


def target_page(w, h, seed):
    """A page with sharp edges and gradients, so misplaced tiles are obvious."""
    rnd = random.Random(seed)
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = (x * 255 // w, y * 255 // h, (x + y) * 255 // (w + h))
    d = ImageDraw.Draw(img)
    for _ in range(12):
        x, y = rnd.randrange(w), rnd.randrange(h)
        d.rectangle([x, y, x + rnd.randrange(10, 60), y + rnd.randrange(10, 60)],
                    fill=tuple(rnd.randrange(256) for _ in range(3)))
    return img


def jigsaw_page(out_dir, page_num, w, h, seed):
    """Scatters the page's tiles into one sheet and returns its layout records."""
    page = target_page(w, h, seed)
    tiles = [(x, y) for y in range(0, h, TILE_H) for x in range(0, w, TILE_W)]
    random.Random(seed).shuffle(tiles)
    cols = 3
    rows = (len(tiles) + cols - 1) // cols
    # 1px gutters, like Scribd's sheets, so a clip off by one shows the wrong pixels.
    sheet_w, sheet_h = cols * (TILE_W + 1) + 1, rows * (TILE_H + 1) + 1
    sheet = Image.new("RGB", (sheet_w, sheet_h), (255, 0, 255))
    records = []
    for i, (x, y) in enumerate(tiles):
        sx, sy = 1 + (i % cols) * (TILE_W + 1), 1 + (i // cols) * (TILE_H + 1)
        tw, th = min(TILE_W, w - x), min(TILE_H, h - y)
        sheet.paste(page.crop((x, y, x + tw, y + th)), (sx, sy))
        records.append(f"img {page_num}.jpg {x - sx} {y - sy} {sheet_w} {sheet_h} "
                       f"{sy} {sx + tw} {sy + th} {sx}")
    sheet.save(f"{out_dir}/{page_num}.jpg", quality=100, subsampling=0)
    return [f"page {w} {h}"] + records


def full_page(out_dir, page_num, w, h, seed):
    """Scribd's simple case: one image 1px larger than the page on every side."""
    target_page(w + 2, h + 2, seed).save(f"{out_dir}/{page_num}.jpg", quality=100, subsampling=0)
    return [f"page {w} {h}", f"img {page_num}.jpg -1 -1 {w + 2} {h + 2} 1 {w + 1} {h + 1} 1"]


def composite(out_dir, records):
    """Reference renderer: paste each clipped piece onto a white page."""
    w, h = (int(v) for v in records[0].split()[1:])
    canvas = Image.new("RGB", (w, h), (255, 255, 255))
    for rec in records[1:]:
        f = rec.split()
        left, top, ew, eh, ct, cr, cb, cl = (int(v) for v in f[2:])
        with Image.open(f"{out_dir}/{f[1]}") as src:
            box = (max(cl, 0), max(ct, 0), min(cr, ew), min(cb, eh))
            canvas.paste(src.convert("RGB").crop(box), (left + box[0], top + box[1]))
    return canvas


def make(out_dir):
    pages = [
        full_page(out_dir, 1, 200, 280, seed=1),
        jigsaw_page(out_dir, 2, 200, 280, seed=2),
        jigsaw_page(out_dir, 3, 160, 210, seed=3),  # different size, partial edge tiles
    ]
    with open(f"{out_dir}/layout.txt", "w") as f:
        for records in pages:
            f.write("\n".join(records) + "\n")
    for n, records in enumerate(pages, 1):
        composite(out_dir, records).save(f"{out_dir}/expected-{n}.png")


def compare(expected_path, actual_path):
    expected = Image.open(expected_path).convert("RGB")
    actual = Image.open(actual_path).convert("RGB")
    if expected.size != actual.size:
        sys.exit(f"FAIL {actual_path}: size {actual.size}, expected {expected.size}")
    diff = ImageChops.difference(expected, actual)
    mean = sum(ImageStat.Stat(diff).mean) / 3
    # Count pixels that are clearly wrong, not JPEG decoder or resampling noise.
    r, g, b = diff.split()
    worst = ImageChops.lighter(ImageChops.lighter(r, g), b)
    bad = sum(worst.histogram()[49:])
    bad_pct = 100 * bad / (expected.width * expected.height)
    verdict = "ok" if mean < 3 and bad_pct < 0.5 else "FAIL"
    print(f"{verdict} {actual_path}: mean diff {mean:.2f}, {bad_pct:.2f}% pixels off")
    if verdict != "ok":
        sys.exit(1)


if __name__ == "__main__":
    {"make": make, "compare": compare}[sys.argv[1]](*sys.argv[2:])
