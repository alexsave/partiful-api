// Starts a Chrome that the extension in chrome_ext can drive.
// Chrome only honors --load-extension on the default profile sometimes, so keep the
// extension loaded manually in chrome://extensions as well.
const { spawn } = require('child_process');
const path = require('path');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EXT_PATH = path.resolve(__dirname, '../chrome_ext');
const DEBUG_PORT = 9222;

const killExistingChrome = () => new Promise((resolve) => {
    try {
        const killer = spawn('pkill', ['-f', 'Google Chrome']);
        killer.on('error', () => resolve(undefined));
        killer.on('close', () => resolve(undefined));
    } catch (_) {
        resolve(undefined);
    }
});

// Flags in extraArgs are appended to the defaults.
const launchChrome = (extraArgs = []) => {
    const chromeArgs = [
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--load-extension=${EXT_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--new-window',
        // Keep background/occluded tabs running reliably
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion',
        ...extraArgs,
    ];
    const chrome = spawn(CHROME_PATH, chromeArgs, { detached: true, stdio: 'ignore' });
    chrome.unref();
    return chrome;
};

module.exports = { killExistingChrome, launchChrome, EXT_PATH };
