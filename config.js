/*
=================================================================
== DANGER: SECURITY WARNING ==
=================================================================
This file should not contain any secrets.
Load all secrets from .env
=================================================================
*/

require('dotenv').config();

// --- Helper function to clean variables ---
function cleanEnvVar(variable) {
    if (typeof variable !== 'string') {
        return variable;
    }
    return variable.trim().replace(/^,|,$/g, '');
}

// --- Welcome Bonus (UPDATED) ---
const WELCOME_BONUS = 2;

// --- Investment Plans ---
const PLANS = {
    plan_1: { id: 'plan_1', hours: 24, percent: 5, min: 5, max: 50 },
    plan_2: { id: 'plan_2', hours: 72, percent: 15, min: 10, max: 200 },
    plan_3: { id: 'plan_3', hours: 168, percent: 20, min: 10, max: 1000 },
    plan_4: { id: 'plan_4', hours: 720, percent: 30, min: 10, max: 10000 }
};

// --- Referral Settings ---
const REFERRAL_LEVELS = {
    1: 0.07, // 7%
    2: 0.06, // 6%
    3: 0.05  // 5%
};

// --- Bot Limits ---
const MIN_WITHDRAWAL = 10;
const MIN_DEPOSIT = 10;

// --- Main Configuration Exports ---
module.exports = {
    PORT: process.env.PORT || 3000,
    
    // --- Bot Secrets (Loaded from .env file) ---
    // --- DO NOT PASTE YOUR TOKEN HERE ---
    BOT_TOKEN: cleanEnvVar(process.env.BOT_TOKEN),
    ADMIN_CHAT_ID: cleanEnvVar(process.env.ADMIN_CHAT_ID),

    // --- Database (From Environment) ---
    DATABASE_URL: cleanEnvVar(process.env.DATABASE_URL),

    // --- FIX: Your Manual Deposit Wallet ---
    ADMIN_DEPOSIT_WALLET: "0x36decaeaf371555837968b9196f323b5708c4b32",

    // --- NowPayments (REMOVED, NO LONGER NEEDED) ---
    // NOWPAYMENTS_API_KEY: cleanEnvVar(process.env.NOWPAYMENTS_API_KEY),
    // NOWPAYMENTS_IPN_SECRET: cleanEnvVar(process.env.NOWPAYMENTS_IPN_SECRET),

    // --- Bot Info (From Environment) ---
    ADMIN_USERNAME: cleanEnvVar(process.env.ADMIN_USERNAME) || "FINTRUST_admin",
    BOT_USERNAME: cleanEnvVar(process.env.BOT_USERNAME) || "Fin_Rus_Bot",
    
    // --- Webhook (From Environment) ---
    WEBHOOK_DOMAIN: cleanEnvVar(process.env.WEBHOOK_DOMAIN), 

    // --- App Logic ---
    PLANS,
    REFERRAL_LEVELS,
    MIN_WITHDRAWAL,
    MIN_DEPOSIT,
    WELCOME_BONUS // Export the new bonus
};
