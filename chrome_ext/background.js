
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

let socket;
const serverUrl = 'ws://localhost:3001';

function connectWebSocket() {
    // Create a WebSocket connection to the server
    socket = new WebSocket('ws://localhost:3001');

    // Open WebSocket connection
    socket.addEventListener('open', (event) => {
        console.log('WebSocket connection opened:', event);
        socket.send(JSON.stringify({ type: 'greeting', message: 'Hello from background script!' }));
    });

    // Handle incoming messages from the WebSocket server
    socket.addEventListener('message', ({ data }) => {
        console.log('Received message from server:', data);
        let parsedData;
        try {
            parsedData = JSON.parse(data);
        } catch (e) {
            console.log('Error parsing incoming data:', e);
            return;
        }

        const { type } = parsedData;
        console.log(type);

        let result;
        try {
            if (['load'].includes(type)) {
                // This needs to be done here, not in content scripts
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    chrome.tabs.update(tabs[0].id, { url: parsedData.url/*||'https://partiful.com'*/ }, (tab) => {
                        socket.send(JSON.stringify({type: type, 'result': `Tab ${tab.id} navigating to ${tab.pendingUrl}.`}))
                    })
                });
            } else {


                //if (actions[action]) {
                // For actions that require DOM manipulation, execute code in the content script
                //if (['get-dom', 'click', 'type', 'upload'].includes(action)) {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    // Annoying but we do need to wait for the next page to load when we navigate
                    const tabSend = () => {
                        chrome.tabs.sendMessage(tabs[0].id, parsedData, (results) => {
                            console.log(results);
                            //result = results.result;
                            // forward it back to the server
                            socket.send(JSON.stringify(results));
                        });
                    }
                    if (tabs[0].status === 'complete') {
                        tabSend();
                    } else {
                        const interval = setInterval(() => {
                            console.log('was busy, trying again')
                            chrome.tabs.get(tabs[0].id, updatedTab => {
                                if (updatedTab.status === 'complete') {
                                    clearInterval(interval);
                                    tabSend();
                                }
                            });
                        }, 1000);
                    }
                });
            }

            //} else {
            //result = actions[action](params);
            //socket.send(JSON.stringify({ type: 'result', result }));
            //}
        } catch (e) {
            result = `Error executing action: ${e.message}`;
            socket.send(JSON.stringify({ type: 'result', result }));
        }
        //} else {
        //console.log(`Unknown action requested: ${action}`);
        //}
    });

    // WebSocket error handling
    socket.addEventListener('error', (event) => {
        console.log('WebSocket error:', event);
    });

    // WebSocket connection closed event
    socket.addEventListener('close', (event) => {
        console.log('WebSocket connection closed:', event);
    });
}

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
