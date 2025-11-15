const i18n = require('../services/i18n');
const { sequelize, User, Investment, Transaction } = require('../models');
const { 
    getMainMenuKeyboard, 
    getCancelKeyboard, 
    getWithdrawNetworkKeyboard, // Renamed
    getDepositNetworkKeyboard, // New
    getAdminReviewKeyboard 
} = require('../services/keyboards');
const { PLANS, MIN_WITHDRAWAL, MIN_DEPOSIT, ADMIN_CHAT_ID } = require('../config');
const { handleReferralBonus } = require('./investmentHandler');
// We no longer call generateDepositInvoice from here
// const { generateDepositInvoice } = require('./paymentHandler'); 

// Basic wallet validation
function isValidWallet(address) {
    return (address.startsWith('T') && address.length > 30) || (address.startsWith('0x') && address.length === 42);
}

const handleTextInput = async (bot, msg, user) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const __ = i18n.__; // User's language instance

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
                
                handleReferralBonus(user.referrerId, amount, user.id);

                await bot.sendMessage(chatId, __("plans.invest_success", amount, __(`plans.plan_${plan.id.split('_')[1]}_button`), plan.hours));

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
            
            // --- NEW LOGIC ---
            // Don't create invoice yet. Ask for network.
            user.state = 'awaiting_deposit_network';
            user.stateContext = { amount: amount }; // Save amount in context
            await user.save();
            
            // Ask user to select the network
            await bot.sendMessage(chatId, __("deposit.ask_network", amount), {
                reply_markup: getDepositNetworkKeyboard(user)
            });
            // We don't send main menu, we wait for button click
            return; // Exit handler
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
                reply_markup: getWithdrawNetworkKeyboard(user) // Use the withdraw keyboard
            });
            // Wait for button click
            return;
        }
        
        // --- 4. Awaiting Withdrawal Amount ---
        else if (user.state === 'awaiting_withdrawal_amount') {
            const amount = parseFloat(text);

            if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, __("plans.err_invalid_amount"), { reply_markup: getCancelKeyboard(user) });
            if (amount < MIN_WITHDRAWAL) return bot.sendMessage(chatId, __("withdraw.min_error", MIN_WITHDRAWAL), { reply_markup: getCancelKeyboard(user) });
            if (amount > user.balance) return bot.sendMessage(chatId, __("withdraw.insufficient_funds", user.balance), { reply_markup: getCancelKeyboard(user) });
            
            const t = await sequelize.transaction();
            let newTx;
            try {
                user.balance -= amount;
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
