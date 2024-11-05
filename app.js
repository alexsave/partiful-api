const http = require('http');
const crypto = require('crypto');
const readline = require('readline');
require('dotenv').config();
const OpenAI = require('openai');

const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');

const {partifulApi, summaryForLLM} = require('./partiful')

const client = new OpenAI();

// WebSocket server variables
const sockets = [];

// Similar to Android context? Will store things like verification codes and such
const context = {};

// Create an HTTP server
const server = http.createServer((req, res) => {
    res.writeHead(404);
    res.end();
});

// Start the HTTP server and listen on port 3001
server.listen(3001, () => {
    console.log('Server is listening on ws://localhost:3001');
});

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
            const message = parseWebSocketFrame(buffer);
            if (message) {
                console.log('Received:', message);

                // Respond to the client
                //const reply = createWebSocketFrame(JSON.stringify({action: 'get-actions'}));
                //socket.write(reply);
            }
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

// Function to generate the Sec-WebSocket-Accept value
function generateAcceptValue(key) {
    return crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'binary')
        .digest('base64');
}

// Function to parse WebSocket frames
function parseWebSocketFrame(buffer) {
    const firstByte = buffer[0];
    const opCode = firstByte & 0xf;

    // Only handle text frames (opcode 1)
    if (opCode === 0x1) {
        const secondByte = buffer[1];
        let length = secondByte & 0x7f;
        let offset = 2;

        if (length === 126) {
            length = buffer.readUInt16BE(2);
            offset += 2;
        } else if (length === 127) {
            // Very large lengths, not likely needed in this example
            length = buffer.readBigUInt64BE(2);
            offset += 8;
        }

        const masks = buffer.slice(offset, offset + 4);
        offset += 4;

        const messageBuffer = buffer.slice(offset, offset + length);
        let decoded = '';

        for (let i = 0; i < messageBuffer.length; i++) {
            decoded += String.fromCharCode(messageBuffer[i] ^ masks[i % 4]);
        }

        return decoded;
    }

    return null;
}

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

// Setting up user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ApiRecommendation = z.object({
    apiName: z.string()
});

// This handles raw input by sending it to ChatGPT and doing stuff.
// Eventually we get to the point where we just give it the DOM, plus the click&type commands. 
// But for now we have "APIs" that bundle a bunch of commands
const processCommand = async input => {
    //console.log(input);
    //console.log(JSON.stringify(partifulApi.map(x => {x.name, x.description, x.params})))
    //console.log(summaryForLLM);

    const prompt = `Given the user request "${input}" and the available APIs:\n${summaryForLLM}, return the name of the API to use to fulfill the users request.`;

    const completion = await client.beta.chat.completions.parse({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'You are a helpful assistant. Only use the schema for responses.' },
            { role: 'user', content: prompt }
        ],
        response_format: zodResponseFormat(ApiRecommendation, 'apiRecommendation')
        
    });
    console.log(JSON.stringify(completion));

}

// Listen for user input and send a message to all connected clients
rl.on('line', (input) => {
    console.log(`User input received: ${input}`);
    processCommand(input);
});