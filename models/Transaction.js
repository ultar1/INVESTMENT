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
        allowNull: false
    },
    amount: {
        type: DataTypes.DOUBLE,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('pending', 'completed', 'failed'),
        allowNull: false
    },
    // --- THIS IS THE FIX ---
    // This is the simplest, most stable way to define
    // a column that can be null but must be unique if it's not null.
    txId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
    },
    // --- END OF FIX ---
    walletAddress: {
        type: DataTypes.STRING,
        allowNull: true
    },
    level: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
});

module.exports = Transaction;
