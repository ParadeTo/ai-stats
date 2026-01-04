#!/usr/bin/env node

/**
 * stop.js - Cursor AI 代码生成结束后的钩子脚本
 * 职责：捕获 Diff，压缩并上报至后端
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { execSync } = require('child_process');

// 配置
const CONFIG = {
    REPORT_URL: 'http://127.0.0.1:3001/api/create-task',  // 使用 127.0.0.1 而不是 localhost
    TIMEOUT: 5000,
    CONFIG_PATH: path.join(os.homedir(), '.ai-code-stats', 'config.json'),
    LOG_PATH: path.join(os.homedir(), '.ai-code-stats', 'debug.log')
};

function log(message) {
    const logDir = path.dirname(CONFIG.LOG_PATH);
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(CONFIG.LOG_PATH, `${new Date().toISOString()} - ${message}\n`);
}

async function main() {
    try {
        log('Hook triggered');
        
        // 0. 先读取 Cursor 传入的元数据（包含 workspace_roots）
        const cursorData = await readStdin();
        let metadata = {};
        let workspaceRoot = process.cwd(); // fallback
        
        try {
            if (cursorData) {
                metadata = JSON.parse(cursorData);
                log(`Received metadata: ${JSON.stringify(metadata)}`);
                
                // Cursor 会在 workspace_roots 中传入项目根目录
                if (metadata.workspace_roots && metadata.workspace_roots.length > 0) {
                    workspaceRoot = metadata.workspace_roots[0];
                    log(`Using workspace root from Cursor: ${workspaceRoot}`);
                } else {
                    log(`Warning: No workspace_roots in metadata, using cwd: ${workspaceRoot}`);
                }
            } else {
                log('Warning: No stdin data received from Cursor');
            }
        } catch (e) {
            log(`Failed to parse Cursor metadata: ${e.message}`);
        }
        
        // 1. 检查登录状态
        const token = getAuthToken();
        const userId = token ? 'user_from_token' : 'anonymous';

        // 2. 获取完整的 Git Diff (使用正确的工作区目录)
        const compressedDiff = getCompressedGitDiff(workspaceRoot);
        if (!compressedDiff) {
            log('No diff changes found, skipping report');
            return;
        }

        // 3. 获取 Git 上下文
        const gitContext = getGitContext(workspaceRoot);

        // 4. 构建上报负载
        const payload = {
            generation_id: metadata.generation_id || `gen-${Date.now()}`,
            user_id: userId,
            repo_url: gitContext.repoUrl, // 规范化后的远程仓库 URL
            branch_name: gitContext.branch,
            conversation_id: metadata.conversation_id,
            model: metadata.model || process.env.CURSOR_MODEL || 'unknown',
            compressed_diff: compressedDiff,
            task_type: 'adhoc',
            // 可选：同时保存原始 remote URL，便于调试
            raw_repo_url: gitContext.rawRepoUrl !== gitContext.repoUrl ? gitContext.rawRepoUrl : undefined
        };

        // 记录 payload 详情（不包括压缩后的 diff，因为太长）
        log(`Payload prepared:
  - generation_id: ${payload.generation_id}
  - user_id: ${payload.user_id}
  - repo_url: ${payload.repo_url}${payload.raw_repo_url ? ` (normalized from: ${payload.raw_repo_url})` : ''}
  - branch_name: ${payload.branch_name}
  - conversation_id: ${payload.conversation_id}
  - model: ${payload.model}
  - task_type: ${payload.task_type}
  - compressed_diff_length: ${compressedDiff.length} chars`);

        // 保存完整 payload 到文件，供测试使用
        try {
            const payloadPath = path.join(os.homedir(), '.ai-code-stats', 'last_payload.json');
            fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
            log(`Full payload saved to: ${payloadPath}`);
        } catch (e) {
            log(`Failed to save payload: ${e.message}`);
        }

        // 5. 异步上报
        reportData(payload, token);

    } catch (error) {
        log(`Error: ${error.message}\n${error.stack}`);
    }
}

/**
 * 获取压缩后的 Git Diff
 */
function getCompressedGitDiff(cwd) {
    try {
        log(`getCompressedGitDiff in ${cwd}`);
        
        // 1. 获取未跟踪文件并临时标记为 -N (intent-to-add)
        const statusOutput = execSync('git status --porcelain', { 
            cwd, 
            encoding: 'utf8',
            maxBuffer: 100 * 1024 * 1024 // 100MB
        });
        const untrackedFiles = statusOutput
            .split('\n')
            .filter(line => line.startsWith('??'))
            .map(line => line.substring(3).trim())
            .filter(file => {
                // 过滤掉不应该跟踪的大文件/目录
                const ignorePatterns = ['node_modules/', 'dist/', 'build/', '.next/', 'out/', '.git/'];
                return !ignorePatterns.some(pattern => file.includes(pattern));
            });

        if (untrackedFiles.length > 0) {
            log(`Adding ${untrackedFiles.length} untracked files`);
            untrackedFiles.forEach(file => {
                try {
                    execSync(`git add -N "${file}"`, { cwd });
                } catch (e) {
                    log(`Failed to add file ${file}: ${e.message}`);
                }
            });
        }

        // 2. 获取完整 diff (HEAD vs 工作区)，排除 node_modules 等大目录
        const diff = execSync('git diff -- . ":(exclude)node_modules" ":(exclude)dist" ":(exclude)build" ":(exclude).next" ":(exclude)out"', { 
            cwd, 
            encoding: 'utf8',
            maxBuffer: 100 * 1024 * 1024 // 增加到 100MB
        });

        // 3. 恢复未跟踪文件的状态
        if (untrackedFiles.length > 0) {
            untrackedFiles.forEach(file => {
                try {
                    execSync(`git reset "${file}"`, { cwd });
                } catch (e) {
                    // 静默失败
                }
            });
        }

        if (!diff.trim()) {
            log('Diff is empty after filtering');
            return null;
        }

        // 4. Gzip 压缩并转 Base64
        const compressed = zlib.gzipSync(Buffer.from(diff, 'utf8'));
        const base64 = compressed.toString('base64');
        log(`Diff compressed: ${diff.length} bytes -> ${base64.length} chars (ratio: ${(base64.length/diff.length*100).toFixed(1)}%)`);
        return base64;

    } catch (e) {
        log(`Git diff error: ${e.message}`);
        return null;
    }
}

/**
 * 从 Stdin 读取流数据
 */
function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => data += chunk);
        process.stdin.on('end', () => resolve(data));
        // 设置较短超时，因为钩子需要快速完成
        setTimeout(() => resolve(data), 500);
    });
}

/**
 * 规范化 Git 仓库 URL
 * 将 SSH 格式 (git@github.com:owner/repo.git) 转换为 HTTPS 格式 (https://github.com/owner/repo.git)
 */
function normalizeRepoUrl(url) {
    if (!url || url === 'unknown') {
        return url;
    }
    
    // 如果已经是 HTTPS 格式，直接返回
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }
    
    // 处理 SSH 格式：git@github.com:owner/repo.git
    const sshMatch = url.match(/git@([^:]+):(.+)/);
    if (sshMatch) {
        const host = sshMatch[1];
        const path = sshMatch[2];
        // 将常见 Git 托管平台的 SSH 格式转换为 HTTPS
        if (host.includes('github.com')) {
            return `https://github.com/${path}`;
        } else if (host.includes('gitlab.com')) {
            return `https://gitlab.com/${path}`;
        } else if (host.includes('bitbucket.org')) {
            return `https://bitbucket.org/${path}`;
        } else {
            // 其他 Git 服务器，尝试转换为 HTTPS
            return `https://${host}/${path}`;
        }
    }
    
    // 如果无法识别格式，返回原值
    return url;
}

/**
 * 获取 Git 仓库相关元数据
 */
function getGitContext(cwd) {
    try {
        const rawRepoUrl = execSync('git config --get remote.origin.url', { cwd, encoding: 'utf8' }).trim();
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim();
        
        // 规范化仓库 URL
        const repoUrl = normalizeRepoUrl(rawRepoUrl);
        
        log(`Git context: raw_repo=${rawRepoUrl}, normalized_repo=${repoUrl}, branch=${branch}`);
        return { repoUrl, branch, rawRepoUrl };
    } catch (e) {
        log(`Git context error: ${e.message}`);
        return { repoUrl: 'unknown', branch: 'unknown', rawRepoUrl: 'unknown' };
    }
}

/**
 * 从本地配置文件读取 Access Token
 */
function getAuthToken() {
    try {
        if (fs.existsSync(CONFIG.CONFIG_PATH)) {
            const config = JSON.parse(fs.readFileSync(CONFIG.CONFIG_PATH, 'utf8'));
            return config.token || null;
        }
    } catch (e) {
        return null;
    }
    return null;
}

/**
 * 上报数据
 */
function reportData(payload, token) {
    const data = JSON.stringify(payload);
    log(`Preparing to send data (${data.length} bytes)`);
    
    const url = new URL(CONFIG.REPORT_URL);

    const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
            'Authorization': token ? `Bearer ${token}` : ''
        },
        timeout: CONFIG.TIMEOUT
    };

    log(`Sending POST to ${url.hostname}:${url.port}${url.pathname}`);

    const req = http.request(options);
    
    req.on('error', (e) => {
        log(`Report failed: ${e.message}`);
    });

    req.on('response', (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
            log(`Report response [${res.statusCode}]: ${responseData}`);
        });
    });

    req.write(data);
    req.end();
    log('Report request sent');
}

main();
