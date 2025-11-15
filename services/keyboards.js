const i18n = require('./i18n');

// Set locale for i18n
function setLocale(user) {
    const lang = user ? user.language : 'en';
    i18n.setLocale(lang);
    return i18n;
}

const getLanguageKeyboard = () => {
    return {
        inline_keyboard: [
            [{ text: "🇬🇧 English", callback_data: "set_lang_en" }, { text: "🇷🇺 Русский", callback_data: "set_lang_ru" }],
            [{ text: "🇪🇸 Español", callback_data: "set_lang_es" }, { text: "🇫🇷 Français", callback_data: "set_lang_fr" }]
        ]
    };
};

const getMainMenuKeyboard = (user) => {
    const __ = setLocale(user).__;
    return {
        keyboard: [
            [{ text: __('menu.make_investment') }],
            [{ text: __('menu.my_investments') }, { text: __('menu.my_balance') }],
            [{ text: __('menu.referral_program') }, { text: __('menu.faq') }],
            [{ text: __('menu.support') }]
        ],
        resize_keyboard: true
    };
};

const getBalanceKeyboard = (user) => {
    const __ = setLocale(user).__;
    return {
        inline_keyboard: [
            [{ text: __('balance.deposit'), callback_data: "deposit" }, { text: __('balance.withdraw'), callback_data: "withdraw" }],
            [{ text: __('balance.transactions'), callback_data: "transactions" }]
        ]
    };
};

const getInvestmentPlansKeyboard = (user) => {
    const __ = setLocale(user).__;
    return {
        inline_keyboard: [
            [{ text: __('plans.plan_1_button'), callback_data: "invest_plan_1" }],
            [{ text: __('plans.plan_2_button'), callback_data: "invest_plan_2" }],
            [{ text: __('plans.plan_3_button'), callback_data: "invest_plan_3" }],
            [{ text: __('plans.plan_4_button'), callback_data: "invest_plan_4" }],
            [{ text: __('common.back'), callback_data: "back_to_main" }]
        ]
    };
};

// Renamed from getNetworkKeyboard for clarity
const getWithdrawNetworkKeyboard = (user) => {
    const __ = setLocale(user).__;
    return {
         inline_keyboard: [
            [{ text: "TRC20 (Tron)", callback_data: "set_network_trc20" }, { text: "BEP20 (BSC)", callback_data: "set_network_bep20" }],
            [{ text: __('common.cancel'), callback_data: "cancel_action" }]
        ]
    };
};

// --- NEW KEYBOARD ---
// For selecting deposit network
const getDepositNetworkKeyboard = (user) => {
    const __ = setLocale(user).__;
    return {
         inline_keyboard: [
            [{ text: "TRC20 (Tron)", callback_data: "deposit_network_trc20" }, { text: "BEP20 (BSC)", callback_data: "deposit_network_bep20" }],
            [{ text: __('common.cancel'), callback_data: "cancel_action" }]
        ]
    };
};

const getCancelKeyboard = (user) => {
    const __ = setLocale(user).__;
    return {
        inline_keyboard: [
            [{ text: __('common.cancel'), callback_data: "cancel_action" }]
        ]
    };
};

const getBackKeyboard = (user, callback_data = "back_to_main") => {
    const __ = setLocale(user).__;
    return {
        inline_keyboard: [
            [{ text: __('common.back'), callback_data: callback_data }]
        ]
    };
};

const getMakeInvestmentButton = (user) => {
     const __ = setLocale(user).__;
    return {
        inline_keyboard: [
            [{ text: __('menu.make_investment'), callback_data: "show_invest_plans" }]
        ]
    };
}

// For admin withdrawal review
const getAdminReviewKeyboard = (transactionId, i18nInstance) => {
    const __ = i18nInstance;
    return {
        inline_keyboard: [
            [
                { text: __("withdraw.admin_approve"), callback_data: `admin_approve_${transactionId}` },
                { text: __("withdraw.admin_reject"), callback_data: `admin_reject_${transactionId}` }
            ]
        ]
    };
};

module.exports = {
    getLanguageKeyboard,
    getMainMenuKeyboard,
    getBalanceKeyboard,
    getInvestmentPlansKeyboard,
    getWithdrawNetworkKeyboard, // Renamed
    getDepositNetworkKeyboard, // New
    getCancelKeyboard,
    getBackKeyboard,
    getMakeInvestmentButton,
    getAdminReviewKeyboard
};
