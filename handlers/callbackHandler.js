const i18n = require('../services/i18n');
const { sequelize, User, Transaction, Investment } = require('../models');
const { 
    getMainMenuKeyboard, 
    getInvestmentPlansKeyboard, 
    getCancelKeyboard,
    getBackKeyboard,
    getWithdrawNetworkKeyboard
} = require('../services/keyboards');
const { PLANS, MIN_WITHDRAWAL, MIN_DEPOSIT, ADMIN_CHAT_ID, WELCOME_BONUS } = require('../config');

// Safety function to prevent .toFixed crash
const toFixedSafe = (num, digits = 2) => (typeof num === 'number' ? num : 0).toFixed(digits);

// Helper to edit message
async function editOrSend(bot, chatId, msgId, text, options) {
    try {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...options });
    } catch (error) {
        // If message is not modified or deleted, send a new one
        await bot.sendMessage(chatId, text, options);
    }
}

// Accept `user` and `__` (language function) as arguments
const handleCallback = async (bot, callbackQuery, user, __) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const msgId = msg.message_id;
    const data = callbackQuery.data;
    const from = callbackQuery.from;
    
    if (!user) return bot.answerCallbackQuery(callbackQuery.id);

    // --- Admin Approval Logic ---
    if (data.startsWith('admin_approve_') || data.startsWith('admin_reject_')) {
        
        if (!ADMIN_CHAT_ID || from.id.toString() !== ADMIN_CHAT_ID.toString()) {
            return bot.answerCallbackQuery(callbackQuery.id, "You are not authorized for this action.", true);
        }

        const action = data.split('_')[1];
        const txId = data.split('_')[2];
        const tx = await Transaction.findOne({ where: { id: txId }, include: User });
        
        if (!tx) { 
            await bot.editMessageText(msg.text + "\n\nError: Transaction not found.", { chat_id: chatId, message_id: msgId });
            return bot.answerCallbackQuery(callbackQuery.id);
        }
        if (tx.status !== 'pending') { 
            await bot.editMessageText(msg.text + "\n\nError: This transaction has already been processed.", { chat_id: chatId, message_id: msgId });
            return bot.answerCallbackQuery(callbackQuery.id);
        }
        
        const txUser = tx.User;
        // Set locale to the *user's* language before sending notification
        i18n.setLocale(txUser.language);
        const admin__ = i18n.__; // Create a new `__` for the *transaction user*
        
        const t = await sequelize.transaction();
        try {
            if (action === 'approve') {
                tx.status = 'completed';
                await tx.save({ transaction: t });
                txUser.totalWithdrawn = (txUser.totalWithdrawn || 0) + tx.amount;
                await txUser.save({ transaction: t });
                await t.commit();
                await bot.editMessageText(msg.text + `\n\nApproved by ${from.first_name}`, {
                    chat_id: chatId, message_id: msgId, reply_markup: null
                });
                await bot.sendMessage(txUser.telegramId, admin__("withdraw.notify_user_approved", toFixedSafe(tx.amount)));
            } else if (action === 'reject') {
                tx.status = 'failed';
                await tx.save({ transaction: t });
                txUser.mainBalance = (txUser.mainBalance || 0) + tx.amount;
                await txUser.save({ transaction: t });
                await t.commit();
                await bot.editMessageText(msg.text + `\n\nRejected by ${from.first_name}`, {
                    chat_id: chatId, message_id: msgId, reply_markup: null
                });
                await bot.sendMessage(txUser.telegramId, admin__("withdraw.notify_user_rejected", toFixedSafe(tx.amount)));
            }
        } catch (e) {
            await t.rollback();
            console.error("Admin review processing error:", e);
            bot.answerCallbackQuery(callbackQuery.id, "Database error.", true);
        }
        return bot.answerCallbackQuery(callbackQuery.id, "Action processed.");
    }
    
    // --- End of Admin Logic ---

    try {
        // --- Language Selection ---
        if (data.startsWith('set_lang_')) {
            user.language = data.split('_')[2];
            await user.save();
            
            // Re-set locale with the NEW language
            i18n.setLocale(user.language);
            const new__ = i18n.__; // Create a new `__` for the response
            
            await bot.deleteMessage(chatId, msgId);
            await bot.sendMessage(chatId, new__("language_set", new__("language_name"), from.first_name), {
                reply_markup: getMainMenuKeyboard(user)
            });

            if (user.stateContext && user.stateContext.isNewUser) {
                // Read the bonus from the config and format it
                const bonusText = toFixedSafe(WELCOME_BONUS);
                await bot.sendMessage(chatId, new__("welcome_bonus_message", bonusText));
                user.stateContext = {};
                await user.save();
            }
        }

        // --- Back to Main Menu ---
        else if (data === 'back_to_main') {
            user.state = 'none';
            await user.save();
            const text = __("main_menu_title", from.first_name);
            await editOrSend(bot, chatId, msgId, text, { reply_markup: undefined });
            await bot.sendMessage(chatId, __("main_menu_title", from.first_name), {
                reply_markup: getMainMenuKeyboard(user)
            });
        }
        
        // --- Show Investment Plans ---
        else if (data === 'show_invest_plans') {
             const balanceText = toFixedSafe(user.mainBalance);
             const text = __("plans.title") + "\n\n" + __("common.balance", balanceText);
             await editOrSend(bot, chatId, msgId, text, {
                reply_markup: getInvestmentPlansKeyboard(user)
            });
        }

        // --- Select Investment Plan ---
        else if (data.startsWith('invest_plan_')) {
            const planId = data.replace('invest_', '');
            const plan = PLANS[planId];
            if (!plan) return bot.answerCallbackQuery(callbackQuery.id, "Invalid plan.");
            user.state = 'awaiting_investment_amount';
            user.stateContext = { planId: plan.id };
            await user.save();
            
            const balanceText = toFixedSafe(user.mainBalance);
            const text = __("plans.details", 
                plan.percent, 
                plan.hours, 
                plan.min, 
                plan.max, 
                __("common.balance", balanceText)
            );
            await editOrSend(bot, chatId, msgId, text, {
                reply_markup: getCancelKeyboard(user)
            });
        }

        // --- Cancel Action ---
        else if (data === 'cancel_action') {
            user.state = 'none';
            user.stateContext = {};
            await user.save();
            await editOrSend(bot, chatId, msgId, __("action_canceled"), { reply_markup: undefined });
            await bot.sendMessage(chatId, __("main_menu_title", from.first_name), {
                reply_markup: getMainMenuKeyboard(user)
            });
        }

        // --- Deposit (Step 1) ---
        else if (data === 'deposit') {
            user.state = 'awaiting_deposit_amount';
            await user.save();
            await editOrSend(bot, chatId, msgId, __("deposit.ask_amount", MIN_DEPOSIT), { 
                reply_markup: getCancelKeyboard(user) 
            });
        }
        
        // --- Withdraw (Step 1) ---
        else if (data === 'withdraw') {
            
            const bonus = user.bonusBalance || 0;
            if (bonus > 0) {
                const activeInvestments = await Investment.count({
                    where: { userId: user.id, status: 'running' }
                });

                if (activeInvestments > 0) {
                    user.mainBalance = (user.mainBalance || 0) + bonus;
                    user.bonusBalance = 0;
                    await user.save();
                    
                    await bot.sendMessage(chatId, __("bonus_unlocked", toFixedSafe(bonus)));
                }
            }
            
            const mainBalance = user.mainBalance || 0;
            const minWithdrawalText = toFixedSafe(MIN_WITHDRAWAL);
            if (mainBalance < MIN_WITHDRAWAL) { 
                return bot.answerCallbackQuery(callbackQuery.id, __("withdraw.min_error", minWithdrawalText), true);
            }

            if (!user.walletAddress) {
                user.state = 'awaiting_wallet_address';
                await user.save();
                await editOrSend(bot, chatId, msgId, __("withdraw.ask_wallet"), {
                    reply_markup: getCancelKeyboard(user)
                });
            } else {
                user.state = 'awaiting_withdrawal_amount';
                await user.save();
                const balanceText = toFixedSafe(user.mainBalance);
                const networkText = user.walletNetwork ? user.walletNetwork.toUpperCase() : "N/A";
                const text = __("withdraw.ask_amount", 
                    user.walletAddress, 
                    networkText, 
                    __("common.balance", balanceText),
                    minWithdrawalText
                );
                await editOrSend(bot, chatId, msgId, text, {
                    reply_markup: getCancelKeyboard(user)
                });
            }
        }

        // --- Set Withdraw Network (Step 2.5) ---
        else if (data.startsWith('set_network_')) {
            if (user.state !== 'awaiting_wallet_network') {
                 return bot.answerCallbackQuery(callbackQuery.id, "This request has expired.", true);
            }
            const network = data.split('_')[2];
            const wallet = user.stateContext.wallet;
            
            user.walletAddress = wallet;
            user.walletNetwork = network;
            user.state = 'awaiting_withdrawal_amount';
            user.stateContext = {};
            await user.save();
            
            const minWithdrawalText = toFixedSafe(MIN_WITHDRAWAL);
            const text = __("withdraw.wallet_set_success", user.walletAddress, network.toUpperCase(), minWithdrawalText);
            await editOrSend(bot, chatId, msgId, text, {
                reply_markup: getCancelKeyboard(user)
            });
        }
        
        // --- Transaction History ---
        else if (data === 'transactions') {
            const txs = await Transaction.findAll({ 
                where: { userId: user.id }, 
                order: [['createdAt', 'DESC']], 
                limit: 10 
            });
            if (txs.length === 0) {
                return editOrSend(bot, chatId, msgId, __("transactions.no_transactions"), {
                    reply_markup: getBackKeyboard(user, "back_to_main")
                });
            }
            let text = __("transactions.title") + "\n\n";
            txs.forEach(tx => {
                const date = tx.createdAt.toLocaleDateString('en-GB');
                text += __("transactions.entry", date, tx.type, toFixedSafe(tx.amount), tx.status) + "\n";
            });
            await editOrSend(bot, chatId, msgId, text, {
                reply_markup: getBackKeyboard(user, "back_to_main")
            });
        }

    } catch (error) {
        console.error("Callback handler error:", error);
        bot.answerCallbackQuery(callbackQuery.id, __("error_generic"), true);
    }
    
    bot.answerCallbackQuery(callbackQuery.id);
};

module.exports = { handleCallback };
