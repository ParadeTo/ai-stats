const fs = require('fs');
const { getSessionDataFilePath, log } = require('./config');

/**
 * 初始化 session 数据
 */
function initSessionData(generationId, prompt = null) {
    try {
        const sessionFile = getSessionDataFilePath(generationId);
        const data = {
            generationId,
            timestamp: Date.now(),
            prompt: prompt || null,
            startTime: Math.floor(Date.now() / 1000),
        };
        fs.writeFileSync(sessionFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        log(`initSessionData failed: ${error.message}`);
    }
}

/**
 * 读取 session 数据
 */
function loadSessionData(generationId) {
    try {
        const sessionFile = getSessionDataFilePath(generationId);
        if (fs.existsSync(sessionFile)) {
            return JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        }
    } catch (error) {
        log(`loadSessionData failed: ${error.message}`);
    }
    return null;
}

/**
 * 清理 session 数据
 */
function clearSessionData(generationId) {
    try {
        const sessionFile = getSessionDataFilePath(generationId);
        if (fs.existsSync(sessionFile)) {
            fs.unlinkSync(sessionFile);
        }
    } catch (error) {
        log(`clearSessionData failed: ${error.message}`);
    }
}

module.exports = {
    initSessionData,
    loadSessionData,
    clearSessionData
};

