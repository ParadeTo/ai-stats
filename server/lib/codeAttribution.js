const crypto = require('crypto');

/**
 * 计算行内容的哈希值（用于 AI 代码匹配）
 * 通过对去除空格后的内容进行 SHA256 哈希，生成唯一标识
 */
function hashLine(line) {
    return crypto.createHash('sha256')
        .update(line.trim())
        .digest('hex')
        .substring(0, 16);
}

/**
 * 从 AI 生成记录中提取所有 AI 生成的行的哈希集合
 * @param {Array} rows - 数据库中的 task_records
 * @param {Object} zlib - zlib 模块
 * @param {Function} parseDiff - parse-diff 函数
 * @returns {Set} - AI 生成行的哈希集合
 */
function buildAiLinesSet(rows, zlib, parseDiff) {
    const aiLinesSet = new Set();
    
    rows.forEach(row => {
        try {
            const buffer = Buffer.from(row.compressed_diff, 'base64');
            const decompressed = zlib.gunzipSync(buffer).toString('utf8');
            const files = parseDiff(decompressed);
            
            files.forEach(file => {
                file.chunks.forEach(chunk => {
                    chunk.changes.forEach(change => {
                        if (change.type === 'add') {
                            const content = change.content.substring(1); // 移除 + 前缀
                            aiLinesSet.add(hashLine(content));
                        }
                    });
                });
            });
        } catch (e) {
            // 忽略解析错误的记录
        }
    });
    
    return aiLinesSet;
}

/**
 * 分析 commit range 内的代码归属
 * 区分：在当前 range 内 AI 添加的行 vs 在 range 外添加的行
 * @param {Object} diffFile - parse-diff 解析的文件对象
 * @param {Set} allAiLines - 所有历史 AI 生成行的哈希
 * @returns {Object} - 包含变更列表和统计信息
 */
function analyzeCommitRangeDiff(diffFile, allAiLines) {
    const aiLinesInRange = new Set(); // 当前 range 内 AI 添加的行
    const changes = [];
    const stats = { added: 0, deleted: 0, ai_added: 0, ai_deleted: 0 };

    // 第一遍：识别当前 range 内 AI 添加的行
    diffFile.chunks.forEach(chunk => {
        chunk.changes.forEach(change => {
            if (change.type === 'add') {
                const content = change.content.substring(1);
                const hash = hashLine(content);
                if (allAiLines.has(hash)) {
                    aiLinesInRange.add(hash);
                }
            }
        });
    });

    // 第二遍：构建变更列表和统计
    diffFile.chunks.forEach(chunk => {
        chunk.changes.forEach(change => {
            const content = change.content.substring(1);
            const hash = hashLine(content);

            if (change.type === 'add') {
                stats.added++;
                const isAI = allAiLines.has(hash);
                if (isAI) stats.ai_added++;
                
                changes.push({
                    type: 'add',
                    lineNumber: change.ln,
                    content,
                    isAI
                });
            } else if (change.type === 'del') {
                stats.deleted++;
                // 删除的行只有在当前 range 内被 AI 添加才算 AI 删除
                const isAI = aiLinesInRange.has(hash);
                if (isAI) stats.ai_deleted++;
                
                changes.push({
                    type: 'del',
                    lineNumber: change.ln,
                    content,
                    isAI
                });
            } else if (change.type === 'normal') {
                changes.push({
                    type: 'normal',
                    lineNumber: change.ln1 || change.ln2,
                    content,
                    isAI: false
                });
            }
        });
    });

    return { changes, stats };
}

/**
 * 分析完整文件的代码归属（基于内容哈希匹配）
 * @param {Array} lines - 文件的所有行
 * @param {Set} aiLinesSet - AI 生成行的哈希集合
 * @returns {Object} - 包含逐行分析和统计
 */
function analyzeFileAttribution(lines, aiLinesSet) {
    const analysis = lines.map((content, index) => {
        const lineNumber = index + 1;
        const hash = hashLine(content);
        const isAI = aiLinesSet.has(hash);

        return {
            lineNumber,
            content,
            attribution: isAI ? 'ai' : 'human',
            generation_id: null // 简化版本，不追踪具体 generation_id
        };
    });

    const stats = {
        total_lines: lines.length,
        ai_lines: analysis.filter(a => a.attribution === 'ai').length,
        modified_lines: 0, // 简化版本
        human_lines: analysis.filter(a => a.attribution === 'human').length
    };

    return { analysis, stats };
}

module.exports = {
    hashLine,
    buildAiLinesSet,
    analyzeCommitRangeDiff,
    analyzeFileAttribution
};

