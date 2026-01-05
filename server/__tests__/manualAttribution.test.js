const request = require('supertest');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { hashLine } = require('../lib/codeAttribution');

// 创建测试数据库
const testDbPath = path.join(__dirname, 'test_manual_attribution.db');

describe('Manual Attribution API', () => {
    let app;
    let db;

    beforeAll(() => {
        // 删除旧的测试数据库
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }

        // 创建测试数据库
        db = new sqlite3.Database(testDbPath);

        // 创建表
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS manual_attributions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                repo_url TEXT NOT NULL,
                file_path TEXT NOT NULL,
                branch TEXT NOT NULL,
                commit_hash TEXT,
                line_number INTEGER NOT NULL,
                content_hash TEXT NOT NULL,
                attribution TEXT NOT NULL CHECK(attribution IN ('ai', 'human')),
                user_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(repo_url, file_path, branch, line_number)
            )`);

            db.run(`CREATE INDEX IF NOT EXISTS idx_manual_attr_lookup 
                ON manual_attributions(repo_url, file_path, branch)`);
        });

        // 创建 Express 应用（简化版，只包含测试需要的端点）
        app = express();
        app.use(express.json());

        // POST /api/manual-attribution
        app.post('/api/manual-attribution', (req, res) => {
            const { 
                repo_url, 
                file_path, 
                branch,
                commit_hash,
                manual_attributions,
                user_id = 'default'
            } = req.body;

            if (!repo_url || !file_path || !branch || !manual_attributions || !Array.isArray(manual_attributions)) {
                return res.status(400).json({ 
                    error: 'Missing required fields: repo_url, file_path, branch, manual_attributions (array)' 
                });
            }

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                const stmt = db.prepare(`
                    INSERT INTO manual_attributions 
                    (repo_url, file_path, branch, commit_hash, line_number, content_hash, attribution, user_id, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    ON CONFLICT(repo_url, file_path, branch, line_number) 
                    DO UPDATE SET 
                        content_hash = excluded.content_hash,
                        attribution = excluded.attribution,
                        user_id = excluded.user_id,
                        updated_at = datetime('now')
                `);

                let errorOccurred = false;
                
                manual_attributions.forEach(m => {
                    if (!m.lineNumber || !m.content || !m.attribution) {
                        errorOccurred = true;
                        return;
                    }
                    
                    stmt.run(
                        repo_url,
                        file_path,
                        branch,
                        commit_hash || null,
                        m.lineNumber,
                        hashLine(m.content),
                        m.attribution,
                        user_id
                    );
                });

                stmt.finalize((err) => {
                    if (err || errorOccurred) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: 'Failed to save manual attributions' });
                    }
                    
                    db.run('COMMIT', (err) => {
                        if (err) {
                            return res.status(500).json({ error: 'Failed to commit transaction' });
                        }
                        
                        res.json({ 
                            success: true, 
                            count: manual_attributions.length,
                            message: `Saved ${manual_attributions.length} manual attribution(s)` 
                        });
                    });
                });
            });
        });

        // GET /api/manual-attribution
        app.get('/api/manual-attribution', (req, res) => {
            const { repo_url, file_path, branch } = req.query;

            if (!repo_url || !file_path || !branch) {
                return res.status(400).json({ 
                    error: 'Missing required parameters: repo_url, file_path, branch' 
                });
            }

            db.all(`
                SELECT 
                    line_number,
                    content_hash,
                    attribution,
                    user_id,
                    created_at,
                    updated_at
                FROM manual_attributions 
                WHERE repo_url = ? AND file_path = ? AND branch = ?
                ORDER BY line_number ASC
            `, [repo_url, file_path, branch], (err, rows) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }

                res.json({ 
                    manual_attributions: rows || [],
                    count: rows ? rows.length : 0
                });
            });
        });

        // DELETE /api/manual-attribution
        app.delete('/api/manual-attribution', (req, res) => {
            const { repo_url, file_path, branch, line_number } = req.query;

            if (!repo_url || !file_path || !branch) {
                return res.status(400).json({ 
                    error: 'Missing required parameters: repo_url, file_path, branch' 
                });
            }

            let sql;
            let params;
            
            if (line_number) {
                sql = `DELETE FROM manual_attributions 
                       WHERE repo_url = ? AND file_path = ? AND branch = ? AND line_number = ?`;
                params = [repo_url, file_path, branch, parseInt(line_number)];
            } else {
                sql = `DELETE FROM manual_attributions 
                       WHERE repo_url = ? AND file_path = ? AND branch = ?`;
                params = [repo_url, file_path, branch];
            }

            db.run(sql, params, function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Failed to delete manual attributions' });
                }

                res.json({ 
                    success: true, 
                    deleted: this.changes,
                    message: `Deleted ${this.changes} manual attribution(s)` 
                });
            });
        });
    });

    afterAll((done) => {
        db.close(() => {
            if (fs.existsSync(testDbPath)) {
                fs.unlinkSync(testDbPath);
            }
            done();
        });
    });

    describe('POST /api/manual-attribution', () => {
        it('应该成功保存单个手动标记', async () => {
            const response = await request(app)
                .post('/api/manual-attribution')
                .send({
                    repo_url: 'https://github.com/test/repo.git',
                    file_path: 'test.js',
                    branch: 'main',
                    manual_attributions: [
                        {
                            lineNumber: 10,
                            content: 'console.log("hello");',
                            attribution: 'human'
                        }
                    ]
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.count).toBe(1);
        });

        it('应该成功保存多个手动标记', async () => {
            const response = await request(app)
                .post('/api/manual-attribution')
                .send({
                    repo_url: 'https://github.com/test/repo.git',
                    file_path: 'utils.js',
                    branch: 'main',
                    manual_attributions: [
                        {
                            lineNumber: 5,
                            content: 'return true;',
                            attribution: 'ai'
                        },
                        {
                            lineNumber: 10,
                            content: 'return false;',
                            attribution: 'human'
                        },
                        {
                            lineNumber: 15,
                            content: 'return null;',
                            attribution: 'human'
                        }
                    ]
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.count).toBe(3);
        });

        it('应该在缺少必填字段时返回 400', async () => {
            const response = await request(app)
                .post('/api/manual-attribution')
                .send({
                    repo_url: 'https://github.com/test/repo.git',
                    file_path: 'test.js'
                    // 缺少 branch 和 manual_attributions
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toBeDefined();
        });

        it('应该支持更新已存在的手动标记', async () => {
            // 第一次保存
            await request(app)
                .post('/api/manual-attribution')
                .send({
                    repo_url: 'https://github.com/test/repo.git',
                    file_path: 'update-test.js',
                    branch: 'main',
                    manual_attributions: [
                        {
                            lineNumber: 20,
                            content: 'const x = 1;',
                            attribution: 'ai'
                        }
                    ]
                });

            // 第二次保存（更新）
            const response = await request(app)
                .post('/api/manual-attribution')
                .send({
                    repo_url: 'https://github.com/test/repo.git',
                    file_path: 'update-test.js',
                    branch: 'main',
                    manual_attributions: [
                        {
                            lineNumber: 20,
                            content: 'const x = 1;',
                            attribution: 'human'  // 改为 human
                        }
                    ]
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);

            // 验证更新成功
            const getResponse = await request(app)
                .get('/api/manual-attribution')
                .query({
                    repo_url: 'https://github.com/test/repo.git',
                    file_path: 'update-test.js',
                    branch: 'main'
                });

            expect(getResponse.body.count).toBe(1);
            expect(getResponse.body.manual_attributions[0].attribution).toBe('human');
        });

        it('应该正确计算内容哈希', async () => {
            const content = '    return true;';
            const expectedHash = hashLine(content);

            await request(app)
                .post('/api/manual-attribution')
                .send({
                    repo_url: 'https://github.com/test/repo.git',
                    file_path: 'hash-test.js',
                    branch: 'main',
                    manual_attributions: [
                        {
                            lineNumber: 1,
                            content: content,
                            attribution: 'ai'
                        }
                    ]
                });

            const response = await request(app)
                .get('/api/manual-attribution')
                .query({
                    repo_url: 'https://github.com/test/repo.git',
                    file_path: 'hash-test.js',
                    branch: 'main'
                });

            expect(response.body.manual_attributions[0].content_hash).toBe(expectedHash);
        });
    });

    describe('GET /api/manual-attribution', () => {
        beforeEach(async () => {
            // 插入测试数据
            await request(app)
                .post('/api/manual-attribution')
                .send({
                    repo_url: 'https://github.com/test/get-repo.git',
                    file_path: 'get-test.js',
                    branch: 'develop',
                    manual_attributions: [
                        { lineNumber: 1, content: 'line 1', attribution: 'ai' },
                        { lineNumber: 5, content: 'line 5', attribution: 'human' },
                        { lineNumber: 10, content: 'line 10', attribution: 'human' }
                    ]
                });
        });

        it('应该成功获取手动标记列表', async () => {
            const response = await request(app)
                .get('/api/manual-attribution')
                .query({
                    repo_url: 'https://github.com/test/get-repo.git',
                    file_path: 'get-test.js',
                    branch: 'develop'
                });

            expect(response.status).toBe(200);
            expect(response.body.count).toBe(3);
            expect(response.body.manual_attributions).toHaveLength(3);
            expect(response.body.manual_attributions[0].line_number).toBe(1);
            expect(response.body.manual_attributions[1].line_number).toBe(5);
            expect(response.body.manual_attributions[2].line_number).toBe(10);
        });

        it('应该返回按行号排序的结果', async () => {
            const response = await request(app)
                .get('/api/manual-attribution')
                .query({
                    repo_url: 'https://github.com/test/get-repo.git',
                    file_path: 'get-test.js',
                    branch: 'develop'
                });

            const lineNumbers = response.body.manual_attributions.map(m => m.line_number);
            expect(lineNumbers).toEqual([1, 5, 10]);
        });

        it('应该在缺少参数时返回 400', async () => {
            const response = await request(app)
                .get('/api/manual-attribution')
                .query({
                    repo_url: 'https://github.com/test/repo.git'
                    // 缺少 file_path 和 branch
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toBeDefined();
        });

        it('应该在没有找到手动标记时返回空数组', async () => {
            const response = await request(app)
                .get('/api/manual-attribution')
                .query({
                    repo_url: 'https://github.com/test/nonexistent.git',
                    file_path: 'nonexistent.js',
                    branch: 'main'
                });

            expect(response.status).toBe(200);
            expect(response.body.count).toBe(0);
            expect(response.body.manual_attributions).toEqual([]);
        });
    });

    describe('DELETE /api/manual-attribution', () => {
        beforeEach(async () => {
            // 插入测试数据
            await request(app)
                .post('/api/manual-attribution')
                .send({
                    repo_url: 'https://github.com/test/delete-repo.git',
                    file_path: 'delete-test.js',
                    branch: 'main',
                    manual_attributions: [
                        { lineNumber: 1, content: 'line 1', attribution: 'ai' },
                        { lineNumber: 2, content: 'line 2', attribution: 'human' },
                        { lineNumber: 3, content: 'line 3', attribution: 'ai' }
                    ]
                });
        });

        it('应该成功删除特定行的手动标记', async () => {
            const response = await request(app)
                .delete('/api/manual-attribution')
                .query({
                    repo_url: 'https://github.com/test/delete-repo.git',
                    file_path: 'delete-test.js',
                    branch: 'main',
                    line_number: 2
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.deleted).toBe(1);

            // 验证删除成功
            const getResponse = await request(app)
                .get('/api/manual-attribution')
                .query({
                    repo_url: 'https://github.com/test/delete-repo.git',
                    file_path: 'delete-test.js',
                    branch: 'main'
                });

            expect(getResponse.body.count).toBe(2);
            expect(getResponse.body.manual_attributions.find(m => m.line_number === 2)).toBeUndefined();
        });

        it('应该成功删除整个文件的所有手动标记', async () => {
            const response = await request(app)
                .delete('/api/manual-attribution')
                .query({
                    repo_url: 'https://github.com/test/delete-repo.git',
                    file_path: 'delete-test.js',
                    branch: 'main'
                    // 不指定 line_number
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.deleted).toBe(3);

            // 验证全部删除
            const getResponse = await request(app)
                .get('/api/manual-attribution')
                .query({
                    repo_url: 'https://github.com/test/delete-repo.git',
                    file_path: 'delete-test.js',
                    branch: 'main'
                });

            expect(getResponse.body.count).toBe(0);
        });

        it('应该在缺少参数时返回 400', async () => {
            const response = await request(app)
                .delete('/api/manual-attribution')
                .query({
                    repo_url: 'https://github.com/test/repo.git'
                    // 缺少 file_path 和 branch
                });

            expect(response.status).toBe(400);
            expect(response.body.error).toBeDefined();
        });

        it('删除不存在的记录应该返回 deleted: 0', async () => {
            const response = await request(app)
                .delete('/api/manual-attribution')
                .query({
                    repo_url: 'https://github.com/test/delete-repo.git',
                    file_path: 'delete-test.js',
                    branch: 'main',
                    line_number: 999  // 不存在的行号
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.deleted).toBe(0);
        });
    });

    describe('数据完整性测试', () => {
        it('应该防止重复的 (repo_url, file_path, branch, line_number) 组合', async () => {
            const data = {
                repo_url: 'https://github.com/test/unique-test.git',
                file_path: 'unique.js',
                branch: 'main',
                manual_attributions: [
                    { lineNumber: 100, content: 'test', attribution: 'ai' }
                ]
            };

            // 第一次插入
            const response1 = await request(app)
                .post('/api/manual-attribution')
                .send(data);
            expect(response1.status).toBe(200);

            // 第二次插入（应该更新而不是创建新记录）
            const response2 = await request(app)
                .post('/api/manual-attribution')
                .send({
                    ...data,
                    manual_attributions: [
                        { lineNumber: 100, content: 'test', attribution: 'human' }
                    ]
                });
            expect(response2.status).toBe(200);

            // 验证只有一条记录
            const getResponse = await request(app)
                .get('/api/manual-attribution')
                .query({
                    repo_url: data.repo_url,
                    file_path: data.file_path,
                    branch: data.branch
                });

            expect(getResponse.body.count).toBe(1);
            expect(getResponse.body.manual_attributions[0].attribution).toBe('human');
        });

        it('应该正确处理不同分支的相同文件', async () => {
            const baseData = {
                repo_url: 'https://github.com/test/branch-test.git',
                file_path: 'branch.js',
                manual_attributions: [
                    { lineNumber: 1, content: 'line 1', attribution: 'ai' }
                ]
            };

            // 在 main 分支保存
            await request(app)
                .post('/api/manual-attribution')
                .send({ ...baseData, branch: 'main' });

            // 在 develop 分支保存
            await request(app)
                .post('/api/manual-attribution')
                .send({ ...baseData, branch: 'develop' });

            // 验证两个分支都有记录
            const mainResponse = await request(app)
                .get('/api/manual-attribution')
                .query({
                    repo_url: baseData.repo_url,
                    file_path: baseData.file_path,
                    branch: 'main'
                });

            const developResponse = await request(app)
                .get('/api/manual-attribution')
                .query({
                    repo_url: baseData.repo_url,
                    file_path: baseData.file_path,
                    branch: 'develop'
                });

            expect(mainResponse.body.count).toBe(1);
            expect(developResponse.body.count).toBe(1);
        });

        it('应该记录创建和更新时间', async () => {
            await request(app)
                .post('/api/manual-attribution')
                .send({
                    repo_url: 'https://github.com/test/time-test.git',
                    file_path: 'time.js',
                    branch: 'main',
                    manual_attributions: [
                        { lineNumber: 1, content: 'test', attribution: 'ai' }
                    ]
                });

            const response = await request(app)
                .get('/api/manual-attribution')
                .query({
                    repo_url: 'https://github.com/test/time-test.git',
                    file_path: 'time.js',
                    branch: 'main'
                });

            const record = response.body.manual_attributions[0];
            expect(record.created_at).toBeDefined();
            expect(record.updated_at).toBeDefined();
            expect(new Date(record.created_at)).toBeInstanceOf(Date);
            expect(new Date(record.updated_at)).toBeInstanceOf(Date);
        });
    });
});

