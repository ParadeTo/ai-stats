const {
    hashLine,
    buildAiLinesSet,
    analyzeCommitRangeDiff,
    analyzeFileAttribution
} = require('../lib/codeAttribution');
const zlib = require('zlib');
const parseDiff = require('parse-diff');

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

    describe('buildAiLinesSet', () => {
        it('应该从压缩的 diff 中提取 AI 生成的行', () => {
            const diff = `diff --git a/test.js b/test.js
index 1234567..abcdefg 100644
--- a/test.js
+++ b/test.js
@@ -1,3 +1,4 @@
 function test() {
+    console.log('AI generated');
     return true;
 }`;
            
            const compressed = zlib.gzipSync(Buffer.from(diff)).toString('base64');
            const rows = [{
                compressed_diff: compressed
            }];

            const aiLinesSet = buildAiLinesSet(rows, zlib, parseDiff);
            
            expect(aiLinesSet.size).toBe(1);
            expect(aiLinesSet.has(hashLine("console.log('AI generated');"))).toBe(true);
        });

        it('应该忽略删除的行', () => {
            const diff = `diff --git a/test.js b/test.js
index 1234567..abcdefg 100644
--- a/test.js
+++ b/test.js
@@ -1,4 +1,3 @@
 function test() {
-    console.log('old line');
+    console.log('new line');
 }`;
            
            const compressed = zlib.gzipSync(Buffer.from(diff)).toString('base64');
            const rows = [{ compressed_diff: compressed }];

            const aiLinesSet = buildAiLinesSet(rows, zlib, parseDiff);
            
            expect(aiLinesSet.size).toBe(1);
            expect(aiLinesSet.has(hashLine("console.log('new line');"))).toBe(true);
            expect(aiLinesSet.has(hashLine("console.log('old line');"))).toBe(false);
        });

        it('应该处理多个文件的 diff', () => {
            const diff = `diff --git a/file1.js b/file1.js
index 1234567..abcdefg 100644
--- a/file1.js
+++ b/file1.js
@@ -1,1 +1,2 @@
 line1
+line2
diff --git a/file2.js b/file2.js
index 1234567..abcdefg 100644
--- a/file2.js
+++ b/file2.js
@@ -1,1 +1,2 @@
 line3
+line4`;
            
            const compressed = zlib.gzipSync(Buffer.from(diff)).toString('base64');
            const rows = [{ compressed_diff: compressed }];

            const aiLinesSet = buildAiLinesSet(rows, zlib, parseDiff);
            
            expect(aiLinesSet.size).toBe(2);
            expect(aiLinesSet.has(hashLine('line2'))).toBe(true);
            expect(aiLinesSet.has(hashLine('line4'))).toBe(true);
        });

        it('应该处理无效的压缩数据', () => {
            const rows = [
                { compressed_diff: 'invalid_base64' },
                { compressed_diff: zlib.gzipSync(Buffer.from('valid diff')).toString('base64') }
            ];

            expect(() => {
                buildAiLinesSet(rows, zlib, parseDiff);
            }).not.toThrow();
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
    });

    describe('analyzeFileAttribution', () => {
        it('应该正确标记 AI 生成的行', () => {
            const lines = [
                'function test() {',
                '    console.log("AI line");',
                '    return true;',
                '}'
            ];

            const aiLinesSet = new Set([
                hashLine('console.log("AI line");'),
                hashLine('return true;')
            ]);

            const result = analyzeFileAttribution(lines, aiLinesSet);

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
            const aiLinesSet = new Set(lines.map(hashLine));

            const result = analyzeFileAttribution(lines, aiLinesSet);

            expect(result.stats.ai_lines).toBe(3);
            expect(result.stats.human_lines).toBe(0);
        });

        it('应该处理完全由人工编写的文件', () => {
            const lines = ['line1', 'line2', 'line3'];
            const aiLinesSet = new Set();

            const result = analyzeFileAttribution(lines, aiLinesSet);

            expect(result.stats.ai_lines).toBe(0);
            expect(result.stats.human_lines).toBe(3);
        });

        it('应该处理空文件', () => {
            const lines = [];
            const aiLinesSet = new Set();

            const result = analyzeFileAttribution(lines, aiLinesSet);

            expect(result.stats.total_lines).toBe(0);
            expect(result.stats.ai_lines).toBe(0);
            expect(result.stats.human_lines).toBe(0);
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
            
            const allAiLines = buildAiLinesSet(rows, zlib, parseDiff);
            
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
    });
});

