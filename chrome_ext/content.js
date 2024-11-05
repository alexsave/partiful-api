(function() {
    // Create a WebSocket connection to the server
    const socket = new WebSocket('ws://localhost:3001');

    // Define available actions
    const actions = {
        'get-actions': () => {
            return {
                'get-dom': 'Returns a stripped-down version of the DOM',
                'click': 'Clicks an element specified by a valid CSS selector',
                'type': 'Types text into an input field specified by a valid CSS selector',
                'upload': 'Uploads a file specified by a file location'
            };
        },

        'get-dom': () => {
            // Create a clone of the document to avoid modifying the original DOM
            const clonedDocument = document.cloneNode(true);

            // Remove <script> and <style> tags from the cloned document using CSS selectors
            clonedDocument.querySelectorAll('script, style').forEach(element => element.remove());

            // Remove style attributes from all elements in the cloned document
            clonedDocument.querySelectorAll('[style]').forEach(element => element.removeAttribute('style'));

            // Remove all comments from the cloned document
            clonedDocument.querySelectorAll('*').forEach(element => {
                [...element.childNodes].forEach(child => {
                    if (child.nodeType === Node.COMMENT_NODE) {
                        child.remove();
                    }
                });
            });

            // Keep only buttons, inputs, <a> tags, and text nodes in their original order
            const walker = document.createTreeWalker(clonedDocument, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
                acceptNode: (node) => {
                    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '') {
                        return NodeFilter.FILTER_ACCEPT;
                    } else if (node.nodeType === Node.ELEMENT_NODE && (node.tagName.toLowerCase() === 'button' || node.tagName.toLowerCase() === 'input' || node.tagName.toLowerCase() === 'a')) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_SKIP;
                }
            });

            let simplifiedDom = '';
            let currentNode;
            while ((currentNode = walker.nextNode())) {
                if (currentNode.nodeType === Node.TEXT_NODE) {
                    simplifiedDom += `<div>${currentNode.textContent.trim()}</div>`;
                } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
                    simplifiedDom += `<${currentNode.tagName.toLowerCase()} id="${currentNode.id}" class="${currentNode.className}">`;
                }
                if (currentNode.nodeType === Node.ELEMENT_NODE && (currentNode.tagName.toLowerCase() === 'button' || currentNode.tagName.toLowerCase() === 'a')) {
                    let nextNode = walker.nextNode();
                    if (nextNode && nextNode.nodeType === Node.TEXT_NODE) {
                        simplifiedDom += nextNode.textContent.trim();
                    }
                    simplifiedDom += `</${currentNode.tagName.toLowerCase()}>`;
                } else {
                    simplifiedDom += '';
                }
            }

            // Remove multiple empty lines from the resulting string
            simplifiedDom = simplifiedDom.replace(/\n{2,}/g, '\n');
            //console.log('String length (only buttons, inputs, <a> tags, and text nodes):', simplifiedDom.length);
            return simplifiedDom;
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
            const element = document.querySelector(selector);
            if (element && element.tagName === 'INPUT' && element.type === 'file') {
                // In a Chrome extension, file uploads need to be handled through user interaction for security reasons
                return `Error: File uploads must be manually initiated by the user.`;
            } else {
                return `Error: Element not found or not a file input for selector: ${selector}`;
            }
        }
    };

    // Event listener for when the connection is opened
    socket.addEventListener('open', (event) => {
        console.log('WebSocket connection opened:', event);

        // Send a message to the server after connection is established (optional)
        socket.send(JSON.stringify({ type: 'greeting', message: 'Hello from content script!' }));
    });

    // Event listener for incoming messages from the WebSocket server
    socket.addEventListener('message', ({ data }) => {
        console.log('Received message from server:', data);
        let parsedData;
        try {
            parsedData = JSON.parse(data);
        } catch (e) {
            console.log('Error parsing incoming data:', e);
            return;
        }

        let { action, params } = parsedData;

        if (actions[action]) {
            let result;
            try {
                result = actions[action](params);
            } catch (e) {
                result = `Error executing action: ${e.message}`;
            }
            console.log(result);
            socket.send(JSON.stringify({ type: 'result', result }));
        } else {
            console.log(`Unknown action requested: ${action}`);
        }
    });


    // Event listener for errors in the WebSocket connection
    socket.addEventListener('error', (event) => {
        console.log('WebSocket error:', event);
    });

    // Event listener for when the WebSocket connection is closed
    socket.addEventListener('close', (event) => {
        console.log('WebSocket connection closed:', event);
    });
})();
