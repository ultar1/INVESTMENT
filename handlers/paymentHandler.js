const crypto = require('crypto');
const i18n = require('../services/i18n');
const { 
    NOWPAYMENTS_API_KEY, 
    NOWPAYMENTS_IPN_SECRET, 
    WEBHOOK_DOMAIN,
    BOT_TOKEN
} = require('../config');
const { sequelize, User, Transaction } = require('../models');
const TelegramBot = require('node-telegram-bot-api');

const NOWPAYMENTS_API_URL = "https://api.nowpayments.io/v1";

/**
 * Creates a generic USD deposit invoice via NowPayments API
 * @param {object} user - The user object
 * @param {number} amount - The amount in USD
 */
const generateDepositInvoice = async (user, amount) => {
    
    // --- THIS IS THE FIX ---
    // We REMOVE pay_currency.
    // This creates a generic invoice where the user
    // selects the coin/network on the NowPayments page.
    const body = {
        price_amount: amount,
        price_currency: 'usd',
        // pay_currency is intentionally removed
        order_id: `user_${user.id}_${Date.now()}`,
        ipn_callback_url: `${WEBHOOK_DOMAIN}/payment-ipn`
    };
    // --- END OF FIX ---

    try {
        const response = await fetch(`${NOWPAYMENTS_API_URL}/payment`, {
            method: 'POST',
            headers: {
                'x-api-key': NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const payment = await response.json();

        if (!response.ok) {
            console.error("NowPayments createPayment error:", payment.message || 'Unknown error');
            return null;
        }
        
        // We now return the full payment object,
        // which includes the 'invoice_url'
        return payment;

    } catch (error) {
        console.error("NowPayments API request error:", error.message);
        return null;
    }
};

/**
 * Verifies the IPN signature from NowPayments.
 */
function verifyIPN(body, signature, secret) {
    try {
        const sortedBody = {};
        Object.keys(body).sort().forEach(key => {
            sortedBody[key] = body[key];
        });
        const bodyString = JSON.stringify(sortedBody);
        const hmac = crypto.createHmac('sha512', secret);
        hmac.update(bodyString, 'utf-8');
        const calculatedSignature = hmac.digest('hex');
        return calculatedSignature === signature;
    } catch (e) {
        console.error("IPN verification logic error:", e.message);
        return false;
    }
}

/**
 * Handles incoming IPN webhooks from NowPayments
 */
const handleNowPaymentsIPN = async (req, res) => {
    // (This function is unchanged from the previous version)
    
    // 1. Verify the IPN
    const signature = req.headers['x-nowpayments-sig'];
    if (!signature) {
        console.warn("IPN received with no signature.");
        return res.status(401).send("No signature.");
    }
    
    try {
        const isValid = verifyIPN(req.body, signature, NOWPAYMENTS_IPN_SECRET);
        if (!isValid) {
            console.warn("Invalid NowPayments IPN signature received.");
            return res.status(401).send("Invalid signature.");
        }
    } catch (e) {
        console.error("IPN verification error:", e.message);
        return res.status(500).send("Verification error.");
    }
    
    // 2. Process the IPN (Signature is valid)
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

        const t = await sequelize.transaction();
        try {
            const depositedAmount = parseFloat(outcome_amount);
            
            tx.status = 'completed';
            tx.amount = depositedAmount;
            await tx.save({ transaction: t });
            
            user.balance += depositedAmount;
            await user.save({ transaction: t });
            
            await t.commit();
            
            try {
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
    if (type === 'payout' && (payment_status === 'finished' || payment_status === 'failed')) {
        // (This logic remains the same for manual dashboard payouts)
        const tx = await Transaction.findOne({ where: { txId: id } });
        if (!tx || tx.status !== 'pending') {
            console.log(`IPN for payout ${id} already processed or not found.`);
            return res.status(200).send('OK');
        }
        if (payment_status === 'finished') {
            tx.status = 'completed';
            const user = await User.findByPk(tx.userId);
            if(user) {
                user.totalWithdrawn += tx.amount;
                await user.save();
            }
        } else if (payment_status === 'failed') {
            tx.status = 'failed';
            const user = await User.findByPk(tx.userId);
            if(user) {
                user.balance += tx.amount;
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
