// "APIs" for partiful
// This isn't the worst idea to hard code some thigns, but I'm going to try to make something more general
// This could match https://platform.openai.com/docs/actions/getting-started better, but maybe this is enough
const partifulApi = [
    {
        name: "Create event",
        description: "Create a new partiful event",
        params: [],
        startUrl: 'https://partiful.com/create',
        commands: [
            {
                type: 'load',
                url: 'https://partiful.com/create'
            }
        ]
    },
    {
        name: 'Login',
        description: 'Log in to partiful',
        params: [
            {
                name: 'phone',
                description: 'The phone number to log in with. A verification code will be sent here.'
            },
            {
                name: 'verificationCode',
                description: 'The verification code sent to the phone'
            }
        ],
        startUrl: 'https://partiful.com/login',
        commands: [
            (phone) => `type ${phone} input[type="tel"]`,
            `click button[type="submit"]`,
            `user`,
            (verificationCode) => `type ${verificationCode} input[name="authCode"]`,
            `click button[type="submit"]`,
            // maybe one more button press
        ]
    },
    {
        name: 'View events',
        description: 'View upcoming events',
        params: [],
        commands: [
            {
                type: 'load',
                url: 'https://partiful.com/events'
            }, 
            {
                type: 'detail',
                selector: `detail NW3wSM > *`
            }
        ]
    }
];

module.exports = {
    partifulApi,
    summaryForLLM: partifulApi.map(x => {
        return JSON.stringify({ name: x.name, description: x.description, params: x.params });
    }).join('\n')
}