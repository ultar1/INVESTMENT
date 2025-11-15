const NowPayments = require('nowpayments-api-v1');
const i18n = require('../services/i18n');
const { 
    NOWPAYMENTS_API_KEY, 
    NOWPAYMENTS_IPN_SECRET, 
    WEBHOOK_DOMAIN,
    BOT_TOKEN
} = require('../config');
const { sequelize, User, Transaction } = require('../models');
const TelegramBot = require('node-telegram-bot-api');

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
 * Handles incoming IPN webhooks from NowPayments
 * This now only processes deposits and manual payout confirmations
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
            try {
                // Re-initialize bot instance to send message
                const bot = new TelegramBot(BOT_TOKEN);
                i18n.setLocale(user.language);
                await bot.sendMessage(user.telegramId, i18n.__('deposit.ipn_success', depositedAmount));
            } catch (notifyError) {
                console.error("Failed to notify user of deposit:", notifyError);
            }
            
        } catch (e) {
            await t.rollback();
            console.error("Failed to credit deposit:", e);
        }
    }
    
    // --- Handle WITHDRAWAL confirmation ---
    // This will catch payouts you manually process via NowPayments dashboard
    if (type === 'payout' && (payment_status === 'finished' || payment_status === 'failed')) {
        const tx = await Transaction.findOne({ where: { txId: id } }); // 'id' is used for payout
        
        if (!tx) {
             // This might be a payout not initiated by our bot, safe to ignore
             console.log(`IPN for unknown payout ${id} received.`);
             return res.status(200).send('OK');
        }

        if (tx.status !== 'pending') {
            console.log(`IPN for payout ${id} already processed.`);
            return res.status(200).send('OK');
        }

        if (payment_status === 'finished') {
            tx.status = 'completed';
            // Find user just to update totalWithdrawn
            const user = await User.findByPk(tx.userId);
            if(user) {
                user.totalWithdrawn += tx.amount;
                await user.save();
            }
        } else if (payment_status === 'failed') {
            tx.status = 'failed';
            // Refund user
            const user = await User.findByPk(tx.userId);
            if(user) {
                user.balance += tx.amount; // Add money back
                await user.save();
            }
        }
        await tx.save();
    }

    res.status(200).send('IPN processed.');
};


module.exports = { 
    generateDepositInvoice,
    handleNowPaymentsIPN
};
