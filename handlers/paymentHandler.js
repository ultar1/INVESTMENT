const NowPayments = require('nowpayments-api-v1');
const i18n = require('../services/i18n');
const { 
    NOWPAYMENTS_API_KEY, 
    NOWPAYMENTS_IPN_SECRET, 
    WEBHOOK_DOMAIN 
} = require('../config');
const { sequelize, User, Transaction } = require('../models');

// Initialize NowPayments
const np = new NowPayments({ apiKey: NOWPAYMENTS_API_KEY });

/**
 * Creates a deposit invoice via NowPayments
 */
const generateDepositInvoice = async (user, amount) => {
    try {
        const payment = await np.createPayment({
            price_amount: amount,
            price_currency: 'usd',
            pay_currency: 'usdt.trc20', // Or offer a choice
            order_id: `user_${user.id}_${Date.now()}`,
            ipn_callback_url: `${WEBHOOK_DOMAIN}/payment-ipn`
        });
        
        return payment;
    } catch (error) {
        console.error("NowPayments createPayment error:", error.message);
        return null;
    }
};

/**
 * Processes a withdrawal request via NowPayments
 */
const requestWithdrawal = async (user, amount) => {
    const currency = user.walletNetwork === 'trc20' ? 'usdt.trc20' : 'usdt.bep20';

    // Use a transaction to ensure balance is only debited if API call is queued
    const t = await sequelize.transaction();
    try {
        // 1. Debit user balance
        user.balance -= amount;
        user.totalWithdrawn += amount;
        await user.save({ transaction: t });

        // 2. Create pending transaction
        const tx = await Transaction.create({
            user: user.id,
            type: 'withdrawal',
            amount: amount,
            status: 'pending', // Pending until NowPayments confirms
            walletAddress: user.walletAddress
        }, { transaction: t });

        // 3. Call NowPayments API
        // NOTE: We use batch-payouts for withdrawals.
        // This is safer. We'll create a payout request.
        const payout = await np.createPayout({
            address: user.walletAddress,
            currency: currency,
            amount: amount,
            ipn_callback_url: `${WEBHOOK_DOMAIN}/payment-ipn`
            // batch_withdrawal_id can be tx.id
        });

        // 4. Update transaction with payout ID
        tx.txId = payout.id; // Save NowPayments payout ID
        await tx.save({ transaction: t });

        // 5. Commit
        await t.commit();
        return { success: true };
        
    } catch (error) {
        await t.rollback(); // Rollback balance change if API fails
        console.error("NowPayments createPayout error:", error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Handles incoming IPN webhooks from NowPayments
 */
const handleNowPaymentsIPN = async (req, res) => {
    // 1. Verify the IPN
    const signature = req.headers['x-nowpayments-sig'];
    if (!signature) return res.status(401).send("No signature.");
    
    try {
        const isValid = np.verifyIPN(req.body, signature, NOWPAYMENTS_IPN_SECRET);
        if (!isValid) {
            console.warn("Invalid NowPayments IPN signature.");
            return res.status(401).send("Invalid signature.");
        }
    } catch (e) {
        console.error("IPN verification error:", e.message);
        return res.status(500).send("Verification error.");
    }
    
    // 2. Process the IPN
    const { payment_id, payment_status, outcome_amount, type, id } = req.body;
    
    // --- Handle DEPOSIT confirmation ---
    if (type === 'payment' && payment_status === 'finished') {
        const tx = await Transaction.findOne({ where: { txId: payment_id } });
        if (!tx || tx.status !== 'pending') {
            console.log(`IPN for tx ${payment_id} already processed or not found.`);
            return res.status(200).send('OK');
        }
        
        const user = await User.findByPk(tx.userId);
        if (!user) {
             console.error(`User not found for tx ${payment_id}`);
             return res.status(404).send('User not found.');
        }

        // Use transaction for safety
        const t = await sequelize.transaction();
        try {
            const depositedAmount = parseFloat(outcome_amount);
            
            tx.status = 'completed';
            tx.amount = depositedAmount; // Update to actual amount received
            await tx.save({ transaction: t });
            
            user.balance += depositedAmount;
            await user.save({ transaction: t });
            
            await t.commit();
            
            // Notify user
            i18n.setLocale(user.language);
            bot.sendMessage(user.telegramId, i18n.__('deposit.ipn_success', depositedAmount));
            
        } catch (e) {
            await t.rollback();
            console.error("Failed to credit deposit:", e);
        }
    }
    
    // --- Handle WITHDRAWAL confirmation ---
    if (type === 'payout' && (payment_status === 'finished' || payment_status === 'failed')) {
        const tx = await Transaction.findOne({ where: { txId: id } }); // 'id' is used for payout
        if (!tx || tx.status !== 'pending') {
            console.log(`IPN for payout ${id} already processed.`);
            return res.status(200).send('OK');
        }

        if (payment_status === 'finished') {
            tx.status = 'completed';
            await tx.save();
            // User was already debited, just confirm
        } else if (payment_status === 'failed') {
            // Payout failed. Refund the user.
            const user = await User.findByPk(tx.userId);
            if(user) {
                user.balance += tx.amount; // Add money back
                user.totalWithdrawn -= tx.amount;
                await user.save();
            }
            tx.status = 'failed';
            await tx.save();
        }
    }

    res.status(200).send('IPN processed.');
};


module.exports = { 
    generateDepositInvoice,
    requestWithdrawal,
    handleNowPaymentsIPN
};
