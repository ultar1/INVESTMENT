const { DataTypes } = require('sequelize');
const { sequelize } = require('../db/database');

const Transaction = sequelize.define('Transaction', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    type: {
        type: DataTypes.ENUM('deposit', 'withdrawal', 'referral_bonus', 'investment_profit'),
        required: true
    },
    amount: {
        type: DataTypes.DOUBLE,
        required: true
    },
    status: {
        type: DataTypes.ENUM('pending', 'completed', 'failed'),
        required: true
    },
    txId: { // e.g., NowPayments payment_id or payout_id
        type: DataTypes.STRING,
        defaultValue: null,
        // --- THIS IS THE FIX ---
        // We make the column itself unique, instead of
        // trying to add it as a SET DEFAULT property.
        unique: true
        // --- END OF FIX ---
    },
    walletAddress: { // User's wallet for withdrawals
        type: DataTypes.STRING,
        defaultValue: null
    },
    level: { // For referral bonus
        type: DataTypes.INTEGER,
        defaultValue: null
    }
    // 'userId' and 'fromUserId' will be added by associations
});

module.exports = Transaction;
