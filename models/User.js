const { DataTypes } = require('sequelize');
const { sequelize } = require('../db/database');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    telegramId: {
        type: DataTypes.BIGINT, // Use BIGINT for large telegram IDs
        required: true,
        unique: true,
        allowNull: false
    },
    firstName: {
        type: DataTypes.STRING
    },
    username: {
        type: DataTypes.STRING
    },
    language: {
        type: DataTypes.STRING,
        defaultValue: 'en'
    },
    
    // --- FIX: Replaced the old 'balance' field with 'mainBalance' and 'bonusBalance' ---
    // This matches what your handlers are using and fixes the balance bug.
    mainBalance: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    bonusBalance: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    // --- END OF FIX ---

    walletAddress: {
        type: DataTypes.STRING,
        defaultValue: null
    },
    walletNetwork: {
        type: DataTypes.STRING, // 'trc20' or 'bep20'
        defaultValue: null
    },
    state: {
        type: DataTypes.STRING,
        defaultValue: 'none'
    },
    stateContext: {
        type: DataTypes.JSONB, // Use JSONB for objects
        defaultValue: {}
    },
    referralEarnings: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    totalInvested: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    totalWithdrawn: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    }
    // 'referrerId' will be added by associations
});

module.exports = User;
