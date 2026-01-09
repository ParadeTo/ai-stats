const fs = require('fs');
const { getSessionDataFilePath, log } = require('./config');

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
 * 添加 AI 编辑记录到 session（包含精确的编辑内容）
 * @param {string} generationId - 生成 ID
 * @param {string} filePath - 文件路径
 * @param {Array} edits - AI 编辑内容数组 [{old_string, new_string}]
 */
function addFileEdit(generationId, filePath, edits = []) {
    try {
        const sessionFile = getSessionDataFilePath(generationId);
        let sessionData = {};
        
        if (fs.existsSync(sessionFile)) {
            sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        } else {
            sessionData = {
                generationId,
                timestamp: Date.now(),
                startTime: Math.floor(Date.now() / 1000),
            };
        }

        if (!sessionData.fileEdits) {
            sessionData.fileEdits = [];
        }

        // 记录每次编辑的详细信息
        sessionData.fileEdits.push({
            filePath,
            edits,
            timestamp: Date.now()
        });

        fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2), 'utf8');
        log(`addFileEdit: ${filePath} with ${edits.length} edits added to session ${generationId}`);
    } catch (error) {
        log(`addFileEdit failed: ${error.message}`);
    }
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
    loadSessionData,
    addFileEdit,
    clearSessionData
};

