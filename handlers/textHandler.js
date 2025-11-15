const i18n = require('../services/i18n');
const { sequelize, User, Investment, Transaction } = require('../models');
const { getMainMenuKeyboard, getCancelKeyboard, getNetworkKeyboard } = require('../services/keyboards');
const { PLANS, MIN_WITHDRAWAL, MIN_DEPOSIT } = require('../config');
const { handleReferralBonus } = require('./investmentHandler');
const { generateDepositInvoice, requestWithdrawal } = require('./paymentHandler');

// Basic wallet validation
function isValidWallet(address) {
    return (address.startsWith('T') && address.length > 30) || (address.startsWith('0x') && address.length === 42);
}

const handleTextInput = async (bot, msg, user) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const __ = i18n.__;

    try {
        // --- 1. Awaiting Investment Amount ---
        if (user.state === 'awaiting_investment_amount') {
            const amount = parseFloat(text);
            const plan = PLANS[user.stateContext.planId];

            if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, __("plans.err_invalid_amount"), { reply_markup: getCancelKeyboard(user) });
            if (amount < plan.min) return bot.sendMessage(chatId, __("plans.err_min_amount", plan.min), { reply_markup: getCancelKeyboard(user) });
            if (amount > plan.max) return bot.sendMessage(chatId, __("plans.err_max_amount", plan.max), { reply_markup: getCancelKeyboard(user) });
            if (amount > user.balance) return bot.sendMessage(chatId, __("plans.err_insufficient_funds", user.balance), { reply_markup: getCancelKeyboard(user) });

            // Use a transaction
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

                user.balance -= amount;
                user.totalInvested += amount;
                user.state = 'none';
                user.stateContext = {};
                await user.save({ transaction: t });
                
                await t.commit();
                
                // Handle referrals (can be async, no need to wait)
                handleReferralBonus(user.referrerId, amount, user.id);

                await bot.sendMessage(chatId, __("plans.invest_success", amount, __(`plans.plan_${plan.id.split('_')[1]}_button`), plan.hours));

            } catch (error) {
                await t.rollback();
                throw error; // Let outer catch block handle it
            }
        }
        
        // --- 2. Awaiting Deposit Amount ---
        else if (user.state === 'awaiting_deposit_amount') {
            const amount = parseFloat(text);
            if (isNaN(amount) || amount < MIN_DEPOSIT) {
                return bot.sendMessage(chatId, __("deposit.min_error", MIN_DEPOSIT), { reply_markup: getCancelKeyboard(user) });
            }
            
            const invoice = await generateDepositInvoice(user, amount);
            if (invoice) {
                await Transaction.create({
                    user: user.id,
                    type: 'deposit',
                    amount: invoice.price_amount,
                    status: 'pending',
                    txId: invoice.payment_id // Save NowPayments ID
                });
                
                user.state = 'none';
                await user.save();

                const text = __("deposit.invoice_created", invoice.pay_amount, invoice.pay_address);
                await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
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
                reply_markup: getNetworkKeyboard(user)
            });
        }
        
        // --- 4. Awaiting Withdrawal Amount ---
        else if (user.state === 'awaiting_withdrawal_amount') {
            const amount = parseFloat(text);

            if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, __("plans.err_invalid_amount"), { reply_markup: getCancelKeyboard(user) });
            if (amount < MIN_WITHDRAWAL) return bot.sendMessage(chatId, __("withdraw.min_error", MIN_WITHDRAWAL), { reply_markup: getCancelKeyboard(user) });
            if (amount > user.balance) return bot.sendMessage(chatId, __("withdraw.insufficient_funds", user.balance), { reply_markup: getCancelKeyboard(user) });
            
            // --- Process Withdrawal Request via API ---
            const result = await requestWithdrawal(user, amount);
            
            if (result.success) {
                user.state = 'none';
                await user.save(); // User balance is updated inside requestWithdrawal
                await bot.sendMessage(chatId, __("withdraw.request_success", amount));
            } else {
                // API call failed, balance was not debited
                await bot.sendMessage(chatId, __("withdraw.request_failed", result.error));
            }
        }

    } catch (error) {
        console.error("Text input handler error:", error);
        user.state = 'none'; // Reset state on error
        await user.save();
        await bot.sendMessage(chatId, __('error_generic'));
    }
    
    // Send main menu if state was reset
    if (user.state === 'none') {
         await bot.sendMessage(chatId, __("main_menu_title", msg.from.first_name), {
            reply_markup: getMainMenuKeyboard(user)
        });
    }
};

module.exports = { handleTextInput };
