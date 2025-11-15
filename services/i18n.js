const i18n = require('i18n');
const path = require('path');

i18n.configure({
    // Defines all languages your bot will support
    locales: ['en', 'es', 'fr', 'ru'],
    
    // Path to the directory where your .json translation files are stored
    directory: path.join(__dirname, '..', 'locales'),
    
    // Default language to use if a user's language is not available
    defaultLocale: 'en',
    
    // Allows you to use nested keys in your JSON files (e.g., "common.back")
    objectNotation: true, 
    
    // Disables automatic creation of new keys in files (safer for production)
    updateFiles: false,
    
    // Disables logging of missing keys to the console (can be noisy)
    logErrorFn: function (msg) {
        // console.warn('i18n warning:', msg);
    }
});

module.exports = i18n;
