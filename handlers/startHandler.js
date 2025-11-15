const { User } = require('../models');
const { getLanguageKeyboard, getMainMenuKeyboard } = require('../services/keyboards');
const i18n = require('../services/i18n');
const { WELCOME_BONUS } = require('../config');

// Find user by their telegramId (which is the ref code)
async function findUserByReferrerCode(code) {
    if (!code || !code.startsWith('ref_')) return null;
    const telegramId = code.split('_')[1];
    return User.findOne({ where: { telegramId: Number(telegramId) } });
}

const registerUser = async (bot, msg, referrerCode) => {
    const chatId = msg.chat.id;
    const from = msg.from;

    let user = await User.findOne({ where: { telegramId: from.id } });

    if (user) {
        // Existing user
        i18n.setLocale(user.language);
        const text = i18n.__('main_menu_title', from.first_name);
        bot.sendMessage(chatId, text, {
            reply_markup: getMainMenuKeyboard(user)
        });
    } else {
        // New user
        let referrer = null;
        if (referrerCode) {
            referrer = await findUserByReferrerCode(referrerCode);
        }

        user = await User.create({
            telegramId: from.id,
            firstName: from.first_name,
            username: from.username,
            language: from.language_code || 'en',
            referrerId: referrer ? referrer.id : null,
            // --- THIS IS THE FIX ---
            mainBalance: 0,
            bonusBalance: WELCOME_BONUS, // Give the welcome bonus to the new field
            stateContext: { isNewUser: true } // Flag to send message after lang select
            // --- END OF FIX ---
        });
        
        // Ask for language
        i18n.setLocale(user.language);
        bot.sendMessage(chatId, i18n.__('welcome'), {
            reply_markup: getLanguageKeyboard()
        });
    }
};

module.exports = { registerUser };
