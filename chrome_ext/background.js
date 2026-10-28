
// Define available actions that involve DOM manipulation
/*const actions = {
    'get-actions': () => {
        return {
            'get-dom': 'Returns a stripped-down version of the DOM',
            'click': 'Clicks an element specified by a valid CSS selector',
            'type': 'Types text into an input field specified by a valid CSS selector',
            'upload': 'Uploads a file specified by a file location',
            'load': 'Loads a website'
        };
    }
};*/
// wake up immediately
//chrome.runtime.onStartup.addListener( () => {
    //console.log(`onStartup()`);
//});

let socket;
const serverUrl = 'ws://localhost:3001';

let sessionTab = null;

function sendToServer(obj) {
    try {
        const data = typeof obj === 'string' ? obj : JSON.stringify(obj);
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(data);
        } else {
            console.log('WS not open; dropping message:', data);
        }
    } catch (e) {
        console.log('sendToServer error:', e);
    }
}

const sendWithRetry = (tabId, params) => {
    const tabSend = () => {
        chrome.tabs.sendMessage(tabId, params, (results) => {
            console.log(results);
            sendToServer(results);
        });
    }
    chrome.tabs.get(tabId, (tab) => {
        if (tab && tab.status === 'complete') {
            tabSend();
        } else {
            const interval = setInterval(() => {
                console.log('was busy, trying again')
                chrome.tabs.get(tabId, updatedTab => {
                    if (updatedTab && updatedTab.status === 'complete') {
                        clearInterval(interval);
                        tabSend();
                    }
                });
            }, 1000);
        }
    });
}

function connectWebSocket() {
    try {
        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
        socket = new WebSocket(serverUrl);
        socket.addEventListener('open', () => {
            console.log('WebSocket connection opened');
            try { socket.send(JSON.stringify({ type: 'greeting', message: 'Hello from background!' })); } catch (_) {}
        });
        socket.addEventListener('message', async ({ data }) => {
            try { await handleServerMessage(data); } catch (e) { console.log('Error handling WS message:', e); }
        });
        socket.addEventListener('error', (event) => {
            console.log('WebSocket error:', event);
        });
        socket.addEventListener('close', () => {
            console.log('WebSocket closed, retrying in 3s');
            setTimeout(connectWebSocket, 3000);
        });
    } catch (e) {
        console.log('connectWebSocket error:', e);
    }
}

const poolLoad = async (parsedData) => {
    const {latitude, longitude} = parsedData;
    const chromeProperties = {url: `https://www.places2swim.com?c1=${latitude}&c2=${longitude}&z1=12`};

    const tabCallback = tab => {
        sessionTab = tab;
        sendWithRetry(tab.id, { ...parsedData, type: 'pool_load' });
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0)
            chrome.tabs.create(chromeProperties, tabCallback);
        else
            chrome.tabs.update(tabs[0].id, chromeProperties, tabCallback);
    });
}


async function handleServerMessage(raw) {
    console.log('Received message from server:', raw);
    let parsedData;
    try {
        parsedData = JSON.parse(raw);
    } catch (e) {
        console.log('Error parsing incoming data:', e);
        return;
    }

    const { type } = parsedData;
    console.log(type);

    let result;
    try {
        if (type === 'pool_load') {
            poolLoad(parsedData);

        } else if (type === 'alaska_load') {
            // Unique path 
            const { departure, arrival, date } = parsedData;
            const ALASKA_URL = `https://www.alaskaair.com/search/results?O=${departure}&D=${arrival}&OD=${date}&A=1&RT=false&ShoppingMethod=onlineaward&locale=en-us`

            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs || tabs.length === 0) {
                    chrome.tabs.create({ url: ALASKA_URL }, (tab) => {
                        sessionTab = tab;
                        sendWithRetry(tab.id, { ...parsedData, type: 'alaska_load' });
                    });
                } else {
                    chrome.tabs.update(tabs[0].id, { url: ALASKA_URL }, (tab) => {
                        sessionTab = tab;
                        sendWithRetry(tab.id, { ...parsedData, type: 'alaska_load' });
                    });
                }
            });

        } else if (type === 'youtube-transcript') {
            const { videoId } = parsedData;
            const YT_URL = `https://www.youtube.com/watch?v=${videoId}`;
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs || tabs.length === 0) {
                    chrome.tabs.create({ url: YT_URL }, (tab) => {
                        sessionTab = tab;
                        sendWithRetry(tab.id, { ...parsedData, type: 'youtube-transcript' });
                    });
                } else {
                    chrome.tabs.update(tabs[0].id, { url: YT_URL }, (tab) => {
                        sessionTab = tab;
                        sendWithRetry(tab.id, { ...parsedData, type: 'youtube-transcript' });
                    });
                }
            });
        } else if (type === 'youtuber-vids') {
            const { username } = parsedData;
            const handle = String(username || '').startsWith('@') ? username : `@${username}`;
            const YT_URL = `https://www.youtube.com/${handle}/videos`;

            const tabSendRetry = tab => {
                sessionTab = tab;
                sendWithRetry(tab.id, { ...parsedData, type: 'youtuber-vids' });
            }

            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs || tabs.length === 0) {
                    chrome.tabs.create({ url: YT_URL }, tabSendRetry);
                } else {
                    chrome.tabs.update(tabs[0].id, { url: YT_URL }, tabSendRetry);
                }
            });
        } else if (type === 'scribd-open') {
            // Opens the document, then takes the first step from the top of the page
            const tabSendRetry = tab => {
                sessionTab = tab;
                sendWithRetry(tab.id, { type: 'scribd-step', scrollTo: 0, settleMs: 3000 });
            }

            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs || tabs.length === 0) {
                    chrome.tabs.create({ url: parsedData.url }, tabSendRetry);
                } else {
                    chrome.tabs.update(tabs[0].id, { url: parsedData.url }, tabSendRetry);
                }
            });
        } else if (type === 'scribd-step') {
            sendWithRetry(sessionTab.id, parsedData);
        } else if (['load'].includes(type)) {
            chrome.tabs.create({ url: parsedData.url }, (tab) => {
                const tabSend = () => {
                    chrome.tabs.sendMessage(tab.id, { type: 'get-summary' }, (results) => {
                        sendToServer(results);
                    });
                }
                if (tab.status === 'complete') {
                    sessionTab = tab;
                    tabSend();
                } else {
                    const interval = setInterval(() => {
                        console.log('was busy, trying again')
                        chrome.tabs.get(tab.id, updatedTab => {
                            if (updatedTab.status === 'complete') {
                                clearInterval(interval);
                                tabSend();
                            }
                        });
                    }, 1000);
                }
            });
        } else {
            const tabSend = () => {
                chrome.tabs.sendMessage(sessionTab.id, parsedData, (results) => {
                    sendToServer(results);
                });
            }
            if (sessionTab.status === 'complete') {
                tabSend();
            } else {
                const interval = setInterval(() => {
                    console.log('was busy, trying again')
                    chrome.tabs.get(sessionTab.id, updatedTab => {
                        if (updatedTab.status === 'complete') {
                            clearInterval(interval);
                            tabSend();
                        }
                    });
                }, 1000);
            }
        }
    } catch (e) {
        result = `Error executing action: ${e.message}`;
        sendToServer({ type: 'result', result });
    }

}

// Attempt to connect immediately when the service worker starts
try {
    connectWebSocket();
} catch (e) {
    // ignore
}

// Also try on install/startup events
chrome.runtime.onInstalled.addListener(() => {
    try { connectWebSocket(); } catch (e) { }
});
chrome.runtime.onStartup.addListener(() => {
    try { connectWebSocket(); } catch (e) { }
});

// A sleeping service worker loses its retry timers, so wake it two ways: every page load
// pings it from content.js, and an alarm fires every 30s (the shortest Chrome allows).
chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'wake') {
        try { connectWebSocket(); } catch (e) { }
    }
});
chrome.alarms.create('reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => {
    try { connectWebSocket(); } catch (e) { }
});

// Function to run DOM manipulation actions (content script)
function runDomAction(action, params) {
    const actions = {
        'get-dom': () => {
            // Your get-dom code here
        },
        'click': ({ selector }) => {
            const element = document.querySelector(selector);
            if (element) {
                element.click();
                return `Clicked element: ${selector}`;
            } else {
                return `Error: Element not found for selector: ${selector}`;
            }
        },
        'type': ({ selector, text }) => {
            const element = document.querySelector(selector);
            if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA')) {
                element.value = text;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                return `Typed text into element: ${selector}`;
            } else {
                return `Error: Element not found or not an input field for selector: ${selector}`;
            }
        },
        'upload': ({ selector, fileLocation }) => {
            return `Error: File uploads must be manually initiated by the user.`;
        }
    };
    return actions[action](params);
}

setInterval(() => {
    if (!socket || socket.readyState === WebSocket.CLOSED) {
        console.log('Attempting to reconnect to WebSocket server...')
        try {
            connectWebSocket();
        } catch (e) {

        }
    }
}, 10000);

// Keep alive?
setInterval(() => {
    //console.log("I'm awake, I'm awake");
    //chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {});

}, 29_000)
