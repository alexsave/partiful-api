// this one is going to be simpler than the other one.
// No AI use. Just a loop over a simple website. We will need the chrome extension though
const { initializeServer, sendCommand } = require('./utils/webutils')
const {exec, spawn} = require('child_process');

const CDP = require('chrome-remote-interface');

// WebSocket server variables

// Similar to Android context? Will store things like verification codes and such
const context = {};

const DEFAULT_HOME = "chrome://newtab";
const BROWSER = "Google Chrome";

// hmm so there's almost another level to this, where we should open chrome directly to a page if it's not open already
// but i'll get to that later. for now we just open chrome to idk google.com

/*
start chrome with --remote-debugging-port=<someport>
before an event where you want to ensure the servce worker is up (in my case it was sending a websocket event to the chrome extension)
*/
// check if chrome is open, if not open it to some home page
//const command = `pgrep -x "${BROWSER}" > /dev/null || open -n -a "${BROWSER}" ${DEFAULT_HOME} --args --remote-debugging-port=43`
// ok this arg is way easier than my other attempt
//const command = `/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --load-extension="./chrome_ext"`;
// ok maybe i need a bash
//const command = `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`;
//const args = ['--remote-debugging-port=43'];
// because we need to relaunch, we should probably close all other chrome tabs

//exec(command, (error, stdout, stderr) => {
//const chromeProcess = spawn(command, args, { detached: true, /*stdio: 'ignore'*/ });

//chromeProcess.unref(); // Detach the process

// Don't worry about async, there's no way this takes longer to run compared to typing in a prompt + hitting enter
console.log('executing command');
// this never really ends, so chrome never closes
//exec(command, (error, stdout, stderr) => {
//
    //console.log('callback called');
    //if (error) {
        //console.error(`Error: ${error.message}`);
        //return;
    //}
    //if (stderr) {
        //console.error(`Stderr: ${stderr}`);
        //return;
    //}
    //console.log(`Stdout: ${stdout}`);
//});

const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EXT_PATH = path.resolve(__dirname, './chrome_ext'); // make sure this exists
const PORT = 9222;
const HOST = '127.0.0.1';

// Helpers
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const killExistingChrome = () => new Promise((resolve) => {
    console.log(`[launcher] Ensuring no existing Chrome is running...`);
    const killer = spawn('pkill', ['-f', 'Google Chrome']);
    killer.on('error', (err) => {
        console.log(`[launcher] pkill error: ${err.message}`);
        resolve();
    });
    killer.on('close', (code) => {
        console.log(`[launcher] pkill finished with code: ${code}`);
        resolve();
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
                    ok ? resolve() : reject(new Error(`HTTP ${res.statusCode}`));
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
    const departure = 'LAX';
    const arrival = 'SFO';
    const date = '2025-09-21';
    await sendCommand({ type: 'alaska_load', departure, arrival, date });

}, 15000);
