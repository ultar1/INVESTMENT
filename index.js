const express = require('express');
const bodyParser = require('body-parser'); // <-- THIS IS THE FIX
const TelegramBot = require('node-telegram-bot-api');
const { sequelize } = require('./models');
const { PORT, BOT_TOKEN, WEBHOOK_DOMAIN, ADMIN_CHAT_ID } = require('./config');
const i18n = require('./services/i18n');
const { registerUser } = require('./handlers/startHandler');
const { handleMessage } = require('./handlers/messageHandler');
const { handleCallback } = require('./handlers/callbackHandler');
const { handleTextInput } = require('./handlers/textHandler');
const { handleNowPaymentsIPN } = require('./handlers/paymentHandler');
const { User } = require('./models');

// --- Error Checking ---
if (!BOT_TOKEN) {
    console.error("BOT_TOKEN is missing!");
    process.exit(1);
}
if (!WEBHOOK_DOMAIN) {
    console.error("WEBHOOK_DOMAIN is missing! This is needed for the bot webhook.");
}

// --- Initialize Bot ---
const bot = new TelegramBot(BOT_TOKEN);

// Set Webhook for the bot
if (WEBHOOK_DOMAIN) {
    const botWebhookUrl = `${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`;
    bot.setWebHook(botWebhookUrl);
    console.log(`Bot webhook set to: ${botWebhookUrl}`);
} else {
    console.error("Could not set bot webhook because WEBHOOK_DOMAIN is empty.");
}

// --- Initialize Express Server ---
const app = express();
app.use(bodyParser.json()); // This line will now work

// --- Bot Webhook Endpoint ---
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// --- NowPayments IPN Webhook Endpoint ---
app.post('/payment-ipn', async (req, res) => {
    await handleNowPaymentsIPN(req, res);
});

// --- Health Check Endpoint ---
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// --- Helper function for Admin Notifications ---
async function notifyAdminOfActivity(bot, from, action) {
    if (!ADMIN_CHAT_ID) return; 

    const sanitize = (text) => {
        if (!text) return 'N/A';
        return text.toString().replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    const time = new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC' });
    const name = sanitize(from.first_name);
    const username = from.username ? `@${from.username}` : 'N/A';
    const actionText = sanitize(action) || 'Interaction';

    const message = [
        `<b>User Online:</b>`,
        `<b>ID:</b> <code>${from.id}</code>`,
        `<b>Name:</b> ${name}`,
        `<b>Username:</b> ${username}`,
        `<b>Last Action:</b> ${actionText}`,
        `<b>Time:</b> ${time} (UTC)`
    ].join('\n');

    try {
        bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('Failed to send admin notification:', error.message);
    }
}

// --- Bot Listeners (Attached to the 'bot' instance) ---

// 1. /start command
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    notifyAdminOfActivity(bot, msg.from, msg.text);
    
    const referrerCode = match ? match[1] : null;
    try {
        await registerUser(bot, msg, referrerCode);
    } catch (error) {
        console.error('Error handling /start:', error);
        bot.sendMessage(chatId, "An error occurred. Please try again later.");
    }
});

// 2. Callback Queries (Button Clicks)
bot.on('callback_query', async (callbackQuery) => {
    notifyAdminOfActivity(bot, callbackQuery.from, `Button: ${callbackQuery.data}`);
    
    try {
        await handleCallback(bot, callbackQuery);
    } catch (error) {
        console.error('Error handling callback:', error);
    }
});

// 3. Text Messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (msg.text && msg.text.startsWith('/')) return; 

    try {
        const user = await User.findOne({ where: { telegramId: msg.from.id } });
        if (!user) {
            return bot.sendMessage(chatId, "Please start the bot by sending /start");
        }
        
        notifyAdminOfActivity(bot, msg.from, msg.text);
        
        i18n.setLocale(user.language);

        if (user.state !== 'none' && msg.text) {
            await handleTextInput(bot, msg, user);
        } else if (msg.text) {
            await handleMessage(bot, msg, user);
        }
    } catch (error) {
        console.error('Error handling message:', error);
        bot.sendMessage(chatId, i18n.__('error_generic'));
    }
});

// --- Start Server and Database ---
app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    try {
        await sequelize.authenticate();
        console.log('PostgreSQL connected successfully.');
        
        await sequelize.sync({ alter: true }); 
        console.log('All models were synchronized successfully.');
        
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }
});

// --- Keep-Alive Pinger ---
const PING_INTERVAL_MS = 14 * 60 * 1000;
if (WEBHOOK_DOMAIN) {
    setInterval(async () => {
        try {
            const response = await fetch(`${WEBHOOK_DOMAIN}/health`);
            if (!response.ok) {
                throw new Error(`Ping failed with status: ${response.status}`);
            }
            console.log(`Keep-alive ping to ${WEBHOOK_DOMAIN}/health sent. Status: ${response.status}`);
        } catch (error) {
            console.error('Keep-alive ping error:', error.message);
        }
    }, PING_INTERVAL_MS);
} else {
    console.warn('WEBHOOK_DOMAIN not set. Keep-alive pinger is disabled.');
}
