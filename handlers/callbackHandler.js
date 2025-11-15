const i18n = require('../services/i18n');
const { sequelize, User, Transaction } = require('../models');
const { 
    getMainMenuKeyboard, 
    getInvestmentPlansKeyboard, 
    getCancelKeyboard,
    getBackKeyboard,
    getNetworkKeyboard
} = require('../services/keyboards');
const { PLANS, MIN_WITHDRAWAL, MIN_DEPOSIT, ADMIN_CHAT_ID } = require('../config');

// Helper to edit message
async function editOrSend(bot, chatId, msgId, text, options) {
    try {
        await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...options });
    } catch (error) {
        // If message is not modified or deleted, send a new one
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
    
    // Note: 'user' here is the person who CLICKED the button.
    // This may be the admin, not the user who owns the transaction.

    if (!user) return bot.answerCallbackQuery(callbackQuery.id);

    // --- NEW: Admin Approval Logic ---
    if (data.startsWith('admin_approve_') || data.startsWith('admin_reject_')) {
        // 1. Check if the clicker is the admin
        if (!ADMIN_CHAT_ID || from.id.toString() !== ADMIN_CHAT_ID) {
            return bot.answerCallbackQuery(callbackQuery.id, "You are not authorized for this action.", true);
        }

        const action = data.split('_')[1];
        const txId = data.split('_')[2];
        
        // 2. Find the transaction and its user
        const tx = await Transaction.findOne({ where: { id: txId }, include: User });
        
        if (!tx) {
            await bot.editMessageText(msg.text + "\n\nError: Transaction not found.", { chat_id: chatId, message_id: msgId });
            return bot.answerCallbackQuery(callbackQuery.id);
        }
        if (tx.status !== 'pending') {
            await bot.editMessageText(msg.text + "\n\nError: This transaction has already been processed.", { chat_id: chatId, message_id: msgId });
            return bot.answerCallbackQuery(callbackQuery.id);
        }
        
        const txUser = tx.User; // The user who made the request
        i18n.setLocale(txUser.language); // Set locale to the *user's* language for notification
        const __ = i18n.__;
        
        const t = await sequelize.transaction();
        try {
            if (action === 'approve') {
                // 3a. Approve Logic
                tx.status = 'completed';
                await tx.save({ transaction: t });
                
                // Now update the user's totalWithdrawn
                txUser.totalWithdrawn += tx.amount;
                await txUser.save({ transaction: t });
                
                await t.commit();

                // Notify admin (by editing the message)
                await bot.editMessageText(msg.text + `\n\n✅ Approved by ${from.first_name}`, {
                    chat_id: chatId, message_id: msgId, reply_markup: null
                });
                
                // Notify user
                await bot.sendMessage(txUser.telegramId, __("withdraw.notify_user_approved", tx.amount));

            } else if (action === 'reject') {
                // 3b. Reject Logic
                tx.status = 'failed';
                await tx.save({ transaction: t });
                
                // Refund the user's balance
                txUser.balance += tx.amount;
                await txUser.save({ transaction: t });

                await t.commit();
                
                // Notify admin
                await bot.editMessageText(msg.text + `\n\n❌ Rejected by ${from.first_name}`, {
                    chat_id: chatId, message_id: msgId, reply_markup: null
                });
                
                // Notify user
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


    // Set locale for the *user clicking*
    // This part is for all other button clicks
    i18n.setLocale(user.language);
    const __ = i18n.__;

    try {
        // --- Language Selection ---
        if (data.startsWith('set_lang_')) {
            user.language = data.split('_')[2];
            await user.save();
            i18n.setLocale(user.language);
            
            await bot.deleteMessage(chatId, msgId);
            await bot.sendMessage(chatId, __("language_set", from.first_name), {
                reply_markup: getMainMenuKeyboard(user)
            });
        }

        // --- Back to Main Menu ---
        else if (data === 'back_to_main') {
            user.state = 'none'; // Clear state on back
            await user.save();
            const text = __("main_menu_title", from.first_name);
            await editOrSend(bot, chatId, msgId, text, { reply_markup: undefined });
        }
        
        // --- Show Investment Plans ---
        else if (data === 'show_invest_plans') {
             const text = __("plans.title") + "\n\n" + __("common.balance", user.balance);
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

            const text = __("plans.details", 
                plan.percent, plan.hours, plan.min, plan.max, __("common.balance", user.balance)
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
            // Send main menu to show keyboard again
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
            if (user.balance < MIN_WITHDRAWAL) {
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
                const text = __("withdraw.ask_amount", 
                    user.walletAddress, user.walletNetwork.toUpperCase(), __("common.balance", user.balance), MIN_WITHDRAWAL
                );
                await editOrSend(bot, chatId, msgId, text, {
                    reply_markup: getCancelKeyboard(user)
                });
            }
        }

        // --- Set Wallet Network (Withdraw Step 2.5) ---
        else if (data.startsWith('set_network_')) {
            const network = data.split('_')[2]; // 'trc20' or 'bep20'
            
            // Get wallet from context
            const wallet = user.stateContext.wallet;
            if(!wallet || user.state !== 'awaiting_wallet_network') {
                // State is incorrect, cancel
                user.state = 'none';
                user.stateContext = {};
                await user.save();
                return bot.answerCallbackQuery(callbackQuery.id, "Error: State expired. Please try again.", true);
            }

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
    
    // Acknowledge all non-admin clicks here
    bot.answerCallbackQuery(callbackQuery.id);
};

module.exports = { handleCallback };
