const {
    hashLine,
    buildAiLinesMap,
    buildAiDeletesMap,
    analyzeCommitRangeDiff,
    analyzeFileAttribution
} = require('../lib/codeAttribution');
const zlib = require('zlib');
const parseDiff = require('parse-diff');

// 辅助函数：将旧的 rows 格式自动补充时间戳和 generation_id
function normalizeRows(rows) {
    return rows.map((row, index) => ({
        compressed_diff: row.compressed_diff,
        created_at: row.created_at || `2024-01-01T${String(index).padStart(2, '0')}:00:00Z`,
        generation_id: row.generation_id || `gen-${index + 1}`
    }));
}

describe('codeAttribution - 核心算法测试', () => {
    
    describe('hashLine', () => {
        it('应该对相同内容生成相同的哈希', () => {
            const line = 'function test() {';
            const hash1 = hashLine(line);
            const hash2 = hashLine(line);
            expect(hash1).toBe(hash2);
        });

        it('应该忽略前后空格', () => {
            const hash1 = hashLine('  function test()  ');
            const hash2 = hashLine('function test()');
            expect(hash1).toBe(hash2);
        });

        it('应该对不同内容生成不同的哈希', () => {
            const hash1 = hashLine('function test() {');
            const hash2 = hashLine('function test2() {');
            expect(hash1).not.toBe(hash2);
        });

        it('应该返回16字符的哈希', () => {
            const hash = hashLine('test');
            expect(hash).toHaveLength(16);
        });

        it('应该处理空行', () => {
            const hash = hashLine('');
            expect(hash).toHaveLength(16);
        });
    });

    describe('buildAiLinesMap', () => {
        it('应该构建包含时间戳的 Map', () => {
            const diff = `diff --git a/test.js b/test.js
@@ -1,1 +1,2 @@
 line1
+line2`;
            
            const compressed = zlib.gzipSync(Buffer.from(diff)).toString('base64');
            const rows = [{
                compressed_diff: compressed,
                created_at: '2024-01-01T10:00:00Z',
                generation_id: 'gen-123'
            }];

            const aiLinesMap = buildAiLinesMap(rows, zlib, parseDiff);
            
            expect(aiLinesMap).toBeInstanceOf(Map);
            expect(aiLinesMap.size).toBe(1);
            
            const hash = hashLine('line2');
            expect(aiLinesMap.has(hash)).toBe(true);
            
            const info = aiLinesMap.get(hash);
            expect(info.timestamp).toBe('2024-01-01T10:00:00Z');
            expect(info.generation_id).toBe('gen-123');
        });

        it('应该只保存最早的 AI 生成记录，并统计出现次数', () => {
            const diff1 = `diff --git a/test.js b/test.js
@@ -0,0 +1,1 @@
+console.log('hello');`;
            
            const diff2 = `diff --git a/test.js b/test.js
@@ -0,0 +1,1 @@
+console.log('hello');`;
            
            const compressed1 = zlib.gzipSync(Buffer.from(diff1)).toString('base64');
            const compressed2 = zlib.gzipSync(Buffer.from(diff2)).toString('base64');
            
            const rows = [
                {
                    compressed_diff: compressed1,
                    created_at: '2024-01-02T10:00:00Z',
                    generation_id: 'gen-2'
                },
                {
                    compressed_diff: compressed2,
                    created_at: '2024-01-01T10:00:00Z',  // 更早
                    generation_id: 'gen-1'
                }
            ];

            const aiLinesMap = buildAiLinesMap(rows, zlib, parseDiff);
            const hash = hashLine("console.log('hello');");
            const info = aiLinesMap.get(hash);
            
            // 应该保存最早的时间戳（gen-1，2024-01-01）
            expect(info.generation_id).toBe('gen-1');
            expect(info.timestamp).toBe('2024-01-01T10:00:00Z');
            
            // 应该记录出现次数
            expect(info.count).toBe(2);
            expect(info.occurrences.length).toBe(2);
            expect(info.occurrences[0].generation_id).toBe('gen-2');
            expect(info.occurrences[1].generation_id).toBe('gen-1');
        });
    });

    describe('analyzeCommitRangeDiff', () => {
        it('应该正确识别 AI 新增的行', () => {
            const diffFile = {
                chunks: [{
                    changes: [
                        { type: 'normal', ln1: 1, ln2: 1, content: ' function test() {' },
                        { type: 'add', ln: 2, content: '+    console.log("AI line");' },
                        { type: 'normal', ln1: 2, ln2: 3, content: ' }' }
                    ]
                }]
            };

            const allAiLines = new Set([
                hashLine('console.log("AI line");')
            ]);

            const result = analyzeCommitRangeDiff(diffFile, allAiLines);

            expect(result.stats.added).toBe(1);
            expect(result.stats.ai_added).toBe(1);
            expect(result.changes).toHaveLength(3);
            expect(result.changes[1].isAI).toBe(true);
        });

        it('应该区分 range 内外的 AI 删除', () => {
            const diffFile = {
                chunks: [{
                    changes: [
                        { type: 'del', ln: 1, content: '-    console.log("old AI");' },
                        { type: 'add', ln: 1, content: '+    console.log("new AI");' }
                    ]
                }]
            };

            // 两行都在历史 AI 记录中
            const allAiLines = new Set([
                hashLine('console.log("old AI");'),
                hashLine('console.log("new AI");')
            ]);

            const result = analyzeCommitRangeDiff(diffFile, allAiLines);

            // 删除的行在 range 外被 AI 添加，所以不算 AI 删除
            // 只有在当前 range 内被 AI 添加的行被删除才算 AI 删除
            expect(result.stats.deleted).toBe(1);
            expect(result.stats.ai_deleted).toBe(0); // 关键：不算 AI 删除
            expect(result.stats.added).toBe(1);
            expect(result.stats.ai_added).toBe(1);
        });

        it('应该正确标记人工添加的行', () => {
            const diffFile = {
                chunks: [{
                    changes: [
                        { type: 'add', ln: 1, content: '+    // manual comment' }
                    ]
                }]
            };

            const allAiLines = new Set(); // 空集合，表示没有 AI 记录

            const result = analyzeCommitRangeDiff(diffFile, allAiLines);

            expect(result.stats.added).toBe(1);
            expect(result.stats.ai_added).toBe(0);
            expect(result.changes[0].isAI).toBe(false);
        });

        it('应该处理上下文行', () => {
            const diffFile = {
                chunks: [{
                    changes: [
                        { type: 'normal', ln1: 1, ln2: 1, content: ' context line 1' },
                        { type: 'add', ln: 2, content: '+ new line' },
                        { type: 'normal', ln1: 2, ln2: 3, content: ' context line 2' }
                    ]
                }]
            };

            const allAiLines = new Set();
            const result = analyzeCommitRangeDiff(diffFile, allAiLines);

            expect(result.changes).toHaveLength(3);
            expect(result.changes[0].type).toBe('normal');
            expect(result.changes[0].isAI).toBe(false);
        });

        it('应该支持 AI 删除识别（新逻辑：只要 AI 删除过就算）', () => {
            // AI 在历史上删除了某些行
            const aiDiff = `diff --git a/test.js b/test.js
@@ -1,3 +1,1 @@
 function test() {
-    console.log('debug');
-    return null;
 }`;
            
            const compressed = zlib.gzipSync(Buffer.from(aiDiff)).toString('base64');
            const rows = [{ compressed_diff: compressed }];

            // 构建 AI 删除知识库
            const allAiDeletes = buildAiDeletesMap(normalizeRows(rows), zlib, parseDiff);
            
            // 验证 AI 删除的行被正确提取
            expect(allAiDeletes.has(hashLine("console.log('debug');"))).toBe(true);
            expect(allAiDeletes.has(hashLine('return null;'))).toBe(true);

            // 当前 diff 也删除了相同的行
            const currentDiff = `diff --git a/test.js b/test.js
@@ -1,3 +1,1 @@
 function test() {
-    console.log('debug');
-    return null;
 }`;
            
            const currentFile = parseDiff(currentDiff)[0];
            const allAiLines = new Set(); // 没有 AI 添加记录
            
            // 使用新逻辑：传入 allAiDeletes
            const result = analyzeCommitRangeDiff(currentFile, allAiLines, allAiDeletes);

            // 验证：即使不是在 range 内添加的，只要 AI 曾删除过，就算 AI 删除
            expect(result.stats.deleted).toBe(2);
            expect(result.stats.ai_deleted).toBe(2); // 关键：应该识别为 AI 删除
            
            expect(result.changes.filter(c => c.type === 'del' && c.isAI).length).toBe(2);
        });

        it('应该保持旧逻辑的向后兼容性（不传 allAiDeletes）', () => {
            // 如果不传 allAiDeletes，应该使用旧逻辑
            const diffFile = {
                chunks: [{
                    changes: [
                        { type: 'del', ln: 1, content: '-    console.log("old AI");' }
                    ]
                }]
            };

            const allAiLines = new Set([hashLine('console.log("old AI");')]);

            // 不传 allAiDeletes，使用旧逻辑
            const result = analyzeCommitRangeDiff(diffFile, allAiLines);

            // 旧逻辑：不在 range 内添加的，不算 AI 删除
            expect(result.stats.deleted).toBe(1);
            expect(result.stats.ai_deleted).toBe(0);
        });
    });

    describe('analyzeFileAttribution', () => {
        it('应该正确标记 AI 生成的行', () => {
            const lines = [
                'function test() {',
                '    console.log("AI line");',
                '    return true;',
                '}'
            ];

            const aiLinesMap = new Map([
                [hashLine('console.log("AI line");'), { timestamp: '2024-01-01T10:00:00Z', generation_id: 'gen-1' }],
                [hashLine('return true;'), { timestamp: '2024-01-01T10:00:00Z', generation_id: 'gen-1' }]
            ]);

            const result = analyzeFileAttribution(lines, aiLinesMap);

            expect(result.stats.total_lines).toBe(4);
            expect(result.stats.ai_lines).toBe(2);
            expect(result.stats.human_lines).toBe(2);
            
            expect(result.analysis[0].attribution).toBe('human');
            expect(result.analysis[1].attribution).toBe('ai');
            expect(result.analysis[2].attribution).toBe('ai');
            expect(result.analysis[3].attribution).toBe('human');
        });

        it('应该处理完全由 AI 生成的文件', () => {
            const lines = ['line1', 'line2', 'line3'];
            const aiLinesMap = new Map(lines.map(line => 
                [hashLine(line), { timestamp: '2024-01-01T10:00:00Z', generation_id: 'gen-1' }]
            ));

            const result = analyzeFileAttribution(lines, aiLinesMap);

            expect(result.stats.ai_lines).toBe(3);
            expect(result.stats.human_lines).toBe(0);
        });

        it('应该处理完全由人工编写的文件', () => {
            const lines = ['line1', 'line2', 'line3'];
            const aiLinesMap = new Map();

            const result = analyzeFileAttribution(lines, aiLinesMap);

            expect(result.stats.ai_lines).toBe(0);
            expect(result.stats.human_lines).toBe(3);
        });

        it('应该处理空文件', () => {
            const lines = [];
            const aiLinesMap = new Map();

            const result = analyzeFileAttribution(lines, aiLinesMap);

            expect(result.stats.total_lines).toBe(0);
            expect(result.stats.ai_lines).toBe(0);
            expect(result.stats.human_lines).toBe(0);
        });

        it('应该支持使用 Map 进行分析', () => {
            const lines = [
                'function test() {',
                '    console.log("AI line");',
                '    return true;',
                '}'
            ];

            const aiLinesMap = new Map([
                [hashLine('console.log("AI line");'), { timestamp: '2024-01-01', generation_id: 'gen-1' }],
                [hashLine('return true;'), { timestamp: '2024-01-02', generation_id: 'gen-2' }]
            ]);

            const result = analyzeFileAttribution(lines, aiLinesMap);

            expect(result.stats.total_lines).toBe(4);
            expect(result.stats.ai_lines).toBe(2);
            expect(result.stats.human_lines).toBe(2);
            
            expect(result.analysis[1].attribution).toBe('ai');
            expect(result.analysis[1].generation_id).toBe('gen-1');
            expect(result.analysis[2].attribution).toBe('ai');
            expect(result.analysis[2].generation_id).toBe('gen-2');
        });

        it('应该支持时间过滤：只识别在代码时间之前的 AI', () => {
            // 场景：人工在 Day 1 写了代码，AI 在 Day 2 生成了相同代码
            // 使用时间过滤后，Day 1 的代码不应该被标记为 AI
            
            const lines = [
                'console.log("hello");',  // Day 1 写的
                'return null;'            // Day 1 写的
            ];

            const aiLinesMap = new Map([
                // AI 在 Day 2 生成了相同的代码
                [hashLine('console.log("hello");'), { 
                    timestamp: '2024-01-02T10:00:00Z', 
                    generation_id: 'gen-1' 
                }],
                [hashLine('return null;'), { 
                    timestamp: '2024-01-02T10:00:00Z', 
                    generation_id: 'gen-2' 
                }]
            ]);

            // Day 1 的代码时间戳
            const fileTimestamp = '2024-01-01T10:00:00Z';
            
            const result = analyzeFileAttribution(lines, aiLinesMap, { fileTimestamp });

            // 由于 AI 生成时间 (Day 2) > 代码时间 (Day 1)，不应该标记为 AI
            expect(result.stats.ai_lines).toBe(0);
            expect(result.stats.human_lines).toBe(2);
            
            expect(result.analysis[0].attribution).toBe('human');
            expect(result.analysis[1].attribution).toBe('human');
        });

        it('应该支持时间过滤：正确识别在代码时间之后的人工代码', () => {
            // 场景：AI 在 Day 1 生成了代码，人工在 Day 2 手动添加了相同代码
            // 使用时间过滤后，Day 2 的代码仍应该被标记为 AI（因为 AI 时间 < 代码时间）
            
            const lines = [
                'console.log("hello");',  // Day 2 手动添加的
                'return null;'            // Day 2 手动添加的
            ];

            const aiLinesMap = new Map([
                // AI 在 Day 1 就生成了这些代码
                [hashLine('console.log("hello");'), { 
                    timestamp: '2024-01-01T10:00:00Z', 
                    generation_id: 'gen-1' 
                }],
                [hashLine('return null;'), { 
                    timestamp: '2024-01-01T10:00:00Z', 
                    generation_id: 'gen-2' 
                }]
            ]);

            // Day 2 的代码时间戳
            const fileTimestamp = '2024-01-02T10:00:00Z';
            
            const result = analyzeFileAttribution(lines, aiLinesMap, { fileTimestamp });

            // 由于 AI 生成时间 (Day 1) < 代码时间 (Day 2)，应该标记为 AI
            expect(result.stats.ai_lines).toBe(2);
            expect(result.stats.human_lines).toBe(0);
            
            expect(result.analysis[0].attribution).toBe('ai');
            expect(result.analysis[1].attribution).toBe('ai');
        });

        it('应该在不提供时间戳时保持向后兼容（Map）', () => {
            // 不提供时间戳时，应该表现得像旧逻辑一样
            const lines = ['console.log("hello");'];
            const aiLinesMap = new Map([
                [hashLine('console.log("hello");'), { 
                    timestamp: '2024-01-01T10:00:00Z', 
                    generation_id: 'gen-1' 
                }]
            ]);

            // 不提供 fileTimestamp
            const result = analyzeFileAttribution(lines, aiLinesMap);

            // 应该识别为 AI（向后兼容）
            expect(result.stats.ai_lines).toBe(1);
            expect(result.analysis[0].attribution).toBe('ai');
        });
    });

    describe('集成测试：完整的代码归属流程', () => {
        it('应该正确处理一个完整的 AI 代码提交场景', () => {
            // 场景：AI 在 commit A 生成了代码，用户在 commit B 删除了其中一行
            
            // Step 1: AI 在 range 外生成的代码
            const historicalDiff = `diff --git a/utils.js b/utils.js
@@ -0,0 +1,3 @@
+function sleep(ms) {
+    return new Promise(resolve => setTimeout(resolve, ms));
+}`;
            
            const compressed = zlib.gzipSync(Buffer.from(historicalDiff)).toString('base64');
            const rows = [{ compressed_diff: compressed }];
            
            const allAiLines = buildAiLinesMap(normalizeRows(rows), zlib, parseDiff);
            
            // Step 2: 用户在当前 range 删除了一行
            const currentDiff = `diff --git a/utils.js b/utils.js
@@ -1,3 +1,2 @@
 function sleep(ms) {
-    return new Promise(resolve => setTimeout(resolve, ms));
 }`;
            
            const currentFile = parseDiff(currentDiff)[0];
            const result = analyzeCommitRangeDiff(currentFile, allAiLines);
            
            // 验证：删除的是 AI 生成的行，但删除操作是人工的
            expect(result.stats.deleted).toBe(1);
            expect(result.stats.ai_deleted).toBe(0); // 关键断言
            expect(result.changes.find(c => c.type === 'del').isAI).toBe(false);
        });

        it('应该识别"AI 生成 -> 人工删除 -> 人工重新添加相同内容"的场景', () => {
            // 场景描述：
            // Day 1: AI 生成了一行代码
            // Day 2: 用户手动删除了这行代码
            // Day 3: 用户又手动添加回完全相同的代码
            // 预期结果: Day 3 的代码仍然被识别为 AI 生成（因为内容哈希匹配）
            
            // Step 1: AI 在 Day 1 生成的代码（历史记录）
            const day1AiDiff = `diff --git a/api.js b/api.js
@@ -1,3 +1,4 @@
 function fetchData(url) {
+    const result = await fetch(url);
     return result.json();
 }`;
            
            const compressed = zlib.gzipSync(Buffer.from(day1AiDiff)).toString('base64');
            const rows = [{ compressed_diff: compressed }];
            
            // 构建 AI 知识库：包含 "const result = await fetch(url);" 的哈希
            const allAiLines = buildAiLinesMap(normalizeRows(rows), zlib, parseDiff);
            const targetLineHash = hashLine('const result = await fetch(url);');
            expect(allAiLines.has(targetLineHash)).toBe(true);
            
            // Step 2: Day 3 用户重新添加了完全相同的代码（在新的 commit range 中）
            const day3Diff = `diff --git a/api.js b/api.js
@@ -1,3 +1,4 @@
 function fetchData(url) {
+    const result = await fetch(url);
     return result.json();
 }`;
            
            const day3File = parseDiff(day3Diff)[0];
            const result = analyzeCommitRangeDiff(day3File, allAiLines);
            
            // 验证：即使是人工重新添加的，由于内容完全相同，仍被识别为 AI
            expect(result.stats.added).toBe(1);
            expect(result.stats.ai_added).toBe(1); // 关键断言：算作 AI 添加
            
            const addedLine = result.changes.find(c => c.type === 'add');
            expect(addedLine.isAI).toBe(true); // 标记为 AI 生成
            expect(addedLine.content.trim()).toBe('const result = await fetch(url);');
        });

        it('应该在 analyzeFileAttribution 中识别重新添加的 AI 代码', () => {
            // 场景：整个文件分析，包含历史 AI 生成的代码
            
            // Step 1: 历史上 AI 生成的代码
            const aiDiff = `diff --git a/utils.js b/utils.js
@@ -0,0 +1,5 @@
+function sleep(ms) {
+    return new Promise(resolve => setTimeout(resolve, ms));
+}
+
+async function delay(ms) { await sleep(ms); }`;
            
            const compressed = zlib.gzipSync(Buffer.from(aiDiff)).toString('base64');
            const aiLinesMap = buildAiLinesMap([{ compressed_diff: compressed, created_at: '2024-01-01T10:00:00Z', generation_id: 'gen-1' }], zlib, parseDiff);
            
            // Step 2: 当前文件内容（假设经过删除后又重新添加）
            // 注意：由于 hashLine 会 trim()，所以所有 AI 行都会被识别
            const currentFileLines = [
                'function sleep(ms) {',                                          // AI 生成（第1行）
                '    return new Promise(resolve => setTimeout(resolve, ms));',  // AI 生成（第2行）
                '}',                                                             // AI 生成（第3行）
                '',                                                              // AI 生成（空行）
                '// 这是新的人工注释',                                          // 人工编写
                'async function delay(ms) { await sleep(ms); }'                 // AI 生成（第5行）
            ];
            
            const result = analyzeFileAttribution(currentFileLines, aiLinesMap);
            
            // 验证统计结果
            // 注意：由于 AI diff 包含了所有5行，它们都会被识别为 AI
            expect(result.stats.total_lines).toBe(6);
            expect(result.stats.ai_lines).toBe(5); // 5行 AI 代码（除了人工注释）
            expect(result.stats.human_lines).toBe(1);
            
            // 验证具体行的归属
            expect(result.analysis[0].attribution).toBe('ai'); // function sleep...
            expect(result.analysis[1].attribution).toBe('ai'); // return new Promise...
            expect(result.analysis[4].attribution).toBe('human'); // 人工注释
            expect(result.analysis[5].attribution).toBe('ai'); // async function delay...
        });

        it('应该处理部分相同内容的场景', () => {
            // 场景：AI 生成了代码，用户修改了缩进或空格后重新添加
            
            // Step 1: AI 生成的代码（标准缩进）
            const aiDiff = `diff --git a/test.js b/test.js
@@ -0,0 +1,1 @@
+    console.log('test');`;
            
            const compressed = zlib.gzipSync(Buffer.from(aiDiff)).toString('base64');
            const allAiLines = buildAiLinesMap([{ compressed_diff: compressed, created_at: '2024-01-01T10:00:00Z', generation_id: 'gen-1' }], zlib, parseDiff);
            
            // Step 2: 用户重新添加时改变了缩进
            const userDiff = `diff --git a/test.js b/test.js
@@ -0,0 +1,2 @@
+  console.log('test');
+    console.log('new line');`;
            
            const userFile = parseDiff(userDiff)[0];
            const result = analyzeCommitRangeDiff(userFile, allAiLines);
            
            // 验证：由于 hashLine 会 trim()，缩进不同但内容相同的行仍被识别为 AI
            expect(result.stats.added).toBe(2);
            expect(result.stats.ai_added).toBe(1); // 第一行被识别为 AI（忽略缩进差异）
            
            expect(result.changes[0].content.trim()).toBe("console.log('test');");
            expect(result.changes[0].isAI).toBe(true);
            expect(result.changes[1].isAI).toBe(false); // 新行不是 AI
        });

        it('应该处理"多行相同代码，部分由 AI 生成，部分由人工生成"的场景', () => {
            // 场景说明：
            // 这是系统的一个已知限制：如果某行代码曾经被 AI 生成过，
            // 那么所有内容相同的行都会被标记为 AI，无法区分哪些是人工写的
            
            // Day 1: 人工写了 3 行 return null
            // Day 2: AI 在另一个地方也生成了 return null
            // 结果: 所有 return null 都会被标记为 AI
            
            // Step 1: AI 生成了 return null
            const aiDiff = `diff --git a/utils.js b/utils.js
@@ -1,1 +1,2 @@
 function aiGenerated() {
+    return null;
 }`;
            
            const compressed = zlib.gzipSync(Buffer.from(aiDiff)).toString('base64');
            const allAiLines = buildAiLinesMap([{ compressed_diff: compressed, created_at: '2024-01-01T10:00:00Z', generation_id: 'gen-1' }], zlib, parseDiff);
            
            // Step 2: 分析一个文件，其中包含多行 return null（有些是人工写的）
            const fileLines = [
                'function manualFunction1() {',
                '    return null;',  // 人工写的，但会被标记为 AI
                '}',
                '',
                'function manualFunction2() {',
                '    return null;',  // 人工写的，但会被标记为 AI
                '}',
                '',
                'function aiGenerated() {',
                '    return null;',  // 确实是 AI 生成的
                '}'
            ];
            
            const result = analyzeFileAttribution(fileLines, allAiLines);
            
            // 验证：系统无法区分哪些是人工写的，所有 return null 都被标记为 AI
            expect(result.stats.total_lines).toBe(11);
            expect(result.stats.ai_lines).toBe(3); // 3 个 return null 都被标记为 AI
            
            // 所有 return null 都被标记为 AI
            expect(result.analysis[1].content).toBe('    return null;');
            expect(result.analysis[1].attribution).toBe('ai'); // 实际是人工写的，但被误判
            
            expect(result.analysis[5].content).toBe('    return null;');
            expect(result.analysis[5].attribution).toBe('ai'); // 实际是人工写的，但被误判
            
            expect(result.analysis[9].content).toBe('    return null;');
            expect(result.analysis[9].attribution).toBe('ai'); // 这个确实是 AI 生成的
        });

        it('应该展示"先人工后 AI"场景下的误判', () => {
            // 更极端的场景：人工代码在前，AI 代码在后
            // Day 1 (commit A): 人工写了 console.log('hello')
            // Day 2 (commit B): AI 也生成了 console.log('hello')
            // 结果：Day 1 的人工代码会被追溯标记为 AI
            
            // 假设我们有一个历史文件，包含人工写的代码
            const manualLines = [
                'function manual() {',
                '    console.log("hello");',  // Day 1: 纯人工
                '    return true;'
            ];
            
            // Day 2: AI 生成了相同的代码
            const aiDiff = `diff --git a/ai.js b/ai.js
@@ -0,0 +1,2 @@
+function aiFunc() {
+    console.log("hello");`;
            
            const compressed = zlib.gzipSync(Buffer.from(aiDiff)).toString('base64');
            const allAiLines = buildAiLinesMap([{ compressed_diff: compressed, created_at: '2024-01-01T10:00:00Z', generation_id: 'gen-1' }], zlib, parseDiff);
            
            // 现在分析 Day 1 的文件，它完全是人工写的
            const result = analyzeFileAttribution(manualLines, allAiLines);
            
            // 验证：Day 1 的人工代码被错误地标记为 AI
            expect(result.stats.ai_lines).toBe(1); // console.log 被标记为 AI
            expect(result.stats.human_lines).toBe(2);
            
            expect(result.analysis[1].attribution).toBe('ai'); // 误判：实际是人工写的
        });

        it('应该展示常见代码模式的批量误判问题', () => {
            // 场景：常见的代码模式（如 return null, return false）
            // 这些代码可能在多处出现，只要有一处是 AI 生成，全部都会被标记为 AI
            
            // AI 生成了一些常见模式
            const aiDiff = `diff --git a/ai.js b/ai.js
@@ -0,0 +1,4 @@
+if (!data) {
+    return null;
+}
+return null;`;
            
            const compressed = zlib.gzipSync(Buffer.from(aiDiff)).toString('base64');
            const allAiLines = buildAiLinesMap([{ compressed_diff: compressed, created_at: '2024-01-01T10:00:00Z', generation_id: 'gen-1' }], zlib, parseDiff);
            
            // 验证 AI 知识库包含了这些模式
            expect(allAiLines.has(hashLine('if (!data) {'))).toBe(true);
            expect(allAiLines.has(hashLine('return null;'))).toBe(true);
            expect(allAiLines.has(hashLine('}'))).toBe(true);
            
            // 一个大文件，包含多处人工写的相同代码
            const fileLines = [
                'function check1() {',
                '    if (!data) {',      // 人工写的，但会被标记为 AI
                '        return null;',  // 人工写的，但会被标记为 AI
                '    }',                 // 人工写的，但会被标记为 AI
                '}',                     // 人工写的，但会被标记为 AI
                'function check2() {',
                '    if (!data) {',      // 人工写的，但会被标记为 AI
                '        return null;',  // 人工写的，但会被标记为 AI
                '    }',                 // 人工写的，但会被标记为 AI
                '}',                     // 人工写的，但会被标记为 AI
                'function check3() {',
                '    return null;',      // 人工写的，但会被标记为 AI
                '}'                      // 人工写的，但会被标记为 AI
            ];
            
            const result = analyzeFileAttribution(fileLines, allAiLines);
            
            // 几乎所有行都被标记为 AI（除了 function 声明）
            const aiCount = result.analysis.filter(line => line.attribution === 'ai').length;
            expect(aiCount).toBeGreaterThan(8); // 至少 8 行被误判为 AI
            
            // 这意味着对于常见代码模式，系统会大量误判
            const aiRatio = result.stats.ai_lines / result.stats.total_lines;
            expect(aiRatio).toBeGreaterThan(0.5); // 超过 50% 被标记为 AI
        });

        it('应该正确处理"AI 生成 -> 人工删除"的场景', () => {
            // 场景：AI 在 Commit A 生成了代码，人工在 Commit B 删除了
            // 查询 Commit A 到 Commit B 的 range
            
            // Step 1: AI 生成了代码
            const aiAddDiff = `diff --git a/utils.js b/utils.js
@@ -0,0 +1,3 @@
+function debug() {
+    console.log('AI generated debug code');
+}`;
            
            const compressed = zlib.gzipSync(Buffer.from(aiAddDiff)).toString('base64');
            const rows = [{ compressed_diff: compressed }];
            
            // 构建 AI 知识库
            const allAiLines = buildAiLinesMap(normalizeRows(rows), zlib, parseDiff);
            const allAiDeletes = buildAiDeletesMap(normalizeRows(rows), zlib, parseDiff);
            
            // 验证 AI 删除知识库（应该是空的，因为 AI 没有删除操作）
            expect(allAiDeletes.size).toBe(0);
            
            // Step 2: 人工删除 AI 生成的代码
            const humanDelDiff = `diff --git a/utils.js b/utils.js
@@ -1,3 +0,0 @@
-function debug() {
-    console.log('AI generated debug code');
-}`;
            
            const delFile = parseDiff(humanDelDiff)[0];
            const result = analyzeCommitRangeDiff(delFile, allAiLines, allAiDeletes);
            
            // 验证：人工删除 AI 代码，不算 AI 删除
            expect(result.stats.deleted).toBe(3);
            expect(result.stats.ai_deleted).toBe(0); // 关键：人工删除，不算 AI 删除
            
            // 所有删除的行都标记为非 AI
            const deletedChanges = result.changes.filter(c => c.type === 'del');
            expect(deletedChanges.length).toBe(3);
            deletedChanges.forEach(change => {
                expect(change.isAI).toBe(false); // 人工删除
            });
        });

        it('应该展示完整的 AI 生命周期统计', () => {
            // 完整场景：多次 AI 操作
            // Commit 1: AI 添加了 3 行
            // Commit 2: AI 删除了 1 行
            // Commit 3: 人工删除了另 1 行 AI 代码
            
            const aiAdd = `diff --git a/main.js b/main.js
@@ -0,0 +1,3 @@
+const a = 1;
+const b = 2;
+const c = 3;`;
            
            const aiDel = `diff --git a/main.js b/main.js
@@ -1,3 +1,2 @@
 const a = 1;
-const b = 2;
 const c = 3;`;
            
            const rows = [
                { compressed_diff: zlib.gzipSync(Buffer.from(aiAdd)).toString('base64') },
                { compressed_diff: zlib.gzipSync(Buffer.from(aiDel)).toString('base64') }
            ];
            
            const allAiLines = buildAiLinesMap(normalizeRows(rows), zlib, parseDiff);
            const allAiDeletes = buildAiDeletesMap(normalizeRows(rows), zlib, parseDiff);
            
            // 验证 AI 添加了 3 行
            expect(allAiLines.size).toBe(3);
            
            // 验证 AI 删除了 1 行
            expect(allAiDeletes.size).toBe(1);
            expect(allAiDeletes.has(hashLine('const b = 2;'))).toBe(true);
            
            // 场景 A: 人工删除了另一行 AI 代码（const c）
            const humanDelOtherLine = `diff --git a/main.js b/main.js
@@ -1,2 +1,1 @@
 const a = 1;
-const c = 3;`;
            
            const result1 = analyzeCommitRangeDiff(
                parseDiff(humanDelOtherLine)[0], 
                allAiLines, 
                allAiDeletes
            );
            
            // 人工删除的 AI 代码，不算 AI 删除（因为 AI 没删除过 const c）
            expect(result1.stats.deleted).toBe(1);
            expect(result1.stats.ai_deleted).toBe(0);
            
            // 场景 B: 如果删除的是 AI 之前删除过的那行（const b）
            const delSameLine = `diff --git a/main.js b/main.js
@@ -1,2 +1,1 @@
 const a = 1;
-const b = 2;`;
            
            const result2 = analyzeCommitRangeDiff(
                parseDiff(delSameLine)[0], 
                allAiLines, 
                allAiDeletes
            );
            
            // 因为 AI 删除过这行，所以算 AI 删除
            expect(result2.stats.deleted).toBe(1);
            expect(result2.stats.ai_deleted).toBe(1); // AI 删除过，算 AI 删除
        });

        it('应该正确处理"AI 删除 -> 人工添加回来"的场景', () => {
            // 场景：AI 删除了代码，然后人工又添加回来了相同的代码
            
            // Step 1: AI 删除了代码
            const aiDelDiff = `diff --git a/utils.js b/utils.js
@@ -1,3 +1,1 @@
 function test() {
-    console.log('important');
-    return true;
 }`;
            
            const compressed = zlib.gzipSync(Buffer.from(aiDelDiff)).toString('base64');
            const rows = [{ compressed_diff: compressed }];
            
            // 构建 AI 知识库
            const allAiLines = buildAiLinesMap(normalizeRows(rows), zlib, parseDiff);
            const allAiDeletes = buildAiDeletesMap(normalizeRows(rows), zlib, parseDiff);
            
            // 验证：AI 删除知识库应该包含这两行
            expect(allAiDeletes.size).toBe(2);
            expect(allAiDeletes.has(hashLine("console.log('important');"))).toBe(true);
            expect(allAiDeletes.has(hashLine('return true;'))).toBe(true);
            
            // 验证：AI 添加知识库应该是空的（因为 AI 只删除，没有添加）
            expect(allAiLines.size).toBe(0);
            
            // Step 2: 人工添加回来相同的代码
            const humanAddDiff = `diff --git a/utils.js b/utils.js
@@ -1,1 +1,3 @@
 function test() {
+    console.log('important');
+    return true;
 }`;
            
            const addFile = parseDiff(humanAddDiff)[0];
            const result = analyzeCommitRangeDiff(addFile, allAiLines, allAiDeletes);
            
            // 验证：人工添加，不算 AI 添加
            expect(result.stats.added).toBe(2);
            expect(result.stats.ai_added).toBe(0); // 关键：人工添加，不算 AI
            
            // 所有添加的行都标记为非 AI
            const addedChanges = result.changes.filter(c => c.type === 'add');
            expect(addedChanges.length).toBe(2);
            addedChanges.forEach(change => {
                expect(change.isAI).toBe(false); // 人工添加
            });
        });

        it('应该区分"AI 添加后删除"和"AI 删除后添加"的不同场景', () => {
            // 场景对比：
            // A. AI 添加 -> 删除：添加算 AI，删除情况复杂
            // B. AI 删除 -> 添加：删除算 AI，添加不算 AI
            
            // 场景 A: AI 添加了代码
            const aiAdd = `diff --git a/a.js b/a.js
@@ -0,0 +1,1 @@
+const x = 1;`;
            
            const rowsA = [{ compressed_diff: zlib.gzipSync(Buffer.from(aiAdd)).toString('base64') }];
            const aiLinesA = buildAiLinesMap(normalizeRows(rowsA), zlib, parseDiff);
            const aiDeletesA = buildAiDeletesMap(normalizeRows(rowsA), zlib, parseDiff);
            
            expect(aiLinesA.size).toBe(1); // AI 添加了 1 行
            expect(aiDeletesA.size).toBe(0); // AI 没有删除
            
            // 后续有人添加相同的代码
            const addSame = `diff --git a/a.js b/a.js
@@ -0,0 +1,1 @@
+const x = 1;`;
            
            const resultA = analyzeCommitRangeDiff(
                parseDiff(addSame)[0], 
                aiLinesA, 
                aiDeletesA
            );
            
            expect(resultA.stats.ai_added).toBe(1); // 会被识别为 AI 添加
            
            // 场景 B: AI 删除了代码
            const aiDel = `diff --git a/b.js b/b.js
@@ -1,1 +0,0 @@
-const y = 2;`;
            
            const rowsB = [{ compressed_diff: zlib.gzipSync(Buffer.from(aiDel)).toString('base64') }];
            const aiLinesB = buildAiLinesMap(normalizeRows(rowsB), zlib, parseDiff);
            const aiDeletesB = buildAiDeletesMap(normalizeRows(rowsB), zlib, parseDiff);
            
            expect(aiLinesB.size).toBe(0); // AI 没有添加
            expect(aiDeletesB.size).toBe(1); // AI 删除了 1 行
            
            // 后续有人添加相同的代码
            const addBack = `diff --git a/b.js b/b.js
@@ -0,0 +1,1 @@
+const y = 2;`;
            
            const resultB = analyzeCommitRangeDiff(
                parseDiff(addBack)[0], 
                aiLinesB, 
                aiDeletesB
            );
            
            expect(resultB.stats.ai_added).toBe(0); // 不会被识别为 AI 添加
        });

        it('应该展示 AI 删除的代码被人工恢复的完整流程', () => {
            // 真实场景：
            // Day 1: AI 错误地删除了重要代码
            // Day 2: 开发者发现问题，手动恢复了代码
            // Day 3: 再次分析，应该能看出这是人工恢复的
            
            // Day 1: AI 删除
            const aiMistake = `diff --git a/important.js b/important.js
@@ -1,5 +1,1 @@
 function critical() {
-    // Critical business logic
-    validateInput();
-    processData();
-    return result;
 }`;
            
            const rows = [{ compressed_diff: zlib.gzipSync(Buffer.from(aiMistake)).toString('base64') }];
            const allAiLines = buildAiLinesMap(normalizeRows(rows), zlib, parseDiff);
            const allAiDeletes = buildAiDeletesMap(normalizeRows(rows), zlib, parseDiff);
            
            // Day 2: 开发者恢复代码
            const humanRestore = `diff --git a/important.js b/important.js
@@ -1,1 +1,5 @@
 function critical() {
+    // Critical business logic
+    validateInput();
+    processData();
+    return result;
 }`;
            
            const restoreFile = parseDiff(humanRestore)[0];
            const result = analyzeCommitRangeDiff(restoreFile, allAiLines, allAiDeletes);
            
            // 验证：4 行都是人工恢复的
            expect(result.stats.added).toBe(4);
            expect(result.stats.ai_added).toBe(0); // 全部是人工恢复
            
            // Day 3: 查看文件，所有行都应该标记为人工编写
            const fileLines = [
                'function critical() {',
                '    // Critical business logic',
                '    validateInput();',
                '    processData();',
                '    return result;',
                '}'
            ];
            
            const fileResult = analyzeFileAttribution(fileLines, allAiLines);
            
            // 所有代码都标记为人工（因为 AI 只删除了，没有添加）
            expect(fileResult.stats.ai_lines).toBe(0);
            expect(fileResult.stats.human_lines).toBe(6);
        });

        it('应该正确处理"AI 添加 -> AI 删除 -> 人工添加回来"的场景', () => {
            // 场景：
            // Day 1: AI 添加了代码
            // Day 2: AI 又删除了这些代码
            // Day 3: 开发者发现需要，手动添加回来
            
            // Day 1: AI 添加
            const aiAdd = `diff --git a/feature.js b/feature.js
@@ -0,0 +1,3 @@
+function helper() {
+    return 42;
+}`;
            
            // Day 2: AI 删除
            const aiDelete = `diff --git a/feature.js b/feature.js
@@ -1,3 +0,0 @@
-function helper() {
-    return 42;
-}`;
            
            const rows = [
                { compressed_diff: zlib.gzipSync(Buffer.from(aiAdd)).toString('base64') },
                { compressed_diff: zlib.gzipSync(Buffer.from(aiDelete)).toString('base64') }
            ];
            
            // 构建 AI 知识库
            const allAiLines = buildAiLinesMap(normalizeRows(rows), zlib, parseDiff);
            const allAiDeletes = buildAiDeletesMap(normalizeRows(rows), zlib, parseDiff);
            
            // 验证知识库状态
            expect(allAiLines.size).toBe(3); // AI 添加了 3 行
            expect(allAiDeletes.size).toBe(3); // AI 删除了 3 行（同样的 3 行）
            
            // 验证：同样的代码同时在两个知识库中
            const line1Hash = hashLine('function helper() {');
            const line2Hash = hashLine('return 42;');
            const line3Hash = hashLine('}');
            
            expect(allAiLines.has(line1Hash)).toBe(true);
            expect(allAiDeletes.has(line1Hash)).toBe(true); // 同时存在！
            
            // Day 3: 开发者手动添加回来
            const humanReAdd = `diff --git a/feature.js b/feature.js
@@ -0,0 +1,3 @@
+function helper() {
+    return 42;
+}`;
            
            const reAddFile = parseDiff(humanReAdd)[0];
            const result = analyzeCommitRangeDiff(reAddFile, allAiLines, allAiDeletes);
            
            // 关键验证：即使是人工添加，也会被识别为 AI 添加
            // 因为这些代码的 hash 存在于 allAiLines 中
            expect(result.stats.added).toBe(3);
            expect(result.stats.ai_added).toBe(3); // 被识别为 AI 添加！
            
            // 所有添加的行都标记为 AI
            const addedChanges = result.changes.filter(c => c.type === 'add');
            expect(addedChanges.length).toBe(3);
            addedChanges.forEach(change => {
                expect(change.isAI).toBe(true); // 标记为 AI
            });
        });

        it('应该展示"AI 添加 -> AI 删除 -> 人工添加"和"AI 删除 -> 人工添加"的区别', () => {
            // 对比两种场景的差异
            
            // 场景 A: AI 先添加，后删除
            const aiAddThenDel = [
                { compressed_diff: zlib.gzipSync(Buffer.from(`diff --git a/a.js b/a.js
@@ -0,0 +1,1 @@
+const x = 1;`)).toString('base64') },
                { compressed_diff: zlib.gzipSync(Buffer.from(`diff --git a/a.js b/a.js
@@ -1,1 +0,0 @@
-const x = 1;`)).toString('base64') }
            ];
            
            const aiLinesA = buildAiLinesMap(normalizeRows(aiAddThenDel), zlib, parseDiff);
            const aiDeletesA = buildAiDeletesMap(normalizeRows(aiAddThenDel), zlib, parseDiff);
            
            expect(aiLinesA.size).toBe(1); // AI 添加了
            expect(aiDeletesA.size).toBe(1); // AI 也删除了
            
            // 人工添加回来
            const humanReAddA = parseDiff(`diff --git a/a.js b/a.js
@@ -0,0 +1,1 @@
+const x = 1;`)[0];
            
            const resultA = analyzeCommitRangeDiff(humanReAddA, aiLinesA, aiDeletesA);
            expect(resultA.stats.ai_added).toBe(1); // 被识别为 AI 添加
            
            // 场景 B: AI 只删除（从未添加过）
            const aiOnlyDel = [
                { compressed_diff: zlib.gzipSync(Buffer.from(`diff --git a/b.js b/b.js
@@ -1,1 +0,0 @@
-const y = 2;`)).toString('base64') }
            ];
            
            const aiLinesB = buildAiLinesMap(normalizeRows(aiOnlyDel), zlib, parseDiff);
            const aiDeletesB = buildAiDeletesMap(normalizeRows(aiOnlyDel), zlib, parseDiff);
            
            expect(aiLinesB.size).toBe(0); // AI 从未添加
            expect(aiDeletesB.size).toBe(1); // AI 删除了
            
            // 人工添加回来
            const humanReAddB = parseDiff(`diff --git a/b.js b/b.js
@@ -0,0 +1,1 @@
+const y = 2;`)[0];
            
            const resultB = analyzeCommitRangeDiff(humanReAddB, aiLinesB, aiDeletesB);
            expect(resultB.stats.ai_added).toBe(0); // 不被识别为 AI 添加
            
            // 对比结论
            console.log('场景 A (AI 添加->删除->人工添加): ai_added =', resultA.stats.ai_added); // 1
            console.log('场景 B (AI 删除->人工添加): ai_added =', resultB.stats.ai_added); // 0
        });

        it('应该展示"AI 添加 -> AI 删除 -> 人工添加"导致的统计问题', () => {
            // 真实场景：AI 反复修改导致的统计失真
            
            // Day 1: AI 第一版实现
            const aiV1 = `diff --git a/api.js b/api.js
@@ -0,0 +1,3 @@
+async function fetchData() {
+    return fetch('/api/data');
+}`;
            
            // Day 2: AI 重构，删除旧版
            const aiRefactor = `diff --git a/api.js b/api.js
@@ -1,3 +0,0 @@
-async function fetchData() {
-    return fetch('/api/data');
-}`;
            
            // Day 3: 开发者发现新版有问题，回滚到旧版
            const humanRollback = `diff --git a/api.js b/api.js
@@ -0,0 +1,3 @@
+async function fetchData() {
+    return fetch('/api/data');
+}`;
            
            const rows = [
                { compressed_diff: zlib.gzipSync(Buffer.from(aiV1)).toString('base64') },
                { compressed_diff: zlib.gzipSync(Buffer.from(aiRefactor)).toString('base64') }
            ];
            
            const allAiLines = buildAiLinesMap(normalizeRows(rows), zlib, parseDiff);
            const allAiDeletes = buildAiDeletesMap(normalizeRows(rows), zlib, parseDiff);
            
            // 人工回滚
            const rollbackFile = parseDiff(humanRollback)[0];
            const result = analyzeCommitRangeDiff(rollbackFile, allAiLines, allAiDeletes);
            
            // 问题：人工回滚被识别为 AI 添加
            expect(result.stats.added).toBe(3);
            expect(result.stats.ai_added).toBe(3); // 统计失真：实际是人工回滚
            
            // 最终文件分析
            const fileLines = [
                'async function fetchData() {',
                '    return fetch(\'/api/data\');',
                '}'
            ];
            
            const fileResult = analyzeFileAttribution(fileLines, allAiLines);
            
            // 所有代码都被标记为 AI（即使最后是人工恢复的）
            expect(fileResult.stats.ai_lines).toBe(3);
            expect(fileResult.stats.human_lines).toBe(0);
            
            // 这是已知的限制：内容相同就被视为 AI
            console.log('已知限制：人工回滚 AI 代码，仍被识别为 AI 代码');
        });

        it('应该正确处理"AI 添加一行 + 人工删除另一行相同代码"的场景（历史 AI）', () => {
            // 场景：文件中有多行相同的代码
            // 历史上：AI 在第 5 行添加了 console.log('debug');
            // 当前：人工删除了第 2 行的 console.log('debug');
            
            // 历史：AI 添加（不在当前 commit range）
            const historicalAiAdd = `diff --git a/app.js b/app.js
@@ -4,0 +5,1 @@
+console.log('debug');`;
            
            const rows = [
                { compressed_diff: zlib.gzipSync(Buffer.from(historicalAiAdd)).toString('base64') }
            ];
            
            const allAiLines = buildAiLinesMap(normalizeRows(rows), zlib, parseDiff);
            const allAiDeletes = buildAiDeletesMap(normalizeRows(rows), zlib, parseDiff);
            
            // 验证：AI 添加知识库有这行
            expect(allAiLines.has(hashLine("console.log('debug');"))).toBe(true);
            expect(allAiDeletes.has(hashLine("console.log('debug');"))).toBe(false);
            
            // 当前 commit range：人工删除另一行相同代码
            const currentHumanDel = `diff --git a/app.js b/app.js
@@ -2,1 +1,0 @@
-console.log('debug');`;
            
            const delFile = parseDiff(currentHumanDel)[0];
            const result = analyzeCommitRangeDiff(delFile, allAiLines, allAiDeletes);
            
            // 关键验证：人工删除会被误判为 AI 删除！
            // 因为 allAiLines 包含这个 hash（AI 曾添加过相同内容）
            expect(result.stats.deleted).toBe(1);
            expect(result.stats.ai_deleted).toBe(0); // 不算 AI 删除，因为不在 aiLinesInRange 且不在 allAiDeletes
            
            const delChange = result.changes.find(c => c.type === 'del');
            expect(delChange.isAI).toBe(false); // 标记为人工删除
            
            console.log('场景：AI 在第 5 行添加，人工删除第 2 行（相同内容）');
            console.log('结果：正确识别为人工删除（因为不在 allAiDeletes）');
        });

        it('应该展示多行相同代码的复杂交互场景', () => {
            // 场景：文件中有 3 行 console.log('test');
            // 历史：AI 添加了其中 1 行
            // 历史：AI 删除了其中 1 行（可能是同一行，也可能是不同行）
            // 当前：人工删除了第 3 行
            
            const aiHistory = [
                // AI 添加
                { compressed_diff: zlib.gzipSync(Buffer.from(`diff --git a/test.js b/test.js
@@ -0,0 +1,1 @@
+console.log('test');`)).toString('base64') },
                // AI 删除
                { compressed_diff: zlib.gzipSync(Buffer.from(`diff --git a/test.js b/test.js
@@ -1,1 +0,0 @@
-console.log('test');`)).toString('base64') }
            ];
            
            const allAiLines = buildAiLinesMap(aiHistory, zlib, parseDiff);
            const allAiDeletes = buildAiDeletesMap(aiHistory, zlib, parseDiff);
            
            // 验证知识库
            const testHash = hashLine("console.log('test');");
            expect(allAiLines.has(testHash)).toBe(true);    // AI 添加过
            expect(allAiDeletes.has(testHash)).toBe(true);  // AI 删除过
            
            // 当前：人工删除第 3 行
            const humanDel = `diff --git a/test.js b/test.js
@@ -10,1 +9,0 @@
-console.log('test');`;
            
            const result = analyzeCommitRangeDiff(
                parseDiff(humanDel)[0],
                allAiLines,
                allAiDeletes
            );
            
            // 验证：会被误判为 AI 删除
            // 因为 allAiDeletes 包含这个 hash
            expect(result.stats.deleted).toBe(1);
            expect(result.stats.ai_deleted).toBe(1); // 误判：实际是人工删除第 3 行
            
            console.log('误判原因：AI 曾删除过相同内容的另一行');
            console.log('系统无法区分"删除第 2 行"和"删除第 10 行"（内容相同）');
        });

        it('应该展示文件级别分析中的多行相同代码问题', () => {
            // 场景：最终文件中有 3 行 return true;
            // - 第 1 行：人工编写
            // - 第 2 行：AI 生成
            // - 第 3 行：人工编写（但内容与 AI 生成的相同）
            
            const aiAdd = `diff --git a/utils.js b/utils.js
@@ -5,0 +6,1 @@
+    return true;`;
            
            const rows = [
                { compressed_diff: zlib.gzipSync(Buffer.from(aiAdd)).toString('base64') }
            ];
            
            const allAiLines = buildAiLinesMap(normalizeRows(rows), zlib, parseDiff);
            
            // 最终文件内容
            const fileLines = [
                'function check1() {',
                '    return true;',  // 人工
                '}',
                'function check2() {',
                '    return true;',  // AI 生成
                '}',
                'function check3() {',
                '    return true;',  // 人工，但与 AI 相同
                '}'
            ];
            
            const result = analyzeFileAttribution(fileLines, allAiLines);
            
            // 问题：3 行 return true; 都被标记为 AI
            const returnLines = result.analysis.filter(
                l => l.content.includes('return true')
            );
            
            expect(returnLines.length).toBe(3);
            returnLines.forEach(line => {
                expect(line.attribution).toBe('ai'); // 全部标记为 AI
            });
            
            // 统计
            expect(result.stats.ai_lines).toBe(3); // 3 行被算作 AI
            expect(result.stats.human_lines).toBe(6); // 其他 6 行
            
            console.log('已知限制：无法区分多行相同代码的不同来源');
            console.log('实际：1 行 AI + 2 行人工');
            console.log('识别：3 行全部标记为 AI');
        });

        it('应该展示使用 Map + 时间过滤可以缓解多行相同代码的误判', () => {
            // 对比场景：同样是 3 行 return true;
            // 但如果使用时间过滤，可以更准确地判断
            
            // Day 1 (2023-01-01): 人工写了 check1 和 check3
            // Day 2 (2023-01-05): AI 生成了 check2
            
            const aiAdd = `diff --git a/utils.js b/utils.js
@@ -5,0 +6,1 @@
+    return true;`;
            
            const rows = [
                { 
                    compressed_diff: zlib.gzipSync(Buffer.from(aiAdd)).toString('base64'),
                    created_at: '2023-01-05T10:00:00Z',
                    generation_id: 'ai-gen-1'
                }
            ];
            
            // 使用 Map 而不是 Set
            const aiLinesMap = buildAiLinesMap(rows, zlib, parseDiff);
            
            // 场景 A：分析 Day 1 的文件（AI 生成之前）
            const fileTimestampDay1 = '2023-01-01T12:00:00Z';
            const fileLinesDay1 = [
                'function check1() {',
                '    return true;',  // 人工，Day 1
                '}',
                'function check3() {',
                '    return true;',  // 人工，Day 1
                '}'
            ];
            
            const resultDay1 = analyzeFileAttribution(fileLinesDay1, aiLinesMap, {
                fileTimestamp: fileTimestampDay1
            });
            
            // 验证：由于 AI 生成时间在文件时间之后，不会误判
            expect(resultDay1.stats.ai_lines).toBe(0);  // ✅ 正确！
            expect(resultDay1.stats.human_lines).toBe(6);
            
            console.log('使用时间过滤：Day 1 文件 (AI 生成前) -> ai_lines = 0 ✅');
            
            // 场景 B：分析 Day 10 的文件（AI 生成之后）
            const fileTimestampDay10 = '2023-01-10T12:00:00Z';
            const fileLinesDay10 = [
                'function check1() {',
                '    return true;',  // 人工，Day 1
                '}',
                'function check2() {',
                '    return true;',  // AI 生成，Day 2
                '}',
                'function check3() {',
                '    return true;',  // 人工，Day 1
                '}'
            ];
            
            const resultDay10 = analyzeFileAttribution(fileLinesDay10, aiLinesMap, {
                fileTimestamp: fileTimestampDay10
            });
            
            // 验证：AI 生成时间在文件时间之前，所以会标记
            expect(resultDay10.stats.ai_lines).toBe(3);  // ❌ 仍然误判
            expect(resultDay10.stats.human_lines).toBe(6);
            
            console.log('使用时间过滤：Day 10 文件 (AI 生成后) -> ai_lines = 3 ❌');
            console.log('时间过滤只能避免"未来 AI"的误判，无法区分同时代的相同代码');
            
            // 对比：不使用时间过滤
            const resultNoFilter = analyzeFileAttribution(fileLinesDay1, aiLinesMap);  // 不传 fileTimestamp
            
            expect(resultNoFilter.stats.ai_lines).toBe(2);  // Day 1 的代码也被误判
            
            console.log('不使用时间过滤：Day 1 文件 -> ai_lines = 2 ❌（更严重的误判）');
        });

        it('应该展示行号无关性的设计优势', () => {
            // 场景：验证即使行号变化，仍能正确识别
            
            // AI 在第 10 行添加代码
            const aiAddLine10 = `diff --git a/file.js b/file.js
@@ -9,0 +10,1 @@
+const config = { port: 3000 };`;
            
            const rows = [
                { compressed_diff: zlib.gzipSync(Buffer.from(aiAddLine10)).toString('base64') }
            ];
            
            const allAiLines = buildAiLinesMap(normalizeRows(rows), zlib, parseDiff);
            
            // 后来代码重构，这行变成了第 25 行
            const fileLines = Array(24).fill('// other code');
            fileLines.push('const config = { port: 3000 };');
            fileLines.push('// more code');
            
            const result = analyzeFileAttribution(fileLines, allAiLines);
            
            // 验证：即使行号从 10 变成 25，仍能识别
            const configLine = result.analysis[24]; // 第 25 行（索引 24）
            expect(configLine.content).toBe('const config = { port: 3000 };');
            expect(configLine.attribution).toBe('ai'); // 正确识别为 AI
            
            console.log('优势：基于内容哈希，不依赖行号');
            console.log('即使代码移动、文件重构，仍能正确归属');
        });

        it('应该检测并报告重复代码的统计信息', () => {
            // 场景：AI 生成了 2 次 return true;，但文件中有 4 行
            const aiDiff1 = `diff --git a/test.js b/test.js
@@ -0,0 +1,1 @@
+    return true;`;
            
            const aiDiff2 = `diff --git a/test.js b/test.js
@@ -0,0 +1,1 @@
+    return true;`;
            
            const rows = [
                { compressed_diff: zlib.gzipSync(Buffer.from(aiDiff1)).toString('base64'), created_at: '2024-01-01T10:00:00Z', generation_id: 'gen-1' },
                { compressed_diff: zlib.gzipSync(Buffer.from(aiDiff2)).toString('base64'), created_at: '2024-01-01T11:00:00Z', generation_id: 'gen-2' }
            ];
            
            const aiLinesMap = buildAiLinesMap(rows, zlib, parseDiff);
            
            // 验证 count
            const hash = hashLine('return true;');
            const aiInfo = aiLinesMap.get(hash);
            expect(aiInfo.count).toBe(2);
            
            // 文件中有 4 行 return true;
            const fileLines = [
                'function test1() {',
                '    return true;',
                '}',
                'function test2() {',
                '    return true;',
                '}',
                'function test3() {',
                '    return true;',
                '}',
                'function test4() {',
                '    return true;',
                '}'
            ];
            
            const result = analyzeFileAttribution(fileLines, aiLinesMap);
            
            // 验证基本统计
            expect(result.stats.total_lines).toBe(12);
            expect(result.stats.ai_lines).toBe(4);  // 所有 return true; 都被标记为 AI
            
            // 验证警告信息
            expect(result.warning).toBeDefined();
            expect(result.warning).toContain('重复代码');
            
            // 验证 duplicateStats
            expect(result.duplicateStats).toBeDefined();
            const dupStat = result.duplicateStats[hash];
            expect(dupStat).toBeDefined();
            expect(dupStat.total_in_file).toBe(4);
            expect(dupStat.ai_count).toBe(2);
            expect(dupStat.estimated_ai_lines).toBe(2);
            expect(dupStat.estimated_human_lines).toBe(2);
            expect(dupStat.content.trim()).toBe('return true;');
            expect(dupStat.note).toContain('可能有 2 行是人工编写');
            
            console.log('duplicateStats:', JSON.stringify(dupStat, null, 2));
        });

        it('应该在没有重复代码时不显示警告', () => {
            // AI 生成了 1 次，文件中有 1 行
            const aiDiff = `diff --git a/test.js b/test.js
@@ -0,0 +1,1 @@
+const x = 1;`;
            
            const rows = [
                { compressed_diff: zlib.gzipSync(Buffer.from(aiDiff)).toString('base64'), created_at: '2024-01-01T10:00:00Z', generation_id: 'gen-1' }
            ];
            
            const aiLinesMap = buildAiLinesMap(rows, zlib, parseDiff);
            const fileLines = ['const x = 1;'];
            
            const result = analyzeFileAttribution(fileLines, aiLinesMap);
            
            // 没有重复代码，不应该有警告
            expect(result.warning).toBeUndefined();
            expect(result.duplicateStats).toBeUndefined();
        });
    });
});

