const i18n = require('../services/i18n');
const { sequelize, User, Investment, Transaction } = require('../models');
const { 
    getMainMenuKeyboard, 
    getCancelKeyboard, 
    getWithdrawNetworkKeyboard, 
    getAdminReviewKeyboard 
} = require('../services/keyboards');
const { PLANS, MIN_WITHDRAWAL, MIN_DEPOSIT, ADMIN_CHAT_ID, WELCOME_BONUS } = require('../config');
const { handleReferralBonus } = require('./investmentHandler');
const { generateDepositInvoice } = require('./paymentHandler');

// Safety function to prevent .toFixed crash
const toFixedSafe = (num, digits = 2) => (typeof num === 'number' ? num : 0).toFixed(digits);

// Basic wallet validation
function isValidWallet(address) {
    return (address.startsWith('T') && address.length > 30) || (address.startsWith('0x') && address.length === 42);
}

// Accept `__` (language function) as an argument
const handleTextInput = async (bot, msg, user, __) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    try {
        // --- 1. Awaiting Investment Amount ---
        if (user.state === 'awaiting_investment_amount') {
            const amount = parseFloat(text);
            const plan = PLANS[user.stateContext.planId];
            if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, __("plans.err_invalid_amount"), { reply_markup: getCancelKeyboard(user) });
            if (amount < plan.min) return bot.sendMessage(chatId, __("plans.err_min_amount", plan.min), { reply_markup: getCancelKeyboard(user) });
            if (amount > plan.max) return bot.sendMessage(chatId, __("plans.err_max_amount", plan.max), { reply_markup: getCancelKeyboard(user) });
            
            const mainBalance = user.mainBalance || 0;
            if (amount > mainBalance) {
                return bot.sendMessage(chatId, __("plans.err_insufficient_funds", toFixedSafe(mainBalance)), { reply_markup: getCancelKeyboard(user) });
            }

            const t = await sequelize.transaction();
            try {
                await Investment.create({
                    userId: user.id,
                    planId: plan.id,
                    amount: amount,
                    profitPercent: plan.percent,
                    profitAmount: amount * (plan.percent / 100),
                    maturesAt: new Date(Date.now() + plan.hours * 60 * 60 * 1000)
                }, { transaction: t });
                user.mainBalance = mainBalance - amount;
                user.totalInvested = (user.totalInvested || 0) + amount;
                user.state = 'none';
                user.stateContext = {};
                await user.save({ transaction: t });
                await t.commit();
                
                // --- FIX: Pass the `__` function to the handler ---
                // (It's okay if this handler doesn't use it, but good practice)
                handleReferralBonus(user.referrerId, amount, user.id, __); 
                // --- END OF FIX ---
                
                const planName = __(`plans.plan_${plan.id.split('_')[1]}_button`);
                await bot.sendMessage(chatId, __("plans.invest_success", toFixedSafe(amount), planName, plan.hours));
            } catch (error) {
                await t.rollback();
                throw error; 
            }
        }
        
        // --- 2. Awaiting Deposit Amount ---
        else if (user.state === 'awaiting_deposit_amount') {
            const amount = parseFloat(text);
            if (isNaN(amount) || amount < MIN_DEPOSIT) {
                return bot.sendMessage(chatId, __("deposit.min_error", MIN_DEPOSIT), { reply_markup: getCancelKeyboard(user) });
            }
            
            const invoice = await generateDepositInvoice(user, amount);
            
            if (invoice && invoice.invoice_url) {
                
                // --- FIX: Use `amount` (from user) not `invoice.price_amount` (from API) ---
                // This ensures the amount is what the user typed.
                await Transaction.create({
                    user: user.id,
                    type: 'deposit',
                    amount: amount, // Use the user's typed amount
                    status: 'pending',
                    txId: invoice.order_id
                });
                
                user.state = 'none';
                await user.save();

                // --- FIX: Use `amount` (from user) not `invoice.price_amount` (from API) ---
                const text = __("deposit.invoice_created", toFixedSafe(amount));
                // --- END OF FIX ---

                await bot.sendMessage(chatId, text, { 
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: __("deposit.pay_button"), url: invoice.invoice_url }],
                            [{ text: __("common.cancel"), callback_data: "cancel_action" }]
                        ]
                    }
                });
                return;
            } else {
                await bot.sendMessage(chatId, __("deposit.api_error"));
            }
        }

        // --- 3. Awaiting Wallet Address ---
        else if (user.state === 'awaiting_wallet_address') {
            if (!isValidWallet(text)) {
                return bot.sendMessage(chatId, __("withdraw.invalid_wallet"), { reply_markup: getCancelKeyboard(user) });
            }
            user.state = 'awaiting_wallet_network';
            user.stateContext = { wallet: text };
            await user.save();
            await bot.sendMessage(chatId, __("withdraw.ask_network"), {
                reply_markup: getWithdrawNetworkKeyboard(user)
            });
            return;
        }
        
        // --- 4. Awaiting Withdrawal Amount ---
        else if (user.state === 'awaiting_withdrawal_amount') {
            
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

            const amount = parseFloat(text);
            const mainBalance = user.mainBalance || 0;
            const minWithdrawalText = toFixedSafe(MIN_WITHDRAWAL);

            if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, __("plans.err_invalid_amount"), { reply_markup: getCancelKeyboard(user) });
            if (amount < MIN_WITHDRAWAL) return bot.sendMessage(chatId, __("withdraw.min_error", minWithdrawalText), { reply_markup: getCancelKeyboard(user) });
            if (amount > mainBalance) {
                return bot.sendMessage(chatId, __("withdraw.insufficient_funds", toFixedSafe(mainBalance)), { reply_markup: getCancelKeyboard(user) });
            }
            
            const t = await sequelize.transaction();
            let newTx;
            try {
                user.mainBalance = mainBalance - amount;
                user.state = 'none';
                await user.save({ transaction: t });
                newTx = await Transaction.create({
                    user: user.id,
                    type: 'withdrawal',
                    amount: amount,
                    status: 'pending',
                    walletAddress: user.walletAddress
                }, { transaction: t });
                await t.commit();
            } catch (error) {
                await t.rollback(); 
                console.error("Withdrawal creation error:", error);
                return bot.sendMessage(chatId, __('error_generic'));
            }

            await bot.sendMessage(chatId, __("withdraw.request_success", toFixedSafe(amount)));

            if (ADMIN_CHAT_ID) {
                try {
                    // We must use the admin's locale (default 'en') for this message
                    i18n.setLocale('en');
                    const admin__ = i18n.__;
                    const notifyText = admin__("withdraw.notify_admin", 
                        user.firstName || 'N/A', 
                        user.telegramId, 
                        toFixedSafe(amount), 
                        user.walletAddress, 
                        user.walletNetwork.toUpperCase(),
                        newTx.id
                    );
                    const adminKeyboard = getAdminReviewKeyboard(newTx.id, admin__);
                    await bot.sendMessage(ADMIN_CHAT_ID, notifyText, {
                        reply_markup: adminKeyboard
                    });
                } catch (adminError) {
                    console.error("Failed to notify admin:", adminError.message);
                }
            } else {
                console.warn("ADMIN_CHAT_ID is not set. Cannot notify admin for withdrawal.");
            }
        }

    } catch (error) {
        console.error("Text input handler error:", error);
        user.state = 'none';
        await user.save();
        await bot.sendMessage(chatId, __('error_generic'));
    }
    
    // Send main menu if state was reset
    if (user.state === 'none') {
        
        // --- FIX: Pass `__` to getMainMenuKeyboard ---
        // And use `msg.from.first_name` instead of `from.first_name`
        await bot.sendMessage(chatId, __("main_menu_title", msg.from.first_name), {
            reply_markup: getMainMenuKeyboard(user, __)
        });
        // --- END OF FIX ---
    }
};

module.exports = { handleTextInput };
