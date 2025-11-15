const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const { sequelize } = require('./models');
const { PORT, BOT_TOKEN, WEBHOOK_DOMAIN } = require('./config');
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
// Set Webhook for the bot (Render requires this for web services)
const botWebhookUrl = `${WEBHOOK_DOMAIN}/bot${BOT_TOKEN}`;
bot.setWebHook(botWebhookUrl);
console.log(`Bot webhook set to: ${botWebhookUrl}`);

// --- Initialize Express Server ---
const app = express();
app.use(bodyParser.json());

// --- Bot Webhook Endpoint ---
// Receives updates from Telegram
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// --- NowPayments IPN Webhook Endpoint ---
// Receives payment notifications
app.post('/payment-ipn', async (req, res) => {
    await handleNowPaymentsIPN(req, res);
});

// --- Health Check Endpoint ---
// For Render to check if the service is alive
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// --- Bot Listeners (Attached to the 'bot' instance) ---

// 1. /start command
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
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
    try {
        await handleCallback(bot, callbackQuery);
    } catch (error) {
        console.error('Error handling callback:', error);
    }
});

// 3. Text Messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (msg.text && msg.text.startsWith('/')) return; // Ignore commands

    try {
        const user = await User.findOne({ where: { telegramId: msg.from.id } });
        if (!user) {
            return bot.sendMessage(chatId, "Please start the bot by sending /start");
        }
        
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
        
        // Sync models (creates tables if they don't exist)
        // Use { force: true } in dev to drop tables, { alter: true } to migrate
        await sequelize.sync({ alter: true }); 
        console.log('All models were synchronized successfully.');
        
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }
});
