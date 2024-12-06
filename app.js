const readline = require('readline');
require('dotenv').config();
const OpenAI = require('openai');

const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');

const { partifulApi, summaryForLLM } = require('./partiful');

const {generalApi, summary} = require('./general');
const { parse } = require('path');

const { initializeServer, sendCommand } = require('./utils/webutils')
const {exec, spawn} = require('child_process');

const client = new OpenAI();
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
const command = `/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --load-extension="./chrome_ext"`;
// ok maybe i need a bash
//const command = `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`;
const args = ['--remote-debugging-port=43'];
// because we need to relaunch, we should probably close all other chrome tabs

//exec(command, (error, stdout, stderr) => {
//const chromeProcess = spawn(command, args, { detached: true, /*stdio: 'ignore'*/ });

//chromeProcess.unref(); // Detach the process

// Don't worry about async, there's no way this takes longer to run compared to typing in a prompt + hitting enter
console.log('executing command');
// this never really ends, so chrome never closes
exec(command, (error, stdout, stderr) => {

    console.log('callback called');
    if (error) {
        console.error(`Error: ${error.message}`);
        return;
    }
    if (stderr) {
        console.error(`Stderr: ${stderr}`);
        return;
    }
    console.log(`Stdout: ${stdout}`);
});

const cdpOpts = { port: 9222, host: "0.0.0.0" }
const scopeUrl = "chrome-extension://jopnjjlijghkbopccilgaglodjaiohlm/"; // replace with your own extension id which can be seen in the extension tab 
setTimeout(_ => {
    (async () => {
        console.log('connecting to chrome');
        const debugClient = await CDP(cdpOpts);
        console.log('client connected');
        //const { Runtime, Page } = debugClient;
        // Enable Runtime to execute script
        //await Runtime.enable();
        //console.log('runtime enabled');
        //const checkExtensionsScript = `
            //new Promise((resolve) => {
                //chrome.management.getAll((extensions) => {
                    //resolve(extensions.map(ext => ext.id));
                //});
            ////});
        //`;
        //const extensionsResponse = await Runtime.evaluate({
            //expression: checkExtensionsScript,
            //awaitPromise: true,
        //});

        //const installedExtensions = extensionsResponse.result.value;
        //console.log('Installed Extensions:', installedExtensions);
        //exit(-1);


        // if this works we should probably only call this right before a command
        // it does work
        setInterval(async _ => {
            console.log('waking up worker')
            await debugClient.send("ServiceWorker.enable")
            await debugClient.send("ServiceWorker.startWorker", { scopeURL: scopeUrl })

        }, 29000 )

    })()
}, 5000);
// Execute the command
//});


initializeServer();

// Setting up user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ApiRecommendation = z.object({
    apiName: z.string().describe("The name of the API")
});

// some of the constants should be moved to a constants file located in chrome ext, because they are shared
const BrowserAction = z.object({
    type: z.enum(['click', 'keyboard']).describe("The action that will be taken"),
    selector: z.string().describe("A CSS selector that the action will be ran on, this will be passed to document.querySelector()"),
    value: z.string().describe("The value that will be typed into input or textarea divs")
});

const ActionRecommendation = z.object({
    actions: z.array(BrowserAction).describe("A sequence of actions that will be ran in the browser"),
    additionalParamUserMessage: z.string().describe("A string to be the shown to the user to request additional parameters")
})

const KeyboardAction = z.object({
    //type: z.enum(['keyboard']).describe("The action that will be taken"),
    value: z.string().describe("The value that will be typed into input or textarea divs"),
    selector: z.string().describe("A CSS selector that the action will be ran on, this will be passed to document.querySelector()"),
});

const ClickAction = z.object({
    //type: z.enum(['click']).describe("The action that will be taken"),
    selector: z.string().describe("A CSS selector will be clicked, this will be passed to document.querySelector()"),
});

const LoadAction = z.object({
    type: z.enum(['load']).describe("The action that will be taken"),
    url: z.string().describe("The url that will be loaded")
});

const UrlAction = z.object({
    url: z.string().describe("The url that will be loaded")
});

const GoogleAction = z.object({
    query: z.string().describe("The query that will be searched on Google")
});

const InitialAction = z.object({
    type: z.enum(['urlload', 'googlesearch']).describe("The action that will be taken"),
    action: z.union([UrlAction, GoogleAction]).describe("The first action that will be ran in the browser"),
});

const GeneralActions = z.object({
    actions: z.array(z.union([KeyboardAction, ClickAction, LoadAction])).describe("A sequence of actions that will be ran in the browser"),
    //type: z.enum(['load', 'click', 'keyboard']).describe("The action that will be taken"),
    //selector: z.string().describe("A CSS selector that the action will be ran on, this will be passed to document.querySelector()"),
    //value: z.string().describe("The value that will be typed into input or textarea divs")
})

const orchestrateApi = async (apiName, input) => {
    const api = partifulApi.find(x => x.name === apiName);
    if (!api) {
        console.log('Recommended API does not exist in predefined APIs');
        return;
    }


    // Ok so I've now realized that it's going to be very difficult to hardcode every class and id of the buttons we need to hi
    // So here's what I propose
    // Load the page
    // Get the DOM summary and send it back to the LLM
    // Go from there

    // This loads the page
    await sendCommand({ type: 'load', url: api.startUrl });

    let domSummary = await sendCommand({ type: 'get-summary' })
    console.log(domSummary.result.url)

    const prompt = `Given a summary of a website ${JSON.stringify(domSummary)}, parameter information ${JSON.stringify(context)}, and the user request ${input}, come up with a list of actions to proceed with fulfilling the request. You can click on divs, as well as input text to divs. If you need more information from the user to complete the actions on the page, fill in a message to the user asking for additional parameters`
    //console.log(prompt)

    const completion = await client.beta.chat.completions.parse({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'You are a helpful assistant. Only use the schema for responses.' },
            { role: 'user', content: prompt }
        ],
        response_format: zodResponseFormat(ActionRecommendation, 'actionRecommendation')
    });

    const message = completion.choices[0]?.message;
    if (message?.parsed) {
        const obj = message.parsed;
        console.log(`4o-mini suggests ${JSON.stringify(obj)}`);

    } else {
        console.log(message.refusal);
    }

    /*
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
    */

    /*const prompt = `Given the user request "${input}" and the info available after calling and API:\n${last}, answer the request in detail, even if it's just a confirmation of completing the request`;

    const completion = await client.beta.chat.completions.parse({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: prompt }
        ],
        //response_format: zodResponseFormat(ApiRecommendation, 'apiRecommendation')

    });
    const message = completion.choices[0]?.message;
    console.log(message);*/
}

const buildInitialPrompt = () => {
    return `Work step-by-step to fulfill the user request "${context.topLevelCommand}". The first step is to determine which URL to load to start fulfillilng the request. Return the first url necessary to navigate to fulfill the users request. If you're not sure, you can start with a Google search, in which case provide a query to search for.`;
}


const processCommand = async input => {

    // Step 1 get command
    context.topLevelCommand = input;

    // Step 2 build initial prompt (just load page)
    const prompt = buildInitialPrompt();

    // step 3 send it to LLM 
    const completion = await client.beta.chat.completions.parse({
        model: 'gpt-4o-mini',
        // should we save these in context?
        messages: [
            { role: 'system', content: 'You are a helpful assistant. Only use the schema for responses.' },
            { role: 'user', content: prompt }
        ],
        response_format: zodResponseFormat(InitialAction, 'initialAction')

    });

    // step 4 get structured response back
    const message = completion.choices[0]?.message;
    console.log(message.parsed)
    if (message?.parsed) {
        const { type } = message.parsed;
        if (type === 'googlesearch') {
            // TODO implement new action in the ext
        } else if (type === 'urlload') {
            console.log(message.parsed)
            const url = message.parsed.action.url;
            loadInitialPage(url);
        }
    }

    /*

    if (message?.parsed) {
        console.log(message);
        console.log(message.parsed);
        const recommendation = message.parsed.actions[0].type;
        console.log(`4o-mini suggests ${recommendation}`);

        singleCommand(message.parsed.actions[0])

        //orchestrateApi(recommendation, input);
    } else {
        console.log(message.refusal);
    }*/

}

const CompletionAction = z.object({
    message: z.string().describe("A string to display to the user after the request is fulfilled, answering the question or a successful status.")
});

const UserAction = z.object({
    interactMessage: z.string().describe("A string to display to the user when the website requires human interaction.")
})

const NextAction = z.object({
    done: z.boolean().describe("A boolean indicating if the request has been fulfilled"),
    type: z.enum(['complete', 'urlload', 'googlesearch', 'click', 'keyboard', 'user']).describe("The action that will be taken"),
    action: z.union([CompletionAction, UrlAction, GoogleAction, ClickAction, KeyboardAction, UserAction]).describe("The next action that will be ran in the browser, or a confirmation of completion"),
});

const loadInitialPage = async url => {
    // Step 5
    let domSummary = await sendCommand({ type: 'load', url: url });
    // Step 11 get dom summary back in the server
    console.log(JSON.stringify(domSummary))

    // Step 12 build next prompot
    //const prompt = `Given the browser summary after loading url "${url}": "${JSON.stringify(domSummary)}" and the user request "${context.topLevelCommand}", answer the request in detail, even if it's just a confirmation of completing the request`;
    const prompt = `Given a summary of a website ${JSON.stringify(domSummary)}, context information ${JSON.stringify(context)}, and the user request ${context.topLevelCommand}, come up with the next action to proceed with fulfilling the request, if necessary. You can click on divs, input text to divs, and load urls. If you need more information from the user to complete the actions on the page, fill in a message to the user asking for additional parameters. If you think the request has been fulfilled, then come up with a success message.`

    // Step 13 send results + command back to GPT to determine if complete


    const completion = await client.beta.chat.completions.parse({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: 'You are a helpful assistant. Only use the schema for responses.' },
            { role: 'user', content: prompt }
        ],
        response_format: zodResponseFormat(NextAction, 'nextAction')

    });

    // Step 14 get response back

    if (true) {
        // Step 15a: you're done
        const message = completion.choices[0]?.message;
        console.log(JSON.stringify(message));

        // clear context
        delete context.topLevelCommand;
        return;
    }





    // await sendCommand({ type: 'get-summary' })
    exit(-1);

}

const singleCommand = async cmd => {
    await sendCommand(cmd)

}

// Listen for user input and send a message to all connected clients
rl.on('line', (input) => {
    console.log(`User input received: ${input}`);
    processCommand(input);
});