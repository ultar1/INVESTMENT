const { DataTypes } = require('sequelize');
const { sequelize } = require('../db/database');

const Investment = sequelize.define('Investment', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    planId: {
        type: DataTypes.STRING,
        required: true
    },
    amount: {
        type: DataTypes.DOUBLE,
        required: true
    },
    profitPercent: {
        type: DataTypes.DOUBLE,
        required: true
    },
    profitAmount: {
        type: DataTypes.DOUBLE,
        required: true
    },
    status: {
        type: DataTypes.ENUM('running', 'completed'),
        defaultValue: 'running'
    },
    maturesAt: {
        type: DataTypes.DATE,
        required: true
    }
    // 'userId' will be added by associations
});

module.exports = Investment;
