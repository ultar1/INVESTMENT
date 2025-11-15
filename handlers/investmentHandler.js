const { User, Investment, Transaction, sequelize } = require('../models');
const { Op } = require('sequelize');
const { REFERRAL_LEVELS } = require('../config');

// Pays out referral bonuses up to 3 levels
const handleReferralBonus = async (referrerId, investmentAmount, fromUserId) => {
    try {
        if (!referrerId) return; // No referrer

        let currentReferrerId = referrerId;
        const fromUser = await User.findByPk(fromUserId); // For logging

        for (let level = 1; level <= 3; level++) {
            if (!currentReferrerId) break; 
            
            const referrer = await User.findByPk(currentReferrerId);
            if (!referrer) break;

            const bonusPercent = REFERRAL_LEVELS[level];
            if (!bonusPercent) break;
            
            const bonusAmount = investmentAmount * bonusPercent;
            
            // Use a transaction for safety
            const t = await sequelize.transaction();
            try {
                referrer.balance += bonusAmount;
                referrer.referralEarnings += bonusAmount;
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
            
            // Move to the next level up
            currentReferrerId = referrer.referrerId;
        }

    } catch (error) {
        console.error("Error handling referral bonus:", error);
    }
};

// Finds and processes all completed investments for a user
const processCompletedInvestments = async (userId) => {
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

        // Use a transaction
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
            
            user.balance += totalPayout;
            await user.save({ transaction: t });
            
            await t.commit();
        } catch (e) {
            await t.rollback();
            console.error(`Failed to process completed investments for user ${userId}`, e);
        }
        
    } catch (error) {
        console.error("Error processing completed investments:", error);
    }
};

module.exports = { handleReferralBonus, processCompletedInvestments };
