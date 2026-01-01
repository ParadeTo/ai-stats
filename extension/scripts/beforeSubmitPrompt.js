#!/usr/bin/env node

/**
 * beforeSubmitPrompt.js - Cursor AI 提交 Prompt 前的钩子脚本
 * 职责：初始化 session，记录 generation_id 和 prompt
 */

const { initSessionData } = require('./utils/session');
const { log, ensureDirectoriesExist, CONFIG } = require('./utils/config');
const fs = require('fs');

/**
 * 从 Stdin 读取流数据
 */
function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => data += chunk);
        process.stdin.on('end', () => resolve(data));
        setTimeout(() => resolve(data), 1000);
    });
}

async function main() {
    try {
        const inputData = await readStdin();
        
        if (!inputData) {
            log('beforeSubmitPrompt: No input data received');
            process.exit(0);
        }

        const hookData = JSON.parse(inputData);
        const generationId = hookData?.generation_id;
        const prompt = hookData?.prompt;

        if (!generationId) {
            log('beforeSubmitPrompt: generation_id is missing');
            process.exit(0);
        }

        log(`beforeSubmitPrompt: generationId=${generationId}, prompt length=${prompt?.length || 0}`);

        // 初始化 session 数据
        initSessionData(generationId, prompt);

        // 将输入数据写入日志文件以便调试
        try {
            ensureDirectoriesExist();
            let logObj = { logs: [] };
            
            if (fs.existsSync(CONFIG.HOOKS_INPUT_FILE)) {
                try {
                    const existing = JSON.parse(fs.readFileSync(CONFIG.HOOKS_INPUT_FILE, 'utf8'));
                    if (existing && Array.isArray(existing.logs)) {
                        logObj = existing;
                        
                        // 清理 3 天前的数据
                        const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
                        logObj.logs = logObj.logs.filter(log => {
                            if (!log.timestamp) return true;
                            try {
                                return new Date(log.timestamp).getTime() > threeDaysAgo;
                            } catch (e) {
                                return true;
                            }
                        });
                    }
                } catch (e) {
                    log(`beforeSubmitPrompt: Failed to parse hooks_input.json: ${e.message}`);
                }
            }

            logObj.logs.push({
                timestamp: new Date().toISOString(),
                hook: 'beforeSubmitPrompt',
                data: hookData
            });

            fs.writeFileSync(CONFIG.HOOKS_INPUT_FILE, JSON.stringify(logObj, null, 2), 'utf8');
        } catch (e) {
            log(`beforeSubmitPrompt: Failed to write hooks_input.json: ${e.message}`);
        }

        process.exit(0);
    } catch (error) {
        log(`beforeSubmitPrompt: Error - ${error.message}`);
        process.exit(0);
    }
}

main();

