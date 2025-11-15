const i18n = require('../services/i18n');
const { sequelize, User, Transaction } = require('../models');
const { 
    getMainMenuKeyboard, 
    getInvestmentPlansKeyboard, 
    getCancelKeyboard,
    getBackKeyboard,
    getWithdrawNetworkKeyboard, // Renamed
    // getDepositNetworkKeyboard // Not needed here
} = require('../services/keyboards');
const { PLANS, MIN_WITHDRAWAL, MIN_DEPOSIT, ADMIN_CHAT_ID } = require('../config');
const { generateDepositInvoice } = require('../handlers/paymentHandler');

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
    
    if (!user) return bot.answerCallbackQuery(callbackQuery.id);

    // --- Admin Approval Logic ---
    if (data.startsWith('admin_approve_') || data.startsWith('admin_reject_')) {
        // (This whole block is unchanged from the previous version)
        if (!ADMIN_CHAT_ID || from.id.toString() !== ADMIN_CHAT_ID) {
            return bot.answerCallbackQuery(callbackQuery.id, "You are not authorized for this action.", true);
        }
        const action = data.split('_')[1];
        const txId = data.split('_')[2];
        const tx = await Transaction.findOne({ where: { id: txId }, include: User });
        if (!tx) { /* ... */ }
        if (tx.status !== 'pending') { /* ... */ }
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
                await bot.editMessageText(msg.text + `\n\n✅ Approved by ${from.first_name}`, {
                    chat_id: chatId, message_id: msgId, reply_markup: null
                });
                await bot.sendMessage(txUser.telegramId, __("withdraw.notify_user_approved", tx.amount));
            } else if (action === 'reject') {
                tx.status = 'failed';
                await tx.save({ transaction: t });
                txUser.balance += tx.amount;
                await txUser.save({ transaction: t });
                await t.commit();
                await bot.editMessageText(msg.text + `\n\n❌ Rejected by ${from.first_name}`, {
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

    // Set locale for the *user clicking*
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
             // (Unchanged)
             const text = __("plans.title") + "\n\n" + __("common.balance", user.balance);
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
            const text = __("plans.details", 
                plan.percent, plan.hours, plan.min, plan.max, __("common.balance", user.balance)
            );
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
        
        // --- NEW: Deposit (Step 2) - Select Network ---
        else if (data.startsWith('deposit_network_')) {
            if (user.state !== 'awaiting_deposit_network') {
                 return bot.answerCallbackQuery(callbackQuery.id, "This request has expired.", true);
            }
            
            const network = data.split('_')[2]; // 'trc20' or 'bep20'
            const amount = user.stateContext.amount; // Get amount from context

            const invoice = await generateDepositInvoice(user, amount, network);
            
            if (invoice) {
                await Transaction.create({
                    user: user.id,
                    type: 'deposit',
                    amount: invoice.price_amount, // The amount in USD
                    status: 'pending',
                    txId: invoice.payment_id
                });
                
                user.state = 'none';
                user.stateContext = {};
                await user.save();

                const text = __("deposit.invoice_created", invoice.pay_amount, network.toUpperCase(), invoice.pay_address);
                await editOrSend(bot, chatId, msgId, text, { parse_mode: 'Markdown' });
            } else {
                await editOrSend(bot, chatId, msgId, __("deposit.api_error"), {
                    reply_markup: getBackKeyboard(user, "back_to_main")
                });
            }
        }
        
        // --- Withdraw (Step 1) ---
        else if (data === 'withdraw') {
            // (Unchanged)
            if (user.balance < MIN_WITHDRAWAL) { /* ... */ }
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
            if (txs.length === 0) { /* ... */ }
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
