const { initializeServer, sendCommand, shutdownServer } = require('./utils/webutils');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EXT_PATH = path.resolve(__dirname, './chrome_ext');
const PORT = 9222;
const CACHE_FILE = path.resolve(__dirname, './youtube.json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = (baseMs) => baseMs + Math.floor(Math.random() * Math.floor(baseMs * 0.5));

const killExistingChrome = () => new Promise((resolve) => {
    try {
        const killer = spawn('pkill', ['-f', 'Google Chrome']);
        killer.on('error', () => resolve(undefined));
        killer.on('close', () => resolve(undefined));
    } catch (_) {
        resolve(undefined);
    }
});

const getHandleFromArg = (input) => {
    if (!input) return null;
    const s = String(input).trim();
    try {
        if (s.startsWith('@')) return s;
        if (s.startsWith('http')) {
            const url = new URL(s);
            const seg = url.pathname.split('/').find(x => x && x.startsWith('@'));
            if (seg) return seg;
        }
        if (/^[A-Za-z0-9._-]+$/.test(s)) return `@${s}`;
    } catch (_) {}
    return null;
};

const loadCache = () => {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const raw = fs.readFileSync(CACHE_FILE, 'utf8').trim();
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') return parsed;
            }
        }
    } catch (e) {
        console.log('[youtube] Failed to load cache:', e.message);
    }
    return {};
};

const saveCache = (cacheObj) => {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheObj, null, 2) + '\n');
    } catch (e) {
        console.log('[youtube] Failed to save cache:', e.message);
    }
};

(async () => {
    console.log('[youtube] Starting runner...');
    console.log(`[youtube] EXT_PATH: ${EXT_PATH}`);

    await killExistingChrome();

    const chromeArgs = [
        `--remote-debugging-port=${PORT}`,
        `--load-extension=${EXT_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--new-window',
        // Keep background/occluded tabs running reliably
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion',
        // Avoid autoplay gating and mute globally as a safety
        '--autoplay-policy=no-user-gesture-required',
        '--mute-audio',
    ];

    console.log('[youtube] Spawning Chrome...');
    const chrome = spawn(CHROME_PATH, chromeArgs, { detached: true, stdio: 'ignore' });
    chrome.unref();
    console.log('[youtube] Chrome spawned.');

    initializeServer();

    const rawArg = process.argv[2];
    const handle = getHandleFromArg(rawArg);
    if (!handle) {
        console.log('Usage: node youtube.js @handle');
        process.exit(1);
    }

    await sleep(8000);

    // Channel mode: collect video IDs then cache transcripts
    console.log(`[youtube] Channel mode for ${handle}`);
    const cache = loadCache();
    if (!cache[handle]) cache[handle] = {};
    let ids = [];
    try {
        const resp = await sendCommand({ type: 'youtuber-vids', username: handle });
        if (resp && Array.isArray(resp.result)) {
            ids = resp.result;
        } else if (resp && resp.result && Array.isArray(resp.result.result)) {
            ids = resp.result.result;
        } else {
            console.log('[youtube] Unexpected response for youtuber-vids:', resp);
        }
    } catch (e) {
        console.log('[youtube] Error collecting video IDs:', e && e.message ? e.message : e);
    }
    console.log(`[youtube] Found ${ids.length} video IDs`);
    let fetched = 0;
    for (const vid of ids) {
        if (cache[handle][vid] && cache[handle][vid] !== '') {
            console.log(`[youtube] Skipping ${vid} because it's already cached`);
            continue;
        }
        try {
            const resp = await sendCommand({ type: 'youtube-transcript', videoId: vid });
            const transcript = (resp && typeof resp.result === 'string') ? resp.result : '';
            cache[handle][vid] = transcript;
            fetched++;
            saveCache(cache);
            await sleep(randomDelay(4000));
        } catch (e) {
            console.log(`[youtube] Error fetching transcript for ${vid}:`, e && e.message ? e.message : e);
        }
    }
    saveCache(cache);
    console.log(`[youtube] Done. Cached ${Object.keys(cache[handle]).length} items for ${handle}. Newly fetched: ${fetched}`);
    // Close Chrome so the last video does not keep playing
    try {
        await killExistingChrome();
    } catch (_) {}
    try { shutdownServer(); } catch (_) {}
    process.exit(0);
})();

// Ensure Chrome is terminated on Ctrl+C or termination signals
const shutdown = async () => {
    try { await killExistingChrome(); } catch (_) {}
    try { shutdownServer(); } catch (_) {}
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);


