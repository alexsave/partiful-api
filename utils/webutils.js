const http = require('http');
const crypto = require('crypto');

const sockets = [];
let httpServer = null;
const socketStates = new WeakMap(); // socket -> { buffer: Buffer, assembling: string }

// Function to create a WebSocket frame for sending messages
function createWebSocketFrame(data) {
    const payload = Buffer.from(data);
    const length = payload.length;

    let frame = [];

    // Create a basic text frame
    frame.push(0x81); // 10000001 (FIN and text frame opcode)

    if (length <= 125) {
        frame.push(length);
    } else if (length >= 126 && length <= 65535) {
        frame.push(126, (length >> 8) & 255, length & 255);
    } else {
        frame.push(
            127,
            (length >> 56) & 255,
            (length >> 48) & 255,
            (length >> 40) & 255,
            (length >> 32) & 255,
            (length >> 24) & 255,
            (length >> 16) & 255,
            (length >> 8) & 255,
            length & 255
        );
    }

    frame = Buffer.concat([Buffer.from(frame), payload]);

    return frame;
}

// Parse as many complete frames as possible from a buffer. Returns
// { frames: string[], remaining: Buffer }
function readFrame(buffer, startOffset) {
    if (buffer.length - startOffset < 2) return null;
    const firstByte = buffer[startOffset];
    const fin = (firstByte & 0x80) !== 0;
    const opcode = firstByte & 0x0f;
    const secondByte = buffer[startOffset + 1];
    const isMasked = (secondByte & 0x80) !== 0;
    let length = secondByte & 0x7f;
    let headerLen = 2;

    if (length === 126) {
        if (buffer.length - startOffset < 4) return null;
        length = buffer.readUInt16BE(startOffset + 2);
        headerLen = 4;
    } else if (length === 127) {
        if (buffer.length - startOffset < 10) return null;
        const bigLen = buffer.readBigUInt64BE(startOffset + 2);
        if (bigLen > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error('Frame too large to handle');
        }
        length = Number(bigLen);
        headerLen = 10;
    }

    const maskLen = isMasked ? 4 : 0;
    const totalHeader = headerLen + maskLen;
    if (buffer.length - startOffset < totalHeader + length) return null;

    const maskStart = startOffset + headerLen;
    const payloadStart = startOffset + totalHeader;
    const payloadEnd = payloadStart + length;
    let payload = buffer.slice(payloadStart, payloadEnd);
    if (isMasked) {
        const masks = buffer.slice(maskStart, maskStart + 4);
        const unmasked = Buffer.allocUnsafe(payload.length);
        for (let i = 0; i < payload.length; i++) {
            unmasked[i] = payload[i] ^ masks[i % 4];
        }
        payload = unmasked;
    }

    return { fin, opcode, payload, nextOffset: payloadEnd };
}

// Function to generate the Sec-WebSocket-Accept value
function generateAcceptValue(key) {
    return crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'binary')
        .digest('base64');
}

const initializeServer = () => {
    // Create an HTTP server
    const server = http.createServer((req, res) => {
        res.writeHead(404);
        res.end();
    });

    // Start the HTTP server and listen on port 3001
    server.listen(3001, () => {
        console.log('Server is listening on ws://localhost:3001');
    });
    httpServer = server;

    // Handle WebSocket upgrade requests
    server.on('upgrade', (req, socket, head) => {
        const key = req.headers['sec-websocket-key'];
        const acceptKey = generateAcceptValue(key);

        const responseHeaders = [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${acceptKey}`
        ];

        // Handshake response
        socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');


        // Store the connected socket
        sockets.push(socket);

        // Handle socket errors
        socket.on('error', (err) => {
            console.error('Socket error:', err);
        });

        // Start listening for data from the client
        socket.on('data', (buffer) => {
            try {
                // It doesn't like it when both are listening
                //const message = parseWebSocketFrame(buffer);
                //if (message) {
                //console.log('Global received:', message);

                // Respond to the client
                //const reply = createWebSocketFrame(JSON.stringify({action: 'get-actions'}));
                //socket.write(reply);
                //}
            } catch (err) {
                console.error('Error processing message:', err);
                socket.destroy(); // Safely close the connection on error
            }
        });

        // Handle client disconnect
        socket.on('close', () => {
            console.log('Client disconnected');
            const index = sockets.indexOf(socket);
            if (index !== -1) {
                sockets.splice(index, 1);
            }
        });
    });
}

const shutdownServer = () => {
    try {
        sockets.forEach((socket) => {
            try { socket.destroy(); } catch (_) {}
        });
        sockets.length = 0;
        if (httpServer) {
            try { httpServer.close(); } catch (_) {}
            httpServer = null;
        }
    } catch (_) {}
};

// With timeoutMs, rejects if no reply arrives in time and stops listening for it
const sendCommand = (command, timeoutMs) => {
    return new Promise((resolve, reject) => {
        const message = createWebSocketFrame(JSON.stringify(command));
        console.log(`Sending message to ${sockets.length} sockets`);
        const listeners = [];
        if (timeoutMs) {
            setTimeout(() => {
                listeners.forEach(([socket, listener]) => socket.removeListener('data', listener));
                reject(new Error(`No reply to ${command.type} within ${timeoutMs}ms`));
            }, timeoutMs);
        }
        sockets.forEach((socket) => {
            const onMessage = buffer => {
                try {
                    const state = socketStates.get(socket) || { buffer: Buffer.alloc(0), assembling: '' };
                    let combined = Buffer.concat([state.buffer, buffer]);
                    let offset = 0;
                    while (true) {
                        const frame = readFrame(combined, offset);
                        if (!frame) break; // need more data
                        offset = frame.nextOffset;

                        if (frame.opcode === 0x1 || frame.opcode === 0x0) { // text or continuation
                            // Append UTF-8 chunk to assembling string
                            state.assembling += frame.payload.toString('utf8');
                            if (frame.fin) {
                                const response = state.assembling;
                                state.assembling = '';
                                try {
                                    const parsedResponse = JSON.parse(response);
                                    if (parsedResponse.type === command.type) {
                                        //console.log(`Received response for action on: ${JSON.stringify(parsedResponse)}`);
                                        socket.removeListener('data', onMessage);
                                        socketStates.set(socket, { buffer: combined.slice(offset), assembling: '' });
                                        return resolve(parsedResponse);
                                    } else {
                                        socket.removeListener('data', onMessage);
                                        socketStates.set(socket, { buffer: combined.slice(offset), assembling: '' });
                                        return resolve(parsedResponse);
                                    }
                                } catch (e) {
                                    // ignore invalid JSON, continue accumulating
                                }
                            }
                        } else if (frame.opcode === 0x8) {
                            // close frame
                            socket.end();
                            break;
                        }
                    }
                    // Save remaining bytes
                    socketStates.set(socket, { buffer: combined.slice(offset), assembling: state.assembling });
                } catch (error) {
                    console.error('Error processing WebSocket response:', error);
                    reject(error);
                }
            };

            socket.write(message);
            socket.on('data', onMessage);
            listeners.push([socket, onMessage]);
        })

    })

}

// Resolves once the extension has connected, so commands are not sent to nobody
const waitForClient = async (timeoutMs) => {
    const start = Date.now();
    while (!sockets.length) {
        if (Date.now() - start > timeoutMs) throw new Error('Chrome extension never connected to ws://localhost:3001');
        await new Promise(r => setTimeout(r, 250));
    }
};

// This handles raw input by sending it to ChatGPT and doing stuff.
// Eventually we get to the point where we just give it the DOM, plus the click&type commands. 
// But for now we have "APIs" that bundle a bunch of commands

module.exports = {
    initializeServer, sendCommand, shutdownServer, waitForClient
}