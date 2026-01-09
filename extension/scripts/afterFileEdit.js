#!/usr/bin/env node

/**
 * afterFileEdit.js - Cursor AI 编辑文件后的钩子脚本
 * 职责：记录 AI 修改的文件路径，供 stop.js 使用
 * 
 * 注意：此钩子只在 AI 编辑文件时触发，用户手动编辑不会触发
 */

const { addFileEdit } = require('./utils/session');
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
            log('afterFileEdit: No input data received');
            process.exit(0);
        }

        const hookData = JSON.parse(inputData);
        const generationId = hookData?.generation_id;
        const filePath = hookData?.file_path;
        const edits = hookData?.edits || [];  // AI 修改的精确内容

        if (!generationId) {
            log('afterFileEdit: generation_id is missing');
            process.exit(0);
        }

        if (!filePath) {
            log('afterFileEdit: file_path is missing');
            process.exit(0);
        }

        log(`afterFileEdit: generationId=${generationId}, file_path=${filePath}, edits=${edits.length}`);

        // 记录 AI 编辑的精确内容到 session
        addFileEdit(generationId, filePath, edits);

        // 将输入数据写入日志文件以便调试
        try {
            ensureDirectoriesExist();
            let logObj = { logs: [] };
            
            if (fs.existsSync(CONFIG.HOOKS_INPUT_FILE)) {
                try {
                    const existing = JSON.parse(fs.readFileSync(CONFIG.HOOKS_INPUT_FILE, 'utf8'));
                    if (existing && Array.isArray(existing.logs)) {
                        logObj = existing;
                    }
                } catch (e) {
                    log(`afterFileEdit: Failed to parse hooks_input.json: ${e.message}`);
                }
            }

            logObj.logs.push({
                timestamp: new Date().toISOString(),
                hook: 'afterFileEdit',
                data: hookData
            });

            fs.writeFileSync(CONFIG.HOOKS_INPUT_FILE, JSON.stringify(logObj, null, 2), 'utf8');
        } catch (e) {
            log(`afterFileEdit: Failed to write hooks_input.json: ${e.message}`);
        }

        process.exit(0);
    } catch (error) {
        log(`afterFileEdit: Error - ${error.message}`);
        process.exit(0);
    }
}

main();

