const { sequelize } = require('../db/database');
const User = require('./User');
const Investment = require('./Investment');
const Transaction = require('./Transaction');

// --- User Relationships ---
// User can have one referrer
User.belongsTo(User, {
    as: 'Referrer',
    foreignKey: 'referrerId'
});

// User can have many investments
User.hasMany(Investment, {
    foreignKey: 'userId',
    onDelete: 'CASCADE'
});
Investment.belongsTo(User, { foreignKey: 'userId' });

// User can have many transactions
User.hasMany(Transaction, {
    foreignKey: 'userId',
    onDelete: 'CASCADE'
});
Transaction.belongsTo(User, { foreignKey: 'userId' });

// A transaction (like a bonus) can come from another user
Transaction.belongsTo(User, {
    as: 'FromUser',
    foreignKey: 'fromUserId'
});

module.exports = {
    sequelize,
    User,
    Investment,
    Transaction
};
