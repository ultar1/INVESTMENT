const { User, Investment, Transaction, sequelize } = require('../models');
const { Op } = require('sequelize');
const { REFERRAL_LEVELS } = require('../config');
const i18n = require('../services/i18n'); // Import i18n

// Pays out referral bonuses up to 3 levels
// --- THIS IS THE FIX ---
// Accept `__` (language function) as an argument
const handleReferralBonus = async (referrerId, investmentAmount, fromUserId, __) => {
// --- END OF FIX ---
    try {
        if (!referrerId) return; // No referrer

        let currentReferrerId = referrerId;
        
        for (let level = 1; level <= 3; level++) {
            if (!currentReferrerId) break; 
            
            const referrer = await User.findByPk(currentReferrerId);
            if (!referrer) break;

            const bonusPercent = REFERRAL_LEVELS[level];
            if (!bonusPercent) break;
            
            const bonusAmount = investmentAmount * bonusPercent;
            
            const t = await sequelize.transaction();
            try {
                referrer.mainBalance = (referrer.mainBalance || 0) + bonusAmount;
                referrer.referralEarnings = (referrer.referralEarnings || 0) + bonusAmount;
                await referrer.save({ transaction: t });
                
                await Transaction.create({
                    user: referrer.id,
                    type: 'referral_bonus',
                    amount: bonusAmount,
                    status: 'completed',
                    fromUserId: fromUserId,
                    level: level
                }, { transaction: t });
                
                await t.commit();

                // --- FUTURE USE ---
                // Now you can notify the referrer in their own language
                // if (referrer && __) {
                //     i18n.setLocale(referrer.language);
                //     const referrer__ = i18n.__;
                //     const bot = ... (you'd need to pass bot in)
                //     bot.sendMessage(referrer.telegramId, referrer__("referral_bonus_received", ...));
                // }
                // --- END FUTURE USE ---

            } catch (e) {
                await t.rollback();
                console.error(`Failed to pay L${level} bonus to user ${referrer.id}`, e);
            }
            
            currentReferrerId = referrer.referrerId;
        }

    } catch (error) {
        console.error("Error handling referral bonus:", error);
    }
};

// Finds and processes all completed investments for a user
// --- THIS IS THE FIX ---
// Accept `bot` and `__` (language function) as arguments
const processCompletedInvestments = async (userId, __)Type, id, price_amount } = req.body;
    
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
        
        // --- FIX: Use the `tx.amount` we saved, not the API's `price_amount` ---
        // The `price_amount` from the IPN can sometimes be the `outcome_amount`
        // or a different value. `tx.amount` is what the user *intended* to deposit.
        const depositedAmount = tx.amount; 
        // --- END OF FIX ---

        const t = await sequelize.transaction();
        try {
            tx.status = 'completed';
            // tx.amount is already set, so we don't need to change it
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
