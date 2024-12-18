const waitForNetworkIdle = (timeout = 1000, checkInterval=1000) => {
    return new Promise(resolve => {
        let lastActiveTimestamp = Date.now();

        const check = () => {
            const now = Date.now();
            if (now - lastActiveTimestamp >= checkInterval) {
                console.log('resolving', now, lastActiveTimestamp)
                resolve();
            } else {
                setTimeout(check, checkInterval);
            }
        };

        const updateLastActiveTimestamp = () => {
            lastActiveTimestamp = Date.now();
        }

        const originalFetch = window.fetch;
        window.fetch = (...args) => {
            updateLastActiveTimestamp();
            return originalFetch.apply(this,args);
        }
        const originalXHROpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = (...args) => {
            this.addEventListener('readystatechange', updateLastActiveTimestamp, true);
            originalXHROpen.apply(this, args);
        }
        check();
    })
};

const simpleDom = async () => {
    // Create a clone of the document to avoid modifying the original DOM
    const clonedDocument = document.cloneNode(true);

    // Remove <script> and <style> tags from the cloned document
    clonedDocument.querySelectorAll('script, style').forEach(element => element.remove());

    // Remove style attributes from all elements
    clonedDocument.querySelectorAll('[style]').forEach(element => element.removeAttribute('style'));

    // Remove all comments
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
        }
    }

    // Remove multiple empty lines from the resulting string
    simplifiedDom = simplifiedDom.replace(/\n{2,}/g, '\n');
    return simplifiedDom;
}

// Define the available DOM actions in content.js
const actions = {
    'get-summary': async () => {
        await waitForNetworkIdle();
        return {
            domSummary: await simpleDom(),
            url: window.location.href
        }
    },
    'get-dom': simpleDom,

    'click': async ({ action }) => {
        const element = document.querySelector(action.selector);
        if (element) {
            element.click();
            return `Clicked element: ${action.selector}`;
        } else {
            return `Error: Element not found for selector: ${action.selector}`;
        }
    },

    'type': async ({ selector, text }) => {
        const element = document.querySelector(selector);
        if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA')) {
            element.value = text;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            return `Typed text into element: ${selector}`;
        } else {
            return `Error: Element not found or not an input field for selector: ${selector}`;
        }
    },

    'upload': async ({ selector, fileLocation }) => {
    },

    'load': async ({ url }) => {
        return `Error: Can't load from here`;
    }
};

//console.log("WHOOO running content.js on this site")

// Listen for messages from background.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        const { type } = request;
        console.log('received message from background: ' + JSON.stringify(request))

        // Step 9 get DOM
        if (actions[type]) {
            let result;
            try {
                result = await actions[type](request);
            } catch (e) {
                result = `Error executing action: ${e.message}`;
            }
            try {
                console.log(JSON.stringify(result));
                sendResponse({ type, result });
            } catch (e) {
                result = `Error doing something: ${e.message}`;
            }
        } else {
            sendResponse({ type, result: `Unknown action requested: ${type}` });
        }
    })();
    return true;
});
