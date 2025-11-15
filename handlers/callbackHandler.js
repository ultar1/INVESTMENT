const i18n = require('../services/i18n');
const { User, Transaction } = require('../models');
const { 
    getMainMenuKeyboard, 
    getInvestmentPlansKeyboard, 
    getCancelKeyboard,
    getBackKeyboard,
    getNetworkKeyboard
} = require('../services/keyboards');
const { PLANS, MIN_WITHDRAWAL, MIN_DEPOSIT } = require('../config');

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
            user.walletAddress = user.stateContext.wallet;
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
    
    bot.answerCallbackQuery(callbackQuery.id);
};

module.exports = { handleCallback };
