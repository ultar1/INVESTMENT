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
const processCompletedInvestments = async (userId, __) => {
// --- END OF FIX ---
    try {
        const completed = await Investment.findAll({
            where: {
                userId: userId,
                status: 'running',
                maturesAt: { [Op.lte]: new Date() } // Find mature investments
            }
        });

        if (completed.length === 0) return;

        const user = await User.findByPk(userId);
        if (!user) return;

        let totalPayout = 0;

        const t = await sequelize.transaction();
        try {
            for (const inv of completed) {
                const payout = inv.amount + inv.profitAmount;
                totalPayout += payout;
                
                inv.status = 'completed';
                await inv.save({ transaction: t });
                
                await Transaction.create({
                    user: user.id,
                    type: 'investment_profit',
                    amount: payout,
                    status: 'completed'
                }, { transaction: t });
            }
            
            user.mainBalance = (user.mainBalance || 0) + totalPayout;
            await user.save({ transaction: t });
            
            await t.commit();
            
            // --- We can notify the user here if we want ---
            // Example:
            // const bot = new (require('node-telegram-bot-api'))(require('../config').BOT_TOKEN);
            // i18n.setLocale(user.language);
            // const notify__ = i18n.__;
            // await bot.sendMessage(user.telegramId, notify__("investment_completed_message", totalPayout.toFixed(2)));
            // (You would need to add "investment_completed_message" to locales)
            
        } catch (e) {
            await t.rollback();
            console.error(`Failed to process completed investments for user ${userId}`, e);
        }
        
    } catch (error) {
        console.error("Error processing completed investments:", error);
    }
};

module.exports = { handleReferralBonus, processCompletedInvestments };
