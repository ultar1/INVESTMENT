const { Sequelize } = require('sequelize');
const { DATABASE_URL } = require('../config');

if (!DATABASE_URL) {
    console.error("DATABASE_URL is missing!");
    process.exit(1);
}

const sequelize = new Sequelize(DATABASE_URL, {
    dialect: 'postgres',
    protocol: 'postgres',
    logging: false, // Set to console.log to see SQL queries
    dialectOptions: {
        // Render requires SSL for its Postgres instances
        ssl: {
            require: true,
            rejectUnauthorized: false 
        }
    }
});

module.exports = { sequelize };
