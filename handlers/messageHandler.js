const i18n = require('../services/i18n');
const { Op } = require('sequelize'); // Import Operator
const { ADMIN_USERNAME, BOT_USERNAME, REFERRAL_LEVELS, PLANS } = require('../config');
const { 
    getBalanceKeyboard, 
    getInvestmentPlansKeyboard, 
    getMakeInvestmentButton 
} = require('../services/keyboards');
const { User, Investment, Transaction } = require('../models');
const { processCompletedInvestments } = require('./investmentHandler');
const { formatDuration } = require('../services/utils');

// Helper to get referral counts
async function getReferralCounts(userId) {
    const l1_refs = await User.findAll({ where: { referrerId: userId }, attributes: ['id'] });
    const l1_ids = l1_refs.map(u => u.id);
    if (l1_ids.length === 0) return { l1: 0, l2: 0, l3: 0 };

    const l2_refs = await User.findAll({ where: { referrerId: { [Op.in]: l1_ids } }, attributes: ['id'] });
    const l2_ids = l2_refs.map(u => u.id);
    if (l2_ids.length === 0) return { l1: l1_ids.length, l2: 0, l3: 0 };

    const l3_count = await User.count({ where: { referrerId: { [Op.in]: l2_ids } } });
    
    return { l1: l1_ids.length, l2: l2_ids.length, l3: l3_count };
}


const handleMessage = async (bot, msg, user) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const __ = i18n.__; 

    try {
        // 📈 Make Investment
        if (text === __('menu.make_investment')) {
            const text = __("plans.title") + "\n\n" + __("common.balance", user.balance);
            await bot.sendMessage(chatId, text, {
                reply_markup: getInvestmentPlansKeyboard(user)
            });
        }
        
        // 📊 My Investments
        else if (text === __('menu.my_investments')) {
            await processCompletedInvestments(user.id);
            
            const investments = await Investment.findAll({ 
                where: { userId: user.id, status: 'running' },
                order: [['createdAt', 'DESC']] 
            });

            if (investments.length === 0) {
                return bot.sendMessage(chatId, __('investments.no_investments'), {
                    reply_markup: getMakeInvestmentButton(user)
                });
            }

            let response = __("investments.title") + "\n\n";
            for (const inv of investments) {
                const plan = PLANS[inv.planId];
                const remaining = formatDuration(inv.maturesAt - new Date());
                response += __("investments.investment_entry", 
                    inv.profitPercent, plan.hours, inv.amount, inv.profitAmount, remaining
                ) + "\n\n";
            }
            await bot.sendMessage(chatId, response);
        }

        // 💰 My Balance
        else if (text === __('menu.my_balance')) {
            const text = __("balance.title", user.balance, user.totalInvested, user.totalWithdrawn);
            await bot.sendMessage(chatId, text, {
                reply_markup: getBalanceKeyboard(user)
            });
        }
        
        // 👥 Referral Program
        else if (text === __('menu.referral_program')) {
            const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${user.telegramId}`;
            const counts = await getReferralCounts(user.id);
            const total_referrals = counts.l1 + counts.l2 + counts.l3;

            // --- HTML FIX ---
            // We now build an HTML string and set parse_mode to 'HTML'.
            // This correctly handles the underscores in the referral link.
            let response = "";
            response += `<b>${__("referral.title")}</b>\n\n`;
            response += `${__("referral.link")}\n<code>${refLink}</code>\n\n`;
            response += `<b>${__("referral.conditions_title")}</b>\n`;
            response += `Level 1: ${REFERRAL_LEVELS[1]*100}%\n`;
            response += `Level 2: ${REFERRAL_LEVELS[2]*100}%\n`;
            response += `Level 3: ${REFERRAL_LEVELS[3]*100}%\n\n`;
            response += `<b>${__("referral.stats_all_title")}</b>\n`;
            response += `Total referrals: ${total_referrals}\n`;
            response += ` ├ Level 1: ${counts.l1}\n`;
            response += ` ├ Level 2: ${counts.l2}\n`;
            response += ` └ Level 3: ${counts.l3}\n\n`;
            response += `<b>${__("referral.earnings_title")}</b>\n`;
            response += `Total earned: ${user.referralEarnings.toFixed(2)} USDT`;

            await bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
            // --- END OF FIX ---
        }
        
        // ❓ FAQ & 📞 Support
        else if (text === __('menu.faq')) {
            await bot.sendMessage(chatId, __('faq.title'));
        }
        else if (text === __('menu.support')) {
            await bot.sendMessage(chatId, __('support.title', ADMIN_USERNAME));
        }

    } catch (error) {
        console.error("Message handler error:", error);
        await bot.sendMessage(chatId, __('error_generic'));
    }
};

module.exports = { handleMessage };
