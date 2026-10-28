// Tests jigsaw2pdf: builds a synthetic jigsaw, assembles it, renders the PDF with CoreGraphics
// (what Preview uses) and checks every page against a reference composite.
//
// Pages are cut into tiles and scattered across JPEG sheets the way Scribd does it.
// The reference pastes each clipped piece of the decoded sheets onto a white page.
// Usage: node native/test/run.ts
const sharp = require('sharp');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN = path.resolve(__dirname, '../jigsaw2pdf');
const TILE_W = 40, TILE_H = 30;

type Image = { w: number; h: number; data: Buffer }; // packed RGB
type PageCase = { w: number; h: number; records: string[] };

const blank = (w: number, h: number, rgb: number[]): Image => {
    const data = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) data.set(rgb, i * 3);
    return { w, h, data };
};

const blit = (src: Image, sx: number, sy: number, sw: number, sh: number, dst: Image, dx: number, dy: number) => {
    for (let y = 0; y < sh; y++) {
        if (dy + y < 0 || dy + y >= dst.h) continue;
        for (let x = 0; x < sw; x++) {
            if (dx + x < 0 || dx + x >= dst.w) continue;
            const s = ((sy + y) * src.w + sx + x) * 3, d = ((dy + y) * dst.w + dx + x) * 3;
            src.data.copy(dst.data, d, s, s + 3);
        }
    }
};

// Deterministic PRNG so failures reproduce
const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// A page with sharp edges and gradients, so misplaced tiles are obvious
const targetPage = (w: number, h: number, seed: number): Image => {
    const rand = rng(seed);
    const img = blank(w, h, [0, 0, 0]);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            img.data.set([(x * 255 / w) | 0, (y * 255 / h) | 0, ((x + y) * 255 / (w + h)) | 0], (y * w + x) * 3);
        }
    }
    for (let i = 0; i < 12; i++) {
        const color = blank(1, 1, [0, 1, 2].map(() => (rand() * 256) | 0));
        const x0 = (rand() * w) | 0, y0 = (rand() * h) | 0;
        const rw = 10 + ((rand() * 50) | 0), rh = 10 + ((rand() * 50) | 0);
        for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) blit(color, 0, 0, 1, 1, img, x, y);
    }
    return img;
};

const saveJpeg = (img: Image, file: string) =>
    sharp(img.data, { raw: { width: img.w, height: img.h, channels: 3 } })
        .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
        .toFile(file);

const decode = async (file: string): Promise<Image> => {
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { w: info.width, h: info.height, data };
};

// Scribd's simple case: one image 1px larger than the page on every side
const fullPage = async (dir: string, n: number, w: number, h: number, seed: number): Promise<PageCase> => {
    await saveJpeg(targetPage(w + 2, h + 2, seed), `${dir}/${n}.jpg`);
    return { w, h, records: [`img ${n}.jpg -1 -1 ${w + 2} ${h + 2} 1 ${w + 1} ${h + 1} 1`] };
};

// Scatters the page's tiles into one sheet, with 1px gutters like Scribd's sheets so a
// clip that is off by one shows the wrong pixels
const jigsawPage = async (dir: string, n: number, w: number, h: number, seed: number): Promise<PageCase> => {
    const page = targetPage(w, h, seed);
    const tiles: number[][] = [];
    for (let y = 0; y < h; y += TILE_H) for (let x = 0; x < w; x += TILE_W) tiles.push([x, y]);
    const rand = rng(seed);
    for (let i = tiles.length - 1; i > 0; i--) {
        const j = (rand() * (i + 1)) | 0;
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    const cols = 3, rows = Math.ceil(tiles.length / cols);
    const sheetW = cols * (TILE_W + 1) + 1, sheetH = rows * (TILE_H + 1) + 1;
    const sheet = blank(sheetW, sheetH, [255, 0, 255]);
    const records = tiles.map(([x, y], i) => {
        const sx = 1 + (i % cols) * (TILE_W + 1), sy = 1 + Math.floor(i / cols) * (TILE_H + 1);
        const tw = Math.min(TILE_W, w - x), th = Math.min(TILE_H, h - y);
        blit(page, x, y, tw, th, sheet, sx, sy);
        return `img ${n}.jpg ${x - sx} ${y - sy} ${sheetW} ${sheetH} ${sy} ${sx + tw} ${sy + th} ${sx}`;
    });
    await saveJpeg(sheet, `${dir}/${n}.jpg`);
    return { w, h, records };
};

const composite = async (dir: string, page: PageCase): Promise<Image> => {
    const canvas = blank(page.w, page.h, [255, 255, 255]);
    for (const rec of page.records) {
        const [, file, ...nums] = rec.split(' ');
        const [left, top, ew, eh, ct, cr, cb, cl] = nums.map(Number);
        const src = await decode(`${dir}/${file}`);
        const x0 = Math.max(cl, 0), y0 = Math.max(ct, 0);
        blit(src, x0, y0, Math.min(cr, ew) - x0, Math.min(cb, eh) - y0, canvas, left + x0, top + y0);
    }
    return canvas;
};

const compare = (label: string, expected: Image, actual: Image): boolean => {
    if (expected.w !== actual.w || expected.h !== actual.h) {
        console.log(`FAIL ${label}: size ${actual.w}x${actual.h}, expected ${expected.w}x${expected.h}`);
        return false;
    }
    let sum = 0, bad = 0;
    for (let i = 0; i < expected.data.length; i += 3) {
        let worst = 0;
        for (let c = 0; c < 3; c++) {
            const d = Math.abs(expected.data[i + c] - actual.data[i + c]);
            sum += d;
            worst = Math.max(worst, d);
        }
        // Count pixels that are clearly wrong, not JPEG decoder or resampling noise
        if (worst > 48) bad++;
    }
    const mean = sum / expected.data.length, badPct = (100 * bad) / (expected.w * expected.h);
    const ok = mean < 3 && badPct < 0.5;
    console.log(`${ok ? 'ok' : 'FAIL'} ${label}: mean diff ${mean.toFixed(2)}, ${badPct.toFixed(2)}% pixels off`);
    return ok;
};

const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: 'utf8' });

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jigsaw2pdf-'));
    let ok = true;
    try {
        const pages = [
            await fullPage(dir, 1, 200, 280, 1),
            await jigsawPage(dir, 2, 200, 280, 2),
            await jigsawPage(dir, 3, 160, 210, 3), // different size, partial edge tiles
        ];
        fs.writeFileSync(`${dir}/layout.txt`, pages.map(p => [`page ${p.w} ${p.h}`, ...p.records].join('\n')).join('\n') + '\n');

        const built = run(BIN, [`${dir}/layout.txt`, `${dir}/out.pdf`]);
        if (built.status !== 0) throw new Error(`jigsaw2pdf failed: ${built.stderr}`);

        const render = run('swift', [path.join(__dirname, 'render.swift'), `${dir}/out.pdf`, `${dir}/actual`]);
        if (render.status !== 0) throw new Error(`render.swift failed: ${render.stderr}`);
        if (Number(render.stdout.trim()) !== pages.length) {
            console.log(`FAIL: PDF has ${render.stdout.trim()} pages, expected ${pages.length}`);
            ok = false;
        }
        for (let n = 1; n <= pages.length; n++) {
            ok = compare(`page ${n}`, await composite(dir, pages[n - 1]), await decode(`${dir}/actual-${n}.png`)) && ok;
        }

        // A missing sheet must fail without leaving a PDF behind
        fs.rmSync(`${dir}/2.jpg`);
        fs.rmSync(`${dir}/out.pdf`);
        const missing = run(BIN, [`${dir}/layout.txt`, `${dir}/out.pdf`]);
        const clean = missing.status !== 0 && !fs.existsSync(`${dir}/out.pdf`) && !fs.existsSync(`${dir}/out.pdf.tmp`);
        console.log(`${clean ? 'ok' : 'FAIL'} missing sheet fails cleanly`);
        ok = clean && ok;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    process.exit(ok ? 0 : 1);
})();
