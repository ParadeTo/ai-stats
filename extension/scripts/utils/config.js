const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE_DIR = path.join(os.homedir(), '.ai-code-stats');
const LOGS_DIR = path.join(BASE_DIR, 'logs');
const SESSION_DIR = path.join(BASE_DIR, 'sessions');

const CONFIG = {
    REPORT_URL: 'http://your-api-endpoint.com/api/v1/report',
    TIMEOUT: 2000,
    LOG_PATH: path.join(LOGS_DIR, 'debug.log'),
    HOOKS_INPUT_FILE: path.join(LOGS_DIR, 'hooks_input.json'),
};

function ensureDirectoriesExist() {
    [BASE_DIR, LOGS_DIR, SESSION_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
}

function getSessionDataFilePath(generationId) {
    return path.join(SESSION_DIR, `${generationId}.json`);
}

function log(message) {
    try {
        ensureDirectoriesExist();
        fs.appendFileSync(CONFIG.LOG_PATH, `${new Date().toISOString()} - ${message}\n`);
    } catch (e) {
        // 静默失败
    }
}

module.exports = {
    CONFIG,
    LOGS_DIR,
    SESSION_DIR,
    ensureDirectoriesExist,
    getSessionDataFilePath,
    log
};

