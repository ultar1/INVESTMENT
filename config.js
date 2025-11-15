// Load environment variables for local development
require('dotenv').config();

const PLANS = {
    plan_1: { id: 'plan_1', hours: 24, percent: 15, min: 5, max: 1000000 },
    plan_2: { id: 'plan_2', hours: 72, percent: 20, min: 5, max: 1000000 },
    plan_3: { id: 'plan_3', hours: 168, percent: 27, min: 5, max: 1000000 },
    plan_4: { id: 'plan_4', hours: 720, percent: 32, min: 5, max: 1000000 }
};

const REFERRAL_LEVELS = {
    1: 0.07, // 7%
    2: 0.06, // 6%
    3: 0.05  // 5%
};

const MIN_WITHDRAWAL = 10;
const MIN_DEPOSIT = 5;

module.exports = {
    PORT: process.env.PORT || 3000,
    BOT_TOKEN: process.env.BOT_TOKEN,
    DATABASE_URL: process.env.DATABASE_URL,
    NOWPAYMENTS_API_KEY: process.env.NOWPAYMENTS_API_KEY,
    NOWPAYMENTS_IPN_SECRET: process.env.NOWPAYMENTS_IPN_SECRET,
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    BOT_USERNAME: process.env.BOT_USERNAME,
    WEBHOOK_DOMAIN: process.env.WEBHOOK_DOMAIN, // e.g., https://my-bot.onrender.com
    PLANS,
    REFERRAL_LEVELS,
    MIN_WITHDRAWAL,
    MIN_DEPOSIT
};
