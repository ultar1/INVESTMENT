/*
=================================================================
== DANGER: SECURITY WARNING ==
=================================================================
This file contains hardcoded secrets (BOT_TOKEN, ADMIN_CHAT_ID).
DO NOT share this file or push it to a public GitHub repository.
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

// --- Investment Plans ---
const PLANS = {
    plan_1: { id: 'plan_1', hours: 24, percent: 15, min: 5, max: 1000000 },
    plan_2: { id: 'plan_2', hours: 72, percent: 20, min: 5, max: 1000000 },
    plan_3: { id: 'plan_3', hours: 168, percent: 27, min: 5, max: 1000000 },
    plan_4: { id: 'plan_4', hours: 720, percent: 32, min: 5, max: 1000000 }
};

// --- Referral Settings ---
const REFERRAL_LEVELS = {
    1: 0.07, // 7%
    2: 0.06, // 6%
    3: 0.05  // 5%
};

// --- Bot Limits ---
const MIN_WITHDRAWAL = 10;
// --- THIS IS THE FIX ---
// Increased from 5 to 6 to avoid the NowPayments minimum amount error.
const MIN_DEPOSIT = 6;
// --- END OF FIX ---

// --- Main Configuration Exports ---
module.exports = {
    PORT: process.env.PORT || 3000,
    
    // --- Bot Secrets (Hardcoded) ---
    BOT_TOKEN: cleanEnvVar("8302539985:AAFPZloZ4mzVQtjw2DduHHyevw0mkpYBnkI"),
    ADMIN_CHAT_ID: 7302005705,

    // --- Database (From Environment) ---
    DATABASE_URL: cleanEnvVar(process.env.DATABASE_URL),

    // --- NowPayments (From Environment) ---
    NOWPAYMENTS_API_KEY: cleanEnvVar(process.env.NOWPAYMENTS_API_KEY),
    NOWPAYMENTS_IPN_SECRET: cleanEnvVar(process.env.NOWPAYMENTS_IPN_SECRET),

    // --- Bot Info (From Environment) ---
    ADMIN_USERNAME: cleanEnvVar(process.env.ADMIN_USERNAME) || "FINTRUST_admin",
    BOT_USERNAME: cleanEnvVar(process.env.BOT_USERNAME) || "Fin_Rus_Bot", // Set your bot's username
    
    // --- Webhook (From Environment) ---
    WEBHOOK_DOMAIN: cleanEnvVar(process.env.WEBHOOK_DOMAIN), 

    // --- App Logic ---
    PLANS,
    REFERRAL_LEVELS,
    MIN_WITHDRAWAL,
    MIN_DEPOSIT // Exporting the new value
};
