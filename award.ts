// this one is going to be simpler than the other one.
// No AI use. Just a loop over a simple website. We will need the chrome extension though
const { initializeServer, sendCommand } = require('./utils/webutils')
const {exec, spawn} = require('child_process');

const CDP = require('chrome-remote-interface');

const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EXT_PATH = path.resolve(__dirname, './chrome_ext'); // make sure this exists
const PORT = 9222;
const HOST = '127.0.0.1';

const SAVE_FILE = path.resolve(__dirname, './data.json');

// Keyed datastore: "DEP|ARR|YYYY-MM-DD" -> { lastChecked: ISO, data }
let dataStore = {};
try {
    if (fs.existsSync(SAVE_FILE)) {
        const raw = fs.readFileSync(SAVE_FILE, 'utf8').trim();
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                console.log('[data] Found legacy array data; initializing new keyed store');
                dataStore = {};
            } else if (parsed && typeof parsed === 'object') {
                dataStore = parsed;
            }
        }
    }
} catch (e) {
    console.log('[data] Failed to load existing data store:', e.message);
    dataStore = {};
}

// Helpers
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HOUR_MS = 60 * 60 * 1000;
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomSleep = (minMs, maxMs) => sleep(randomInt(minMs, maxMs));

const killExistingChrome = () => new Promise((resolve) => {
    console.log(`[launcher] Ensuring no existing Chrome is running...`);
    const killer = spawn('pkill', ['-f', 'Google Chrome']);
    killer.on('error', (err) => {
        console.log(`[launcher] pkill error: ${err.message}`);
        resolve(undefined);
    });
    killer.on('close', (code) => {
        console.log(`[launcher] pkill finished with code: ${code}`);
        resolve(undefined);
    });
});

const waitForDevTools = async (host, port, timeoutMs = 30000) => {
    const start = Date.now();
    const url = `http://${host}:${port}/json/version`;
    console.log(`[launcher] Waiting for DevTools at ${url} (timeout ${timeoutMs}ms)...`);
    while (Date.now() - start < timeoutMs) {
        try {
            await new Promise((resolve, reject) => {
                const req = http.get(url, (res) => {
                    const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
                    ok ? resolve(undefined) : reject(new Error(`HTTP ${res.statusCode}`));
                });
                req.on('error', reject);
                req.setTimeout(2000, () => {
                    req.destroy(new Error('timeout'));
                });
            });
            console.log(`[launcher] DevTools is responding.`);
            return true;
        } catch (e) {
            console.log(`[launcher] DevTools not ready yet: ${e.message}`);
        }
        await sleep(500);
    }
    throw new Error('DevTools readiness timed out');
};

const cdpOpts = { port: 9222, host: "127.0.0.1" }
const scopeUrl = "chrome-extension://jopnjjlijghkbopccilgaglodjaiohlm/"; // replace with your own extension id which can be seen in the extension tab 

(async () => {
    try {
        console.log(`[launcher] CHROME_PATH: ${CHROME_PATH}`);
        console.log(`[launcher] EXT_PATH: ${EXT_PATH} (exists: ${fs.existsSync(EXT_PATH)})`);
        console.log(`[launcher] HOST: ${HOST}, PORT: ${PORT}`);

        await killExistingChrome();

const chromeArgs = [
  `--remote-debugging-port=${PORT}`,
  //`--user-data-dir=/tmp/chrome-cdp-${PORT}`,
  //`--disable-extensions-except=${EXT_PATH}`,
  `--load-extension=${EXT_PATH}`,
  '--no-first-run',
  '--no-default-browser-check',
            '--new-window',
        ];

        console.log(`[launcher] Spawning Chrome...`);
        const chrome = spawn(CHROME_PATH, chromeArgs, { detached: true, stdio: 'ignore' });
chrome.unref();
        console.log(`[launcher] Chrome spawned (pid detached).`);

        if(true){return}
        await waitForDevTools(HOST, PORT, 30000);

        console.log('[launcher] Connecting to Chrome DevTools...');
        let debugClient;
        try {
            debugClient = await CDP(cdpOpts);
        } catch (err) {
            console.error('[launcher] CDP initial connect failed:', err.message);
            // one quick retry after short delay
            await sleep(1000);
            debugClient = await CDP(cdpOpts);
        }
        console.log('[launcher] CDP client connected.');

        const { Runtime, ServiceWorker } = debugClient;
        await Runtime.enable();
        console.log('[launcher] Runtime domain enabled.');

        const checkExtensionsScript = `
            new Promise((resolve) => {
                chrome.management.getAll((extensions) => {
                    resolve(extensions.map(ext => ext.id));
                });
            });
        `;
        try {
            const extensionsResponse = await Runtime.evaluate({
                expression: checkExtensionsScript,
                awaitPromise: true,
            });
            const installedExtensions = extensionsResponse.result.value;
            console.log('[launcher] Installed Extensions:', installedExtensions);
        } catch (e) {
            console.log('[launcher] Unable to enumerate extensions via Runtime:', e.message);
        }

        try {
            await ServiceWorker.enable();
            console.log('[launcher] ServiceWorker domain enabled.');
            ServiceWorker.workerRegistrationUpdated(({ registrations }) => {
                try {
                    console.log('[launcher] Registrations:', registrations.map(r => ({ scopeURL: r.scopeURL })));
                } catch (_) {}
            });
            ServiceWorker.workerVersionUpdated(({ versions }) => {
                try {
                    console.log('[launcher] Versions:', versions.map(v => ({ id: v.versionId, status: v.status, scriptURL: v.scriptURL, controlledClients: v.controlledClients })));
                } catch (_) {}
                const ext = versions.find(v => v.scriptURL && v.scriptURL.startsWith('chrome-extension://'));
                if (ext && ext.scriptURL) {
                    const extScope = ext.scriptURL.replace(/\/background\.js.*/, '/');
                    console.log(`[launcher] Attempting to start extension worker at scope: ${extScope}`);
                    debugClient.send('ServiceWorker.startWorker', { scopeURL: extScope }).catch(e => console.log('[launcher] startWorker error:', e.message));
                }
            });
        } catch (e) {
            console.log('[launcher] ServiceWorker enable failed:', e.message);
        }

        let wakeCount = 0;
        const wakeInterval = setInterval(async () => {
            try {
                console.log('[launcher] Waking up worker... (#' + (wakeCount + 1) + ')');
                await debugClient.send("ServiceWorker.enable");
            } catch (e) {
                console.log('[launcher] ServiceWorker ping failed:', e.message);
            }
            wakeCount++;
            if (wakeCount >= 10) {
                console.log('[launcher] Reached 10 wakeups. Exiting.');
                clearInterval(wakeInterval);
                // small delay to flush logs
                setTimeout(() => process.exit(0), 250);
            }
        }, 2000);
    } catch (e) {
        console.error('[launcher] Fatal error during Chrome launch/connect:', e);
    }
})();
// Execute the command

initializeServer();

setTimeout(async () => {
    const departure = 'SEA';
    const arrival = 'ICN';
    const date = '2025-09-21';
    const data = await sendCommand({ type: 'alaska_load', departure, arrival, date });
    console.log('data', data);

    const today = new Date();
    // Build 0..364 day offsets and shuffle
    const offsets = Array.from({ length: 365 }, (_, i) => i);
    for (let i = offsets.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
    }

    for (const offset of offsets) {
        const d = new Date(today);
        d.setDate(d.getDate() + offset);
        const dateStr = d.toISOString().split('T')[0];
        const key = `${departure}|${arrival}|${dateStr}`;

        // Skip if checked within the last hour
        const now = Date.now();
        const last = dataStore[key]?.lastChecked ? Date.parse(dataStore[key].lastChecked) : 0;
        if (last && now - last < HOUR_MS) {
            console.log(`[skip] Recently checked ${key}; skipping`);
            await randomSleep(250, 1250);
            continue;
        }

        const data = await sendCommand({ type: 'alaska_load', departure, arrival, date: dateStr });
        console.log('data', { key, summary: { flights: Array.isArray(data?.result?.flights) ? data.result.flights.length : undefined } });

        dataStore[key] = {
            lastChecked: new Date().toISOString(),
            data,
        };

        // Persist full keyed store
        fs.writeFileSync(SAVE_FILE, JSON.stringify(dataStore) + '\n');

        // Randomized gentle delay between calls
        await randomSleep(2000, 3000);
    }


}, 15000);
