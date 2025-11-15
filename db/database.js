const { Sequelize } = require('sequelize');
const { DATABASE_URL } = require('../config');

// This will check if the DATABASE_URL is missing.
if (!DATABASE_URL) {
    console.error("================================================================");
    console.error("CRITICAL ERROR: DATABASE_URL environment variable is NOT SET.");
    console.error("Your app cannot connect to the database.");
    console.error(" ");
    console.error("Possible Fixes:");
    console.error("1. On Render: Go to your service's 'Environment' tab. Make sure 'DATABASE_URL' is listed and has a value like 'From investment-db'.");
    console.error("2. On GitHub: Check that you have NOT committed your '.env' file. If you did, you must remove it.");
    console.error("================================================================");
    process.exit(1); // Stop the app
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
    },
    // --- NEW: Connection Pooling ---
    // This helps manage connections and reconnect automatically
    // if the database connection "hiccups"
    pool: {
        max: 5, // Max number of connections in pool
        min: 0, // Min number of connections in pool
        acquire: 30000, // Max time (ms) to wait for a connection
        idle: 10000 // Max time (ms) a connection can be idle
    }
    // --- END OF NEW CODE ---
});

module.exports = { sequelize };
