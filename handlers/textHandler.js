const i18n = require('../services/i18n');
const { sequelize, User, Investment, Transaction } = require('../models');
const { 
    getMainMenuKeyboard, 
    getCancelKeyboard, 
    getWithdrawNetworkKeyboard, 
    getAdminReviewKeyboard 
} = require('../services/keyboards');
const { 
    PLANS, 
    MIN_WITHDRAWAL, 
    MIN_DEPOSIT, 
    ADMIN_CHAT_ID,
    ADMIN_DEPOSIT_WALLET // --- FIX: Import your new wallet ---
} = require('../config');
const { handleReferralBonus } = require('./investmentHandler');
// const { generateDepositInvoice } = require('./paymentHandler'); // --- FIX: Removed NowPayments ---

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
            
            // --- FIX: Pass `__` to ALL error keyboards ---
            if (isNaN(amount) || amount <= 0) {
                return bot.sendMessage(chatId, __("plans.err_invalid_amount"), { reply_markup: getCancelKeyboard(user, __) });
            }
            if (amount < plan.min) {
                return bot.sendMessage(chatId, __("plans.err_min_amount", plan.min), { reply_markup: getCancelKeyboard(user, __) });
            }
            if (amount > plan.max) {
                return bot.sendMessage(chatId, __("plans.err_max_amount", plan.max), { reply_markup: getCancelKeyboard(user, __) });
            }
            const mainBalance = user.mainBalance || 0;
            if (amount > mainBalance) {
                return bot.sendMessage(chatId, __("plans.err_insufficient_funds", toFixedSafe(mainBalance)), { reply_markup: getCancelKeyboard(user, __) });
            }
            // --- END OF FIX ---

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
                
                handleReferralBonus(user.referrerId, amount, user.id, __); 
                
                const planName = __(`plans.plan_${plan.id.split('_')[1]}_button`);
                await bot.sendMessage(chatId, __("plans.invest_success", toFixedSafe(amount), planName, plan.hours));
            } catch (error) {
                await t.rollback();
                throw error; 
            }
        }
        
        // --- 2. Awaiting Deposit Amount (MANUAL FLOW) ---
        else if (user.state === 'awaiting_deposit_amount') {
            const amount = parseFloat(text);
            if (isNaN(amount) || amount < MIN_DEPOSIT) {
                return bot.sendMessage(chatId, __("deposit.min_error", MIN_DEPOSIT), { reply_markup: getCancelKeyboard(user, __) });
            }
            
            // --- FIX: Create a PENDING transaction for the admin to approve ---
            let newTx;
            try {
                newTx = await Transaction.create({
                    user: user.id,
                    type: 'deposit',
                    amount: amount, 
                    status: 'pending' // Admin must approve this
                });
            } catch (e) {
                console.error("Failed to create pending deposit tx:", e);
                return bot.sendMessage(chatId, __("deposit.api_error"), { reply_markup: getCancelKeyboard(user, __) });
            }

            user.state = 'awaiting_payment_confirmation'; // Set a new state
            user.stateContext = { depositTxId: newTx.id }; // Save the TX ID
            await user.save();

            // Send the instructions and "I have paid" button
            const instructions = __("deposit.manual_instructions", ADMIN_DEPOSIT_WALLET);
            await bot.sendMessage(chatId, instructions, { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        // The button callback now includes the Transaction ID
                        [{ text: __("deposit.i_have_paid_button"), callback_data: `deposit_paid_${newTx.id}` }],
                        [{ text: __("common.cancel"), callback_data: "cancel_action" }]
                    ]
                }
            });
            return; // Stay in this state until user clicks a button
            // --- END OF FIX ---
        }

        // --- 3. Awaiting Wallet Address ---
        else if (user.state === 'awaiting_wallet_address') {
            // --- FIX: Pass `__` to error keyboard ---
            if (!isValidWallet(text)) {
                return bot.sendMessage(chatId, __("withdraw.invalid_wallet"), { reply_markup: getCancelKeyboard(user, __) });
            }
            // --- END OF FIX ---
            user.state = 'awaiting_wallet_network';
            user.stateContext = { wallet: text };
            await user.save();
            await bot.sendMessage(chatId, __("withdraw.ask_network"), {
                reply_markup: getWithdrawNetworkKeyboard(user, __) // Pass `__` here
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

            // --- FIX: Pass `__` to ALL error keyboards ---
            if (isNaN(amount) || amount <= 0) {
                return bot.sendMessage(chatId, __("plans.err_invalid_amount"), { reply_markup: getCancelKeyboard(user, __) });
            }
            if (amount < MIN_WITHDRAWAL) {
                return bot.sendMessage(chatId, __("withdraw.min_error", minWithdrawalText), { reply_markup: getCancelKeyboard(user, __) });
            }
            if (amount > mainBalance) {
                return bot.sendMessage(chatId, __("withdraw.insufficient_funds", toFixedSafe(mainBalance)), { reply_markup: getCancelKeyboard(user, __) });
            }
            // --- END OF FIX ---
            
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
        
        // --- FIX: Use "Welcome back" message and `msg.from.first_name` ---
        // This is your "Welcome, Motherfucker!" message
        const welcomeText = __("language_set", __("language_name"), msg.from.first_name);
        await bot.sendMessage(chatId, welcomeText, {
            reply_markup: getMainMenuKeyboard(user, __)
        });
        // --- END OF FIX ---
    }
};

module.exports = { handleTextInput };
