// Saves a Scribd document as a PDF.
// Usage: node scribd.js <scribd document url> [out.pdf]
//
// Chrome must have chrome_ext loaded and be logged in to Scribd if the document needs it.
// The extension walks the document and reports each page's jigsaw pieces, this script
// downloads the image sheets into scribd-out/<doc>/, and native/jigsaw2pdf assembles them.
const { initializeServer, sendCommand, shutdownServer } = require('./utils/webutils');
const { killExistingChrome, launchChrome } = require('./utils/chrome');
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const OUT_ROOT = path.resolve(__dirname, './scribd-out');
const NATIVE_DIR = path.resolve(__dirname, './native');

const SCROLL_STEP = 0.25;   // Viewports per step, small so pages don't fly past unrendered
const SCROLL_SETTLE = 650;  // Pause to let the DOM settle and render
const BOTTOM_ROUNDS = 6;    // Steps at the bottom before trusting it is the end
const DOWNLOAD_DELAY = 100; // Polite delay between sheet downloads

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// https://www.scribd.com/document/123456/Some-Title -> 123456-Some-Title
const docSlug = (docUrl) => {
    const parts = new URL(docUrl).pathname.split('/').filter(Boolean);
    const idIndex = parts.findIndex(x => /^\d+$/.test(x));
    const slug = (idIndex >= 0 ? parts.slice(idIndex, idIndex + 2) : parts.slice(-1)).join('-');
    return slug.replace(/[^A-Za-z0-9._-]/g, '_') || `doc-${Date.now()}`;
};

const sheetFileName = (url) => {
    const match = url.match(/\/images\/([A-Za-z0-9_-]+\.jpg)/);
    return match ? match[1] : `${crypto.createHash('sha1').update(url).digest('hex')}.jpg`;
};

// sendCommand resolves with whatever message arrives next, so retry anything that is
// not a step result (a reconnect greeting, for one).
const step = async (command) => {
    for (let attempt = 1; ; attempt++) {
        const resp = await sendCommand(command);
        if (resp && resp.result && Array.isArray(resp.result.pages)) return resp.result;
        if (attempt >= 3) throw new Error(`Unexpected response to ${command.type}: ${JSON.stringify(resp).slice(0, 200)}`);
        console.log(`[scribd] Unexpected response, retrying: ${JSON.stringify(resp).slice(0, 200)}`);
        await sleep(1000);
    }
};

const collectPages = async (docUrl) => {
    const pages = new Map();
    let maxPageNum = 0;
    const merge = (result) => {
        maxPageNum = Math.max(maxPageNum, result.maxPageNum || 0);
        for (const page of result.pages) {
            const known = pages.get(page.pageNum);
            // Keep the most complete capture in case a page was caught mid-render
            if (!known || page.pieces.length > known.pieces.length) {
                if (!known) console.log(`[scribd] Captured page ${page.pageNum} | ${pages.size + 1} / ${maxPageNum || '?'}`);
                pages.set(page.pageNum, page);
            }
        }
    };

    merge(await step({ type: 'scribd-open', url: docUrl }));
    let bottomRounds = 0;
    while (bottomRounds <= BOTTOM_ROUNDS) {
        const result = await step({ type: 'scribd-step', scrollViewports: SCROLL_STEP, settleMs: SCROLL_SETTLE });
        merge(result);
        bottomRounds = result.atBottom ? bottomRounds + 1 : 0;
    }
    // Extra pause at the bottom to catch final layout renders
    merge(await step({ type: 'scribd-step', settleMs: 2000 }));

    const missing = [];
    for (let n = 1; n <= maxPageNum; n++) if (!pages.has(n)) missing.push(n);
    return { pages: [...pages.values()].sort((a, b) => a.pageNum - b.pageNum), missing };
};

const downloadSheet = async (urls, destPath) => {
    let lastError;
    for (const url of urls) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const buffer = Buffer.from(await response.arrayBuffer());
                if (!buffer.length) throw new Error('empty body');
                fs.writeFileSync(`${destPath}.part`, buffer);
                fs.renameSync(`${destPath}.part`, destPath);
                return;
            } catch (e) {
                lastError = e;
                await sleep(1000 * attempt);
            }
        }
    }
    throw lastError;
};

const downloadSheets = async (pages, imageDir) => {
    // src carries a signed token when Scribd set one; orig is the plain fallback
    const sheets = new Map();
    for (const page of pages) {
        for (const piece of page.pieces) {
            const urls = [piece.src, piece.orig].filter(Boolean);
            piece.file = sheetFileName(urls[0]);
            if (!sheets.has(piece.file)) sheets.set(piece.file, urls);
        }
    }

    fs.mkdirSync(imageDir, { recursive: true });
    const failed = [];
    let done = 0;
    for (const [file, urls] of sheets) {
        done++;
        const destPath = path.join(imageDir, file);
        if (fs.existsSync(destPath)) continue;
        try {
            await downloadSheet(urls, destPath);
            await sleep(DOWNLOAD_DELAY);
        } catch (e) {
            console.log(`[scribd] Failed to download ${urls[0]}: ${e.message}`);
            failed.push(file);
        }
        if (done % 50 === 0 || done === sheets.size) console.log(`[scribd] Sheets: ${done} / ${sheets.size}`);
    }
    return failed;
};

// Format is documented at the top of native/jigsaw2pdf.c
const writeLayout = (pages, layoutPath) => {
    const lines = [];
    for (const page of pages) {
        lines.push(`page ${page.width} ${page.height}`);
        for (const p of page.pieces) {
            lines.push(`img images/${p.file} ${p.left} ${p.top} ${p.width} ${p.height} ${p.clip.join(' ')}`);
        }
    }
    fs.writeFileSync(layoutPath, lines.join('\n') + '\n');
};

const assemble = (layoutPath, outPdf) => {
    const build = spawnSync('make', ['-s', '-C', NATIVE_DIR], { stdio: 'inherit' });
    if (build.status !== 0) throw new Error('Building native/jigsaw2pdf failed');
    const run = spawnSync(path.join(NATIVE_DIR, 'jigsaw2pdf'), [layoutPath, outPdf], { stdio: 'inherit' });
    if (run.status !== 0) throw new Error('jigsaw2pdf failed');
};

const finish = async (code) => {
    try { await killExistingChrome(); } catch (_) {}
    try { shutdownServer(); } catch (_) {}
    process.exit(code);
};

const main = async () => {
    const docUrl = process.argv[2];
    if (!docUrl || !/^https?:\/\/([a-z0-9-]+\.)*scribd\.com\//i.test(docUrl)) {
        console.log('Usage: node scribd.js <scribd document url> [out.pdf]');
        process.exit(1);
    }
    const slug = docSlug(docUrl);
    const workDir = path.join(OUT_ROOT, slug);
    const outPdf = path.resolve(process.argv[3] || path.join(OUT_ROOT, `${slug}.pdf`));
    fs.mkdirSync(workDir, { recursive: true });

    await killExistingChrome();
    console.log('[scribd] Spawning Chrome...');
    launchChrome();
    initializeServer();
    await sleep(8000);

    try {
        console.log(`[scribd] Walking ${docUrl}`);
        const { pages, missing } = await collectPages(docUrl);
        console.log(`[scribd] Captured ${pages.length} pages`);
        if (!pages.length) throw new Error('No pages captured. Is the document open and readable in this Chrome profile?');

        const failed = await downloadSheets(pages, path.join(workDir, 'images'));
        if (failed.length) throw new Error(`${failed.length} image sheets failed to download; run again to retry them`);

        const layoutPath = path.join(workDir, 'layout.txt');
        writeLayout(pages, layoutPath);
        assemble(layoutPath, outPdf);

        if (missing.length) {
            console.log(`[scribd] WARNING: ${missing.length} pages never rendered and are not in the PDF: ${missing.join(', ')}`);
            return finish(2);
        }
        console.log(`[scribd] Done: ${outPdf}`);
        return finish(0);
    } catch (e) {
        console.log(`[scribd] ${e.message}`);
        return finish(1);
    }
};

if (require.main === module) {
    // Ensure Chrome is terminated on Ctrl+C or termination signals
    process.on('SIGINT', () => finish(130));
    process.on('SIGTERM', () => finish(143));
    main();
}

module.exports = { docSlug, sheetFileName, writeLayout };
