const i18n = require('../services/i18n');
const { sequelize, User, Transaction, Investment } = require('../models'); // Import Investment
const { 
    getMainMenuKeyboard, 
    getInvestmentPlansKeyboard, 
    getCancelKeyboard,
    getBackKeyboard,
    getWithdrawNetworkKeyboard
} = require('../services/keyboards');
const { PLANS, MIN_WITHDRAWAL, MIN_DEPOSIT, ADMIN_CHAT_ID, WELCOME_BONUS } = require('../config');

// Helper to edit message
async function editOrSend(bot, chatId, msgId, text, options) {
    try {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...options });
    } catch (error) {
        await bot.sendMessage(chatId, text, options);
    }
}

const handleCallback = async (bot, callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const msgId = msg.message_id;
    const data = callbackQuery.data;
    const from = callbackQuery.from;

    const user = await User.findOne({ where: { telegramId: from.id } });
    
    if (!user) return bot.answerCallbackQuery(callbackQuery.id);

    // --- Admin Approval Logic ---
    if (data.startsWith('admin_approve_') || data.startsWith('admin_reject_')) {
        // (Unchanged)
        if (!ADMIN_CHAT_ID || from.id.toString() !== ADMIN_CHAT_ID) {
            return bot.answerCallbackQuery(callbackQuery.id, "You are not authorized for this action.", true);
        }
        // ... (rest of admin logic is unchanged) ...
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
        i18n.setLocale(txUser.language);
        const __ = i18n.__;
        const t = await sequelize.transaction();
        try {
            if (action === 'approve') {
                tx.status = 'completed';
                await tx.save({ transaction: t });
                txUser.totalWithdrawn += tx.amount;
                await txUser.save({ transaction: t });
                await t.commit();
                await bot.editMessageText(msg.text + `\n\nApproved by ${from.first_name}`, {
                    chat_id: chatId, message_id: msgId, reply_markup: null
                });
                await bot.sendMessage(txUser.telegramId, __("withdraw.notify_user_approved", tx.amount));
            } else if (action === 'reject') {
                tx.status = 'failed';
                await tx.save({ transaction: t });
                txUser.mainBalance += tx.amount; // --- FIX: Refund mainBalance ---
                await txUser.save({ transaction: t });
                await t.commit();
                await bot.editMessageText(msg.text + `\n\nRejected by ${from.first_name}`, {
                    chat_id: chatId, message_id: msgId, reply_markup: null
                });
                await bot.sendMessage(txUser.telegramId, __("withdraw.notify_user_rejected", tx.amount));
            }
        } catch (e) {
            await t.rollback();
            console.error("Admin review processing error:", e);
            bot.answerCallbackQuery(callbackQuery.id, "Database error.", true);
        }
        return bot.answerCallbackQuery(callbackQuery.id, "Action processed.");
    }
    
    // --- End of Admin Logic ---

    i18n.setLocale(user.language);
    const __ = i18n.__;

    try {
        // --- Language Selection ---
        if (data.startsWith('set_lang_')) {
            // (Unchanged)
            user.language = data.split('_')[2];
            await user.save();
            i18n.setLocale(user.language);
            
            await bot.deleteMessage(chatId, msgId);
            await bot.sendMessage(chatId, __("language_set", from.first_name), {
                reply_markup: getMainMenuKeyboard(user)
            });

            if (user.stateContext && user.stateContext.isNewUser) {
                await bot.sendMessage(chatId, __("welcome_bonus_message", WELCOME_BONUS.toFixed(2)));
                user.stateContext = {};
                await user.save();
            }
        }

        // --- Back to Main Menu ---
        else if (data === 'back_to_main') {
            // (Unchanged)
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
             // --- THIS IS THE FIX ---
             // Show mainBalance, not bonusBalance
             const text = __("plans.title") + "\n\n" + __("common.balance", user.mainBalance);
             // --- END OF FIX ---
             await editOrSend(bot, chatId, msgId, text, {
                reply_markup: getInvestmentPlansKeyboard(user)
            });
        }

        // --- Select Investment Plan ---
        else if (data.startsWith('invest_plan_')) {
            // (Unchanged)
            const planId = data.replace('invest_', '');
            const plan = PLANS[planId];
            if (!plan) return bot.answerCallbackQuery(callbackQuery.id, "Invalid plan.");
            user.state = 'awaiting_investment_amount';
            user.stateContext = { planId: plan.id };
            await user.save();
            
            // --- THIS IS THE FIX ---
            // Show mainBalance, not bonusBalance
            const text = __("plans.details", 
                plan.percent, plan.hours, plan.min, plan.max, __("common.balance", user.mainBalance)
            );
            // --- END OF FIX ---
            await editOrSend(bot, chatId, msgId, text, {
                reply_markup: getCancelKeyboard(user)
            });
        }

        // --- Cancel Action ---
        else if (data === 'cancel_action') {
            // (Unchanged)
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
            // (Unchanged)
            user.state = 'awaiting_deposit_amount';
            await user.save();
            await editOrSend(bot, chatId, msgId, __("deposit.ask_amount", MIN_DEPOSIT), { 
                reply_markup: getCancelKeyboard(user) 
            });
        }
        
        // --- Withdraw (Step 1) ---
        else if (data === 'withdraw') {
            
            // --- THIS IS THE FIX: UNLOCK BONUS ---
            // Check if user has a bonus and an active investment
            if (user.bonusBalance > 0) {
                const activeInvestments = await Investment.count({
                    where: { userId: user.id, status: 'running' }
                });

                if (activeInvestments > 0) {
                    const bonus = user.bonusBalance;
                    user.mainBalance += bonus;
                    user.bonusBalance = 0;
                    await user.save();
                    
                    // Notify user their bonus is unlocked
                    await bot.sendMessage(chatId, __("bonus_unlocked", bonus.toFixed(2)));
                }
            }
            // --- END OF FIX ---

            // Check mainBalance for withdrawal
            if (user.mainBalance < MIN_WITHDRAWAL) { 
                return bot.answerCallbackQuery(callbackQuery.id, __("withdraw.min_error", MIN_WITHDRAWAL), true);
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
                // Show mainBalance
                const text = __("withdraw.ask_amount", 
                    user.walletAddress, user.walletNetwork.toUpperCase(), __("common.balance", user.mainBalance), MIN_WITHDRAWAL
                );
                await editOrSend(bot, chatId, msgId, text, {
                    reply_markup: getCancelKeyboard(user)
                });
            }
        }

        // --- Set Withdraw Network (Step 2.5) ---
        else if (data.startsWith('set_network_')) {
            // (Unchanged)
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
            
            const text = __("withdraw.wallet_set_success", user.walletAddress, network.toUpperCase(), MIN_WITHDRAWAL);
            await editOrSend(bot, chatId, msgId, text, {
                reply_markup: getCancelKeyboard(user)
            });
        }
        
        // --- Transaction History ---
        else if (data === 'transactions') {
            // (Unchanged)
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
                text += __("transactions.entry", date, tx.type, tx.amount, tx.status) + "\n";
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
