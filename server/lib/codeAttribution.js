const crypto = require('crypto');
const path = require('path');

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
 * 规范化文件路径，提取相对路径部分
 * 处理绝对路径和相对路径的统一匹配
 */
function normalizeFilePath(filePath) {
    if (!filePath) return '';
    // 移除开头的 a/ 或 b/（git diff 格式）
    let normalized = filePath.replace(/^[ab]\//, '');
    // 如果是绝对路径，提取文件名
    if (path.isAbsolute(normalized)) {
        normalized = path.basename(normalized);
    }
    return normalized;
}

/**
 * 从 AI 生成记录中提取所有 AI 生成的行的哈希映射
 * @param {Array} rows - 数据库中的 task_records
 * @param {Object} zlib - zlib 模块
 * @param {Function} parseDiff - parse-diff 函数
 * @returns {Map} - AI 生成行的哈希映射，key=hash, value={timestamp, generation_id, count, occurrences, files}
 */
function buildAiLinesMap(rows, zlib, parseDiff) {
    const aiLinesMap = new Map();
    
    rows.forEach(row => {
        try {
            const buffer = Buffer.from(row.compressed_diff, 'base64');
            const decompressed = zlib.gunzipSync(buffer).toString('utf8');
            const files = parseDiff(decompressed);
            
            files.forEach(file => {
                const rawFilePath = file.to || file.from;
                if (!rawFilePath) return;
                const filePath = normalizeFilePath(rawFilePath);
                
                file.chunks.forEach(chunk => {
                    chunk.changes.forEach(change => {
                        if (change.type === 'add') {
                            const content = change.content.substring(1);
                            const hash = hashLine(content);
                            
                            if (!aiLinesMap.has(hash)) {
                                // 首次出现，创建新记录
                                aiLinesMap.set(hash, {
                                    timestamp: row.created_at,
                                    generation_id: row.generation_id,
                                    count: 1,
                                    occurrences: [{
                                        timestamp: row.created_at,
                                        generation_id: row.generation_id,
                                        filePath
                                    }],
                                    files: new Set([filePath])
                                });
                            } else {
                                // 已存在，增加计数
                                const existing = aiLinesMap.get(hash);
                                existing.count++;
                                existing.occurrences.push({
                                    timestamp: row.created_at,
                                    generation_id: row.generation_id,
                                    filePath
                                });
                                existing.files.add(filePath);
                                
                                // 保持 timestamp 为最早的生成时间
                                if (row.created_at < existing.timestamp) {
                                    existing.timestamp = row.created_at;
                                    existing.generation_id = row.generation_id;
                                }
                            }
                        }
                    });
                });
            });
        } catch (e) {
            // 忽略解析错误的记录
        }
    });
    
    return aiLinesMap;
}

/**
 * 从 AI 生成记录中提取所有 AI 删除的行的哈希映射
 * @param {Array} rows - 数据库中的 task_records
 * @param {Object} zlib - zlib 模块
 * @param {Function} parseDiff - parse-diff 函数
 * @returns {Map} - AI 删除行的哈希映射，key=hash, value={timestamp, generation_id, count, occurrences}
 */
function buildAiDeletesMap(rows, zlib, parseDiff) {
    const aiDeletesMap = new Map();
    
    rows.forEach(row => {
        try {
            const buffer = Buffer.from(row.compressed_diff, 'base64');
            const decompressed = zlib.gunzipSync(buffer).toString('utf8');
            const files = parseDiff(decompressed);
            
            files.forEach(file => {
                file.chunks.forEach(chunk => {
                    chunk.changes.forEach(change => {
                        if (change.type === 'del') {
                            const content = change.content.substring(1);
                            const hash = hashLine(content);
                            
                            if (!aiDeletesMap.has(hash)) {
                                // 首次出现，创建新记录
                                aiDeletesMap.set(hash, {
                                    timestamp: row.created_at,
                                    generation_id: row.generation_id,
                                    count: 1,
                                    occurrences: [{
                                        timestamp: row.created_at,
                                        generation_id: row.generation_id
                                    }]
                                });
                            } else {
                                // 已存在，增加计数
                                const existing = aiDeletesMap.get(hash);
                                existing.count++;
                                existing.occurrences.push({
                                    timestamp: row.created_at,
                                    generation_id: row.generation_id
                                });
                                
                                // 保持 timestamp 为最早的删除时间
                                if (row.created_at < existing.timestamp) {
                                    existing.timestamp = row.created_at;
                                    existing.generation_id = row.generation_id;
                                }
                            }
                        }
                    });
                });
            });
        } catch (e) {
            // 忽略解析错误的记录
        }
    });
    
    return aiDeletesMap;
}

/**
 * @deprecated 建议使用 buildAiLinesMap 代替。Map 提供更多信息（时间戳、generation_id）且完全兼容 Set 的 .has() 接口。
 * 向后兼容：从 Map 构建 Set（供不需要时间信息的场景使用）
 * @param {Array} rows - 数据库中的 task_records
 * @param {Object} zlib - zlib 模块
 * @param {Function} parseDiff - parse-diff 函数
 * @returns {Set} - AI 生成行的哈希集合
 */
function buildAiLinesSet(rows, zlib, parseDiff) {
    const aiLinesMap = buildAiLinesMap(rows, zlib, parseDiff);
    return new Set(aiLinesMap.keys());
}

/**
 * @deprecated 建议使用 buildAiDeletesMap 代替。Map 提供更多信息（时间戳、generation_id）且完全兼容 Set 的 .has() 接口。
 * 向后兼容：从 Map 构建 Set（供不需要时间信息的场景使用）
 * @param {Array} rows - 数据库中的 task_records
 * @param {Object} zlib - zlib 模块
 * @param {Function} parseDiff - parse-diff 函数
 * @returns {Set} - AI 删除行的哈希集合
 */
function buildAiDeletesSet(rows, zlib, parseDiff) {
    const aiDeletesMap = buildAiDeletesMap(rows, zlib, parseDiff);
    return new Set(aiDeletesMap.keys());
}

/**
 * 分析 commit range 内的代码归属
 * 区分：在当前 range 内 AI 添加的行 vs 在 range 外添加的行
 * @param {Object} diffFile - parse-diff 解析的文件对象
 * @param {Map} allAiLines - 所有历史 AI 生成行的详细信息 Map<hash, {timestamp, generation_id, files}>
 * @param {Map} allAiDeletes - 所有历史 AI 删除行的详细信息 Map<hash, {timestamp, generation_id}>（可选）
 * @returns {Object} - 包含变更列表和统计信息
 */
function analyzeCommitRangeDiff(diffFile, allAiLines, allAiDeletes = null) {
    const aiLinesInRange = new Set(); // 当前 range 内 AI 添加的行
    const changes = [];
    const stats = { added: 0, deleted: 0, ai_added: 0, ai_deleted: 0 };
    
    // 获取当前文件路径（规范化后的）
    const rawFilePath = diffFile.to || diffFile.from;
    const currentFilePath = normalizeFilePath(rawFilePath);

    // 第一遍：识别当前 range 内 AI 添加的行
    diffFile.chunks.forEach(chunk => {
        chunk.changes.forEach(change => {
            if (change.type === 'add') {
                const content = change.content.substring(1);
                const hash = hashLine(content);
                const aiInfo = allAiLines.get(hash);
                // 只有当 AI 在当前文件中生成过这行代码时，才算 AI 代码
                if (aiInfo && aiInfo.files && aiInfo.files.has(currentFilePath)) {
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
                const aiInfo = allAiLines.get(hash);
                // 只有当 AI 在当前文件中生成过这行代码时，才算 AI 代码
                const isAI = aiInfo && aiInfo.files && aiInfo.files.has(currentFilePath);
                if (isAI) stats.ai_added++;
                
                changes.push({
                    type: 'add',
                    lineNumber: change.ln,
                    content,
                    isAI
                });
            } else if (change.type === 'del') {
                stats.deleted++;
                
                // 删除判断逻辑保持不变
                let isAI;
                if (allAiDeletes !== null) {
                    isAI = allAiDeletes.has(hash);
                } else {
                    isAI = aiLinesInRange.has(hash);
                }
                
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
 * 分析完整文件的代码归属（基于内容哈希匹配，支持时间过滤和文件路径过滤）
 * @param {Array} lines - 文件的所有行
 * @param {Map} aiLines - AI 生成行的详细映射 Map<hash, {timestamp, generation_id, files}>
 * @param {Object} options - 可选配置
 * @param {string} options.fileTimestamp - 文件/代码的时间戳，用于时间过滤（ISO格式字符串）
 * @param {string} options.filePath - 当前文件路径，用于文件路径过滤（只有 AI 在该文件中生成过的代码才算 AI）
 * @returns {Object} - 包含逐行分析和统计
 */
function analyzeFileAttribution(lines, aiLines, options = {}) {
    const useTimeFilter = options.fileTimestamp && aiLines instanceof Map;
    const useFileFilter = options.filePath && aiLines instanceof Map;
    const normalizedFilePath = useFileFilter ? normalizeFilePath(options.filePath) : null;
    
    // 第一遍：统计每个 hash 在文件中出现的次数
    const hashCounts = new Map();
    lines.forEach(content => {
        const hash = hashLine(content);
        hashCounts.set(hash, (hashCounts.get(hash) || 0) + 1);
    });

    const analysis = lines.map((content, index) => {
        const lineNumber = index + 1;
        const hash = hashLine(content);
        let isAI = false;
        let generation_id = null;

        const aiInfo = aiLines.get(hash);
        if (aiInfo) {
            // 文件路径过滤：只有 AI 在当前文件中生成过这行代码才算 AI
            let fileMatch = true;
            if (useFileFilter && aiInfo.files) {
                fileMatch = aiInfo.files.has(normalizedFilePath);
            }
            
            if (fileMatch) {
                if (useTimeFilter) {
                    // 时间过滤：只有在该行代码时间之前生成的 AI 才算
                    isAI = aiInfo.timestamp <= options.fileTimestamp;
                } else {
                    isAI = true;
                }
                generation_id = aiInfo.generation_id;
            }
        }

        return {
            lineNumber,
            content,
            attribution: isAI ? 'ai' : 'human',
            generation_id
        };
    });

    const stats = {
        total_lines: lines.length,
        ai_lines: analysis.filter(a => a.attribution === 'ai').length,
        modified_lines: 0,
        human_lines: analysis.filter(a => a.attribution === 'human').length
    };
    
    // 检测重复代码：AI count vs 文件中实际出现次数
    const duplicateStats = {};
    let hasDuplicates = false;
    
    hashCounts.forEach((fileCount, hash) => {
        const aiInfo = aiLines.get(hash);
        if (aiInfo && aiInfo.count !== undefined) {
            const aiCount = aiInfo.count;
            
            // 只有当文件中出现次数 != AI 生成次数时才记录
            if (fileCount !== aiCount) {
                hasDuplicates = true;
                
                // 找到一个示例行
                const exampleLine = analysis.find(a => hashLine(a.content) === hash);
                
                duplicateStats[hash] = {
                    content: exampleLine ? exampleLine.content.trim() : '',
                    total_in_file: fileCount,
                    ai_count: aiCount,
                    estimated_ai_lines: Math.min(aiCount, fileCount),
                    estimated_human_lines: Math.max(0, fileCount - aiCount),
                    confidence: fileCount === 1 ? 'high' : (aiCount === 0 || aiCount === fileCount) ? 'high' : 'low',
                    note: fileCount > aiCount ? 
                        `文件中有 ${fileCount} 行此代码，AI 生成了 ${aiCount} 次，可能有 ${fileCount - aiCount} 行是人工编写` :
                        `文件中有 ${fileCount} 行此代码，AI 生成了 ${aiCount} 次，某些 AI 生成的代码可能已被删除`
                };
            }
        }
    });
    
    const result = { analysis, stats };
    
    // 如果有重复代码问题，添加警告和详细信息
    if (hasDuplicates) {
        result.duplicateStats = duplicateStats;
        result.warning = '⚠️  检测到重复代码，逐行归属可能不准确。请参考 duplicateStats 获取更准确的估算。';
    }

    return result;
}

module.exports = {
    hashLine,
    normalizeFilePath,
    buildAiLinesMap,
    buildAiDeletesMap,
    analyzeCommitRangeDiff,
    analyzeFileAttribution,
    // 废弃的函数，仅用于向后兼容测试
    buildAiLinesSet,
    buildAiDeletesSet
};

