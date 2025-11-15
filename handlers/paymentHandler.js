const crypto = require('crypto');
const i18n = require('../services/i18n');
const { 
    NOWPAYMENTS_API_KEY, 
    NOWPAYMENTS_IPN_SECRET, 
    WEBHOOK_DOMAIN,
    BOT_TOKEN,
    APP_URL // Assuming APP_URL is your WEBHOOK_DOMAIN
} = require('../config');
const { sequelize, User, Transaction } = require('../models');
const TelegramBot = require('node-telegram-bot-api');

const NOWPAYMENTS_API_URL = "https://api.nowpayments.io/v1";

/**
 * Creates a generic deposit invoice using the /invoice endpoint.
 * This allows the user to select their own coin.
 * @param {object} user - The user object
 * @param {number} amount - The amount in USD
 */
const generateDepositInvoice = async (user, amount) => {
    
    const orderId = `user_${user.id}_${Date.now()}`;

    // This logic is from your example code, using the /invoice endpoint
    const body = {
        price_amount: amount.toFixed(2),
        price_currency: 'usd',
        order_id: orderId,
        order_description: `Deposit for user ${user.id}`,
        ipn_callback_url: `${WEBHOOK_DOMAIN}/payment-ipn`,
        success_url: `https://t.me/${(require('../config').BOT_USERNAME)}`, // Return to bot on success
        cancel_url: `https://t.me/${(require('../config').BOT_USERNAME)}`  // Return to bot on cancel
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
        
        // Return the full invoice object, which includes 'invoice_url'
        return invoice;

    } catch (error) {
        console.error("NowPayments API request error:", error.message);
        return null;
    }
};

/**
 * Verifies the IPN signature from NowPayments.
 * This logic is from your example code.
 */
function verifyIPN(body, signature, secret) {
    try {
        // Sort the keys to create a deterministic JSON string
        const sortedBody = {};
        Object.keys(body).sort().forEach(key => {
            sortedBody[key] = body[key];
        });
        
        // Remove 'x-nowpayments-sig' if it exists in the body
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
const handleNowPaymentsIPN = async (req, res) => {
    
    const signature = req.headers['x-nowpayments-sig'];
    if (!signature) {
        console.warn("IPN received with no signature.");
        return res.status(401).send("No signature.");
    }
    
    try {
        // Use the new verifier from your example
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
    const { order_id, payment_status, outcome_amount, type, id, price_amount } = req.body;
    
    // --- Handle DEPOSIT confirmation ---
    // Your example uses 'order_id', so we will use that.
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
            // Use outcome_amount (actual crypto received) or price_amount (original USD)
            // We'll trust price_amount as that's what the user intended to deposit
            const depositedAmount = parseFloat(price_amount);
            
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
    // (This part is unchanged as withdrawals are manual)
    if (type === 'payout' && (payment_status === 'finished' || payment_status === 'failed')) {
        const tx = await Transaction.findOne({ where: { txId: id } }); // 'id' is used for payout
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
