// Define the available DOM actions in content.js
const actions = {
    'get-dom': () => {
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
    }, 
    
    'load': ({url}) => {
        console.log('load ' + url + ' requested');
    }
};

//console.log("WHOOO running content.js on this site")

// Listen for messages from background.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const { action, params } = request;
    console.log('received message from background: ' + JSON.stringify(request))

    if (actions[action]) {
        let result;
        try {
            result = actions[action](params);
        } catch (e) {
            result = `Error executing action: ${e.message}`;
        }
        sendResponse({ result });
    } else {
        sendResponse({ result: `Unknown action requested: ${action}` });
    }
});
