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
            if (amount > user.mainBalance) {
                return bot.sendMessage(chatId, __("plans.err_insufficient_funds", user.mainBalance), { reply_markup: getCancelKeyboard(user) });
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
                user.mainBalance -= amount;
                user.totalInvested += amount;
                user.state = 'none';
                user.stateContext = {};
                await user.save({ transaction: t });
                await t.commit();
                handleReferralBonus(user.referrerId, amount, user.id);
                
                // --- THIS IS THE FIX ---
                // Get the plan name from the locale file
                const planName = __(`plans.plan_${plan.id.split('_')[1]}_button`);
                // Send the new success message with all 3 arguments
                await bot.sendMessage(chatId, __("plans.invest_success", amount.toFixed(2), planName, plan.hours));
                // --- END OF FIX ---

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
                await Transaction.create({
                    user: user.id,
                    type: 'deposit',
                    amount: invoice.price_amount,
                    status: 'pending',
                    txId: invoice.order_id
                });
                
                user.state = 'none';
                await user.save();

                const text = __("deposit.invoice_created", invoice.price_amount);
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
            
            if (user.bonusBalance > 0) {
                const activeInvestments = await Investment.count({
                    where: { userId: user.id, status: 'running' }
                });

                if (activeInvestments > 0) {
                    const bonus = user.bonusBalance;
                    user.mainBalance += bonus;
                    user.bonusBalance = 0;
                    await user.save();
                    
                    await bot.sendMessage(chatId, __("bonus_unlocked", bonus.toFixed(2)));
                }
            }

            const amount = parseFloat(text);
            if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, __("plans.err_invalid_amount"), { reply_markup: getCancelKeyboard(user) });
            if (amount < MIN_WITHDRAWAL) return bot.sendMessage(chatId, __("withdraw.min_error", MIN_WITHDRAWAL), { reply_markup: getCancelKeyboard(user) });
            
            if (amount > user.mainBalance) {
                return bot.sendMessage(chatId, __("withdraw.insufficient_funds", user.mainBalance), { reply_markup: getCancelKeyboard(user) });
            }
            
            const t = await sequelize.transaction();
            let newTx;
            try {
                user.mainBalance -= amount;
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

            await bot.sendMessage(chatId, __("withdraw.request_success", amount));

            if (ADMIN_CHAT_ID) {
                try {
                    const notifyText = __("withdraw.notify_admin", 
                        user.firstName || 'N/A', 
                        user.telegramId, 
                        amount, 
                        user.walletAddress, 
                        user.walletNetwork.toUpperCase(),
                        newTx.id
                    );
                    const adminKeyboard = getAdminReviewKeyboard(newTx.id, __);
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
         await bot.sendMessage(chatId, __("main_menu_title", msg.from.first_name), {
            reply_markup: getMainMenuKeyboard(user)
        });
    }
};

module.exports = { handleTextInput };
