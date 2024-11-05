const readline = require('readline');
require('dotenv').config();
const OpenAI = require('openai');

const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');

const { partifulApi, summaryForLLM } = require('./partiful');
const { parse } = require('path');

const { initializeServer, sendCommand } = require('./utils/webutils')

const client = new OpenAI();

// WebSocket server variables

// Similar to Android context? Will store things like verification codes and such
const context = {};

initializeServer();

// Setting up user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ApiRecommendation = z.object({
    apiName: z.string()
});

const orchestrateApi = async apiName => {
    const api = partifulApi.find(x => x.name === apiName);
    if (!api) {
        console.log('Recommended API does not exist in predefined APIs');
        return;
    }

    // loop through commands and send them to the chrome extension

    // Not needed yet, but we'll do something like this to pass params to the calls
    const populatedParams = Object.fromEntries(api.params.map(p => [p.name, context[p.name]]));


    console.log(`Executing ${api.name}`);

    let last;

    for (let i = 0; i < api.commands.length; i++) {
        let command = api.commands[i];
        last = await sendCommand(command);
    }
    console.log("Action orchestrated")
    console.log(`Final action returned: ${last}`);
    // "last" should also be sent to the LLM to answer the original question

    const prompt = `Given the user request "${input}" and the info available after calling and API:\n${last}, answer the request in detail, even if it's just a confirmation of completing the request`;

    const completion = await client.beta.chat.completions.parse({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: prompt }
        ],
        //response_format: zodResponseFormat(ApiRecommendation, 'apiRecommendation')

    });
    const message = completion.choices[0]?.message;
    console.log(message);
}

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
    const message = completion.choices[0]?.message;
    if (message?.parsed) {
        const recommendation = message.parsed.apiName;
        console.log(`4o-mini suggests ${recommendation}`);

        orchestrateApi(recommendation);
    } else {
        console.log(message.refusal);
    }

}

// Listen for user input and send a message to all connected clients
rl.on('line', (input) => {
    console.log(`User input received: ${input}`);
    processCommand(input);
});