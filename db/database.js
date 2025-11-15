const { Sequelize } = require('sequelize');
const { DATABASE_URL } = require('../config');

if (!DATABASE_URL) {
    console.error("================================================================");
    console.error("CRITICAL ERROR: DATABASE_URL environment variable is NOT SET.");
    console.error("================================================================");
    process.exit(1);
}

const sequelize = new Sequelize(DATABASE_URL, {
    dialect: 'postgres',
    protocol: 'postgres',
    logging: false, 
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false 
        }
    },
    pool: {
        max: 5,
        min: 0,
        // --- THIS IS THE FIX ---
        // Increase acquire timeout to 60 seconds (60000ms)
        // to give Render's free DB time to wake up.
        acquire: 60000,
        // --- END OF FIX ---
        idle: 10000
    }
});

module.exports = { sequelize };
