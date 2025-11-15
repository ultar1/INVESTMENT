const crypto = require('crypto');
const i18n = require('../services/i18n');
const { 
    NOWPAYMENTS_API_KEY, 
    NOWPAYMENTS_IPN_SECRET, 
    WEBHOOK_DOMAIN,
    BOT_TOKEN,
    BOT_USERNAME
} = require('../config');
const { sequelize, User, Transaction } = require('../models');
// We no longer need to import TelegramBot here

const NOWPAYMENTS_API_URL = "https://api.nowpayments.io/v1";

/**
 * Creates a BEP20-ONLY deposit invoice
 */
const generateDepositInvoice = async (user, amount) => {
    
    const orderId = `user_${user.id}_${Date.now()}`;

    const body = {
        price_amount: amount.toFixed(2),
        price_currency: 'usd',
        pay_currency: 'usdtbsc', // Forcing BEP20
        order_id: orderId,
        order_description: `Deposit for user ${user.id} (BEP20)`,
        ipn_callback_url: `${WEBHOOK_DOMAIN}/payment-ipn`,
        success_url: `https://t.me/${BOT_USERNAME}`,
        cancel_url: `https://t.me/${BOT_USERNAME}`
    };

    try {
        const response = await fetch(`${NOWPAYMENTS_API_URL}/invoice`, {
            method: 'POST',
            headers: {
                'x-api-key': NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const invoice = await response.json();

        if (!response.ok) {
            console.error("NowPayments createInvoice error:", invoice.message || 'Unknown error');
            return null;
        }
        
        return invoice;

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
        delete sortedBody['x-nowpayments-sig'];
        const bodyString = JSON.stringify(sortedBody);
        const hmac = crypto.createHmac('sha512', secret);
        hmac.update(bodyString, 'utf-8');
        const calculatedSignature = hmac.digest('hex');
        if (calculatedSignature !== signature) {
            console.warn("IPN Signature Mismatch:", {
                calculated: calculatedSignature,
                received: signature
            });
            return false;
        }
        return true;
    } catch (e) {
        console.error("IPN verification logic error:", e.message);
        return false;
    }
}

/**
 * Handles incoming IPN webhooks from NowPayments
 */
const handleNowPaymentsIPN = async (req, res, bot) => { // Accept bot instance
    
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
    
    const { order_id, payment_status, outcome_amount, type, id, price_amount } = req.body;
    
    if (payment_status === 'finished') {
        const tx = await Transaction.findOne({ where: { txId: order_id } });
        if (!tx || tx.status !== 'pending') {
            console.log(`IPN for order ${order_id} already processed or not found.`);
            return res.status(200).send('OK');
        }
        
        const user = await User.findByPk(tx.userId);
        if (!user) {
             console.error(`User not found for tx ${order_id}`);
             return res.status(404).send('User not found.');
        }

        const t = await sequelize.transaction();
        try {
            const depositedAmount = parseFloat(price_amount);
            
            tx.status = 'completed';
            tx.amount = depositedAmount;
            await tx.save({ transaction: t });
            
            user.mainBalance += depositedAmount;
            await user.save({ transaction: t });
            
            await t.commit();
            
            try {
                // --- THIS IS THE FIX ---
                // Set the user's language before sending the message
                i18n.setLocale(user.language);
                await bot.sendMessage(user.telegramId, i18n.__('deposit.ipn_success', depositedAmount.toFixed(2)));
                // --- END OF FIX ---
            } catch (notifyError) {
                console.error("Failed to notify user of deposit:", notifyError);
            }
            
        } catch (e) {
            await t.rollback();
            console.error("Failed to credit deposit:", e);
        }
    }
    
    if (type === 'payout' && (payment_status === 'finished' || payment_status === 'failed')) {
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
                user.mainBalance += tx.amount;
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
