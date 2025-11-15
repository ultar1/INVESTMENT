/**
 * Formats milliseconds into a human-readable string (e.g., "2d 5h 10m")
 * Used to show remaining time on investments.
 * @param {number} ms - The duration in milliseconds.
 * @returns {string} A formatted string.
 */
function formatDuration(ms) {
    if (ms < 0) ms = 0;
    
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));

    let str = "";
    if (days > 0) str += `${days}d `;
    if (hours > 0) str += `${hours}h `;
    
    // Only show minutes if the duration is less than a day
    if (minutes > 0 && days === 0) str += `${minutes}m`; 
    
    // If the string is still empty (less than a minute), show seconds
    if (str === "") str = `${seconds}s`; 
    
    return str.trim();
}

module.exports = { formatDuration };
