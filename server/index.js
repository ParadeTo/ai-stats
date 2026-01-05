// 加载环境变量
require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const zlib = require('zlib');
const path = require('path');
const parseDiff = require('parse-diff');
const crypto = require('crypto');
const { execSync } = require('child_process');
const GitHubApi = require('./lib/githubApi');
const { buildAiLinesMap, buildAiDeletesMap, analyzeCommitRangeDiff, analyzeFileAttribution, hashLine } = require('./lib/codeAttribution');

const app = express();
const port = 3001;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // 增加到 50MB 以支持大型 diff

// Database setup
const dbPath = path.join(__dirname, 'ai_stats.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS task_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        generation_id TEXT UNIQUE NOT NULL,
        user_id TEXT NOT NULL,
        repo_url TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        conversation_id TEXT,
        model TEXT,
        compressed_diff TEXT,
        task_type TEXT DEFAULT 'adhoc',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // 手动标记表
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

app.get('/', (req, res) => {
    res.send('AI Code Tracker Server is running');
});

// POST /api/create-task - Store the compressed diff
app.post('/api/create-task', (req, res) => {
    const { 
        generation_id, 
        user_id, 
        repo_url, 
        branch_name, 
        conversation_id, 
        model, 
        compressed_diff,
        task_type 
    } = req.body;

    if (!generation_id || !user_id || !compressed_diff) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const stmt = db.prepare(`INSERT INTO task_records 
        (generation_id, user_id, repo_url, branch_name, conversation_id, model, compressed_diff, task_type) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    
    stmt.run(
        generation_id, 
        user_id, 
        repo_url, 
        branch_name, 
        conversation_id, 
        model, 
        compressed_diff, 
        task_type || 'adhoc',
        function(err) {
            if (err) {
                console.error('Error inserting record:', err.message);
                return res.status(500).json({ error: 'Failed to store task' });
            }
            res.json({ success: true, id: this.lastID });
        }
    );
    stmt.finalize();
});

// GET /api/stats - Calculate AI vs Human stats
app.get('/api/stats', (req, res) => {
    const { user_id, repo_url } = req.query;
    let query = 'SELECT * FROM task_records';
    const params = [];

    if (user_id || repo_url) {
        query += ' WHERE';
        if (user_id) {
            query += ' user_id = ?';
            params.push(user_id);
        }
        if (repo_url) {
            if (user_id) query += ' AND';
            query += ' repo_url = ?';
            params.push(repo_url);
        }
    }

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch stats' });
        }

        let totalAdded = 0;
        let totalDeleted = 0;

        rows.forEach(row => {
            try {
                const buffer = Buffer.from(row.compressed_diff, 'base64');
                const decompressed = zlib.gunzipSync(buffer).toString('utf8');
                const files = parseDiff(decompressed);

                files.forEach(file => {
                    file.chunks.forEach(chunk => {
                        chunk.changes.forEach(change => {
                            if (change.type === 'add') totalAdded++;
                            if (change.type === 'del') totalDeleted++;
                        });
                    });
                });
            } catch (e) {
                console.error(`Error processing diff for task ${row.generation_id}:`, e.message);
            }
        });

        res.json({
            summary: {
                ai_added_lines: totalAdded,
                ai_deleted_lines: totalDeleted,
                total_records: rows.length
            },
            records: rows.map(r => ({
                id: r.id,
                generation_id: r.generation_id,
                repo_url: r.repo_url,
                branch_name: r.branch_name,
                model: r.model,
                created_at: r.created_at
            }))
        });
    });
});

// GET /api/commits - Get commit list for a repository
app.get('/api/commits', (req, res) => {
    const { repo_path, branch = 'HEAD', limit = 50 } = req.query;

    if (!repo_path) {
        return res.status(400).json({ error: 'Missing repo_path' });
    }

    try {
        // Get commit history
        const commits = execSync(
            `git log ${branch} --pretty=format:"%H|%h|%an|%ae|%at|%s" -n ${limit}`,
            { cwd: repo_path, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
        );

        const commitList = commits.split('\n').filter(Boolean).map(line => {
            const [hash, shortHash, author, email, timestamp, message] = line.split('|');
            return {
                hash,
                shortHash,
                author,
                email,
                date: new Date(parseInt(timestamp) * 1000).toISOString(),
                message
            };
        });

        res.json(commitList);
    } catch (e) {
        console.error('Error getting commits:', e.message);
        res.status(500).json({ error: `Failed to get commits: ${e.message}` });
    }
});

// GET /api/branch-diff-stats - Get AI statistics for branch diff (current vs master/main)
app.get('/api/branch-diff-stats', (req, res) => {
    const { repo_path, branch, base_branch } = req.query;

    if (!repo_path || !branch) {
        return res.status(400).json({ error: 'Missing repo_path or branch' });
    }

    try {
        // Try to find base branch (master or main)
        let targetBase = base_branch;
        if (!targetBase) {
            try {
                execSync('git rev-parse --verify master', { cwd: repo_path, encoding: 'utf8' });
                targetBase = 'master';
            } catch {
                try {
                    execSync('git rev-parse --verify main', { cwd: repo_path, encoding: 'utf8' });
                    targetBase = 'main';
                } catch {
                    return res.status(400).json({ error: 'Cannot find master or main branch' });
                }
            }
        }

        console.log(`[branch-diff-stats] Comparing ${branch} with ${targetBase}`);

        // Get diff between branches
        const diff = execSync(
            `git diff ${targetBase}...${branch} -- . ':(exclude)node_modules' ':(exclude).git'`,
            { cwd: repo_path, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
        );

        if (!diff) {
            return res.json({ ai_lines: 0, total_added: 0, total_deleted: 0, ai_ratio: 0 });
        }

        const files = parseDiff(diff);
        const repoName = path.basename(repo_path);

        // Get AI knowledge base for this repo
        db.all('SELECT * FROM task_records WHERE repo_url LIKE ?', [`%${repoName}%`], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            const aiLinesSet = new Set();
            rows.forEach(row => {
                try {
                    const buffer = Buffer.from(row.compressed_diff, 'base64');
                    const decompressed = zlib.gunzipSync(buffer).toString('utf8');
                    const aiFiles = parseDiff(decompressed);
                    
                    aiFiles.forEach(file => {
                        file.chunks.forEach(chunk => {
                            chunk.changes.forEach(change => {
                                if (change.type === 'add') {
                                    const content = change.content.substring(1);
                                    aiLinesSet.add(hashLine(content));
                                }
                            });
                        });
                    });
                } catch (e) {
                    console.error('Error processing AI diff:', e.message);
                }
            });

            let ai_lines = 0;
            let total_added = 0;
            let total_deleted = 0;

            files.forEach(file => {
                file.chunks.forEach(chunk => {
                    chunk.changes.forEach(change => {
                        if (change.type === 'add') {
                            total_added++;
                            const content = change.content.substring(1);
                            const hash = hashLine(content);
                            if (aiLinesSet.has(hash)) {
                                ai_lines++;
                            }
                        } else if (change.type === 'del') {
                            total_deleted++;
                        }
                    });
                });
            });

            res.json({
                base_branch: targetBase,
                current_branch: branch,
                ai_lines,
                total_added,
                total_deleted,
                ai_ratio: total_added > 0 ? (ai_lines / total_added * 100) : 0
            });
        });
    } catch (e) {
        console.error('Error calculating branch diff:', e.message);
        res.status(500).json({ error: `Failed to calculate diff: ${e.message}` });
    }
});

// GET /api/projects - Get project list with AI statistics (based on branch diff)
app.get('/api/projects', (req, res) => {
    const query = `
        SELECT 
            repo_url,
            branch_name,
            user_id,
            MAX(created_at) as last_generation,
            GROUP_CONCAT(compressed_diff) as all_diffs
        FROM task_records
        GROUP BY repo_url, branch_name, user_id
        ORDER BY last_generation DESC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        const projects = rows.map(row => {
            let ai_lines = 0;
            let total_lines = 0;

            // Calculate stats from all diffs
            const diffs = row.all_diffs ? row.all_diffs.split(',') : [];
            diffs.forEach(compressedDiff => {
                try {
                    const buffer = Buffer.from(compressedDiff, 'base64');
                    const decompressed = zlib.gunzipSync(buffer).toString('utf8');
                    const files = parseDiff(decompressed);

                    files.forEach(file => {
                        file.chunks.forEach(chunk => {
                            chunk.changes.forEach(change => {
                                if (change.type === 'add') {
                                    ai_lines++;
                                    total_lines++;
                                } else if (change.type === 'del') {
                                    total_lines++;
                                }
                            });
                        });
                    });
                } catch (e) {
                    console.error('Error processing diff:', e.message);
                }
            });

            return {
                repo_url: row.repo_url,
                branch_name: row.branch_name,
                user_id: row.user_id,
                ai_lines,
                total_lines,
                ai_ratio: total_lines > 0 ? (ai_lines / total_lines * 100) : 0,
                last_generation: row.last_generation
            };
        });

        res.json(projects);
    });
});

// GET /api/commit-range-file-diff - Get detailed diff for a file in commit range
app.get('/api/commit-range-file-diff', (req, res) => {
    const { repo_path, file_path, from_commit, to_commit = 'HEAD' } = req.query;

    if (!repo_path || !file_path || !from_commit) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    try {
        console.log(`[commit-range-file-diff] ${file_path} from ${from_commit}...${to_commit}`);

        // Get diff for specific file
        const diff = execSync(
            `git diff ${from_commit}...${to_commit} -- "${file_path}"`,
            { cwd: repo_path, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
        );

        if (!diff) {
            return res.json({ 
                file_path,
                changes: [],
                stats: { added: 0, deleted: 0, ai_added: 0, ai_deleted: 0 }
            });
        }

        const files = parseDiff(diff);
        if (files.length === 0) {
            return res.json({ 
                file_path,
                changes: [],
                stats: { added: 0, deleted: 0, ai_added: 0, ai_deleted: 0 }
            });
        }

        // Get AI knowledge base - only consider AI lines added in this commit range
        const repoName = path.basename(repo_path);
        
        // Step 1: Get all AI-generated lines in this commit range
        const aiLinesInRange = new Set();
        db.all('SELECT * FROM task_records WHERE repo_url LIKE ?', [`%${repoName}%`], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            // Build AI knowledge base from all historical records
            const allAiLines = new Set();
            rows.forEach(row => {
                try {
                    const buffer = Buffer.from(row.compressed_diff, 'base64');
                    const decompressed = zlib.gunzipSync(buffer).toString('utf8');
                    const aiFiles = parseDiff(decompressed);
                    
                    aiFiles.forEach(file => {
                        file.chunks.forEach(chunk => {
                            chunk.changes.forEach(change => {
                                if (change.type === 'add') {
                                    const content = change.content.substring(1);
                                    allAiLines.add(hashLine(content));
                                }
                            });
                        });
                    });
                } catch (e) {}
            });

            const file = files[0];
            const changes = [];
            let added = 0, deleted = 0, ai_added = 0, ai_deleted = 0;

            // First pass: identify which added lines are AI
            file.chunks.forEach(chunk => {
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

            // Second pass: build the changes array with correct attribution
            file.chunks.forEach(chunk => {
                chunk.changes.forEach(change => {
                    const content = change.content.substring(1);
                    const hash = hashLine(content);

                    if (change.type === 'add') {
                        added++;
                        const isAI = allAiLines.has(hash);
                        if (isAI) ai_added++;
                        changes.push({
                            type: 'add',
                            lineNumber: change.ln,
                            content,
                            isAI
                        });
                    } else if (change.type === 'del') {
                        deleted++;
                        // 删除的行只有在当前 commit range 内被 AI 添加才算 AI 删除
                        const isAI = aiLinesInRange.has(hash);
                        if (isAI) ai_deleted++;
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

            res.json({
                file_path,
                from_commit,
                to_commit,
                changes,
                stats: { added, deleted, ai_added, ai_deleted }
            });
        });
    } catch (e) {
        console.error('Error getting file diff:', e.message);
        res.status(500).json({ error: `Failed to get file diff: ${e.message}` });
    }
});

// GET /api/commit-range-stats - Get AI statistics between two commits
app.get('/api/commit-range-stats', (req, res) => {
    const { repo_path, from_commit, to_commit = 'HEAD' } = req.query;

    if (!repo_path || !from_commit) {
        return res.status(400).json({ error: 'Missing repo_path or from_commit' });
    }

    try {
        console.log(`[commit-range-stats] Analyzing ${from_commit}...${to_commit}`);

        // Get diff between commits
        const diff = execSync(
            `git diff ${from_commit}...${to_commit} -- . ':(exclude)node_modules' ':(exclude).git'`,
            { cwd: repo_path, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
        );

        if (!diff) {
            return res.json({ 
                files: [],
                summary: { ai_lines: 0, total_added: 0, total_deleted: 0, ai_ratio: 0 }
            });
        }

        const files = parseDiff(diff);
        const repoName = path.basename(repo_path);

        // Get AI knowledge base
        db.all('SELECT * FROM task_records WHERE repo_url LIKE ?', [`%${repoName}%`], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            const aiLinesSet = new Set();
            rows.forEach(row => {
                try {
                    const buffer = Buffer.from(row.compressed_diff, 'base64');
                    const decompressed = zlib.gunzipSync(buffer).toString('utf8');
                    const aiFiles = parseDiff(decompressed);
                    
                    aiFiles.forEach(file => {
                        file.chunks.forEach(chunk => {
                            chunk.changes.forEach(change => {
                                if (change.type === 'add') {
                                    const content = change.content.substring(1);
                                    aiLinesSet.add(hashLine(content));
                                }
                            });
                        });
                    });
                } catch (e) {}
            });

            const fileStats = [];
            let total_ai_lines = 0;
            let total_added = 0;
            let total_deleted = 0;

            files.forEach(file => {
                const filePath = (file.to || file.from || '').replace(/^[ab]\//, '');
                let ai_lines = 0;
                let added = 0;
                let deleted = 0;

                file.chunks.forEach(chunk => {
                    chunk.changes.forEach(change => {
                        if (change.type === 'add') {
                            added++;
                            const content = change.content.substring(1);
                            if (aiLinesSet.has(hashLine(content))) {
                                ai_lines++;
                            }
                        } else if (change.type === 'del') {
                            deleted++;
                        }
                    });
                });

                if (added > 0 || deleted > 0) {
                    fileStats.push({
                        file_path: filePath,
                        ai_lines,
                        added_lines: added,
                        deleted_lines: deleted,
                        ai_ratio: added > 0 ? (ai_lines / added * 100) : 0
                    });
                }

                total_ai_lines += ai_lines;
                total_added += added;
                total_deleted += deleted;
            });

            res.json({
                from_commit,
                to_commit,
                files: fileStats,
                summary: {
                    ai_lines: total_ai_lines,
                    total_added,
                    total_deleted,
                    ai_ratio: total_added > 0 ? (total_ai_lines / total_added * 100) : 0
                }
            });
        });
    } catch (e) {
        console.error('Error calculating commit range stats:', e.message);
        res.status(500).json({ error: `Failed to calculate stats: ${e.message}` });
    }
});

// GET /api/project-files - Get file list for a project
app.get('/api/project-files', (req, res) => {
    const { repo_url, branch } = req.query;

    if (!repo_url) {
        return res.status(400).json({ error: 'Missing repo_url' });
    }

    let query = 'SELECT compressed_diff FROM task_records WHERE repo_url = ?';
    const params = [repo_url];

    if (branch) {
        query += ' AND branch_name = ?';
        params.push(branch);
    }

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        const filesMap = new Map();

        rows.forEach(row => {
            try {
                const buffer = Buffer.from(row.compressed_diff, 'base64');
                const decompressed = zlib.gunzipSync(buffer).toString('utf8');
                const files = parseDiff(decompressed);

                files.forEach(file => {
                    const filePath = file.to || file.from;
                    if (!filePath) return;

                    if (!filesMap.has(filePath)) {
                        filesMap.set(filePath, {
                            file_path: filePath.replace(/^[ab]\//, ''),
                            ai_lines: 0,
                            manual_lines: 0,
                            unchanged_lines: 0,
                            total_lines: 0
                        });
                    }

                    const fileStats = filesMap.get(filePath);
                    file.chunks.forEach(chunk => {
                        chunk.changes.forEach(change => {
                            if (change.type === 'add') {
                                fileStats.ai_lines++;
                                fileStats.total_lines++;
                            } else if (change.type === 'del') {
                                fileStats.manual_lines++;
                            }
                        });
                    });
                });
            } catch (e) {
                console.error('Error processing diff:', e.message);
            }
        });

        const filesList = Array.from(filesMap.values()).map(file => ({
            ...file,
            ai_ratio: file.total_lines > 0 ? (file.ai_lines / file.total_lines * 100) : 0
        }));

        res.json(filesList);
    });
});

// GET /api/analyze-file - Deep attribution analysis for a specific file
app.get('/api/analyze-file', (req, res) => {
    const { repo_path, file_path, branch = 'HEAD' } = req.query;

    console.log('[analyze-file] Request params:', { repo_path, file_path, branch });

    if (!repo_path || !file_path) {
        console.log('[analyze-file] Missing required params');
        return res.status(400).json({ error: 'Missing repo_path or file_path' });
    }

    // Check if repo_path is a valid git repository
    try {
        execSync('git rev-parse --git-dir', { cwd: repo_path, encoding: 'utf8' });
        console.log('[analyze-file] Valid git repo:', repo_path);
    } catch (e) {
        console.error('[analyze-file] Invalid git repo:', repo_path, e.message);
        return res.status(400).json({ 
            error: `Invalid git repository path: ${repo_path}. Error: ${e.message}` 
        });
    }

    // 1. Fetch all AI records for this repo
    const repoName = path.basename(repo_path);
    console.log('[analyze-file] Searching for repo:', repoName);
    
    db.all('SELECT * FROM task_records WHERE repo_url LIKE ?', [`%${repoName}%`], (err, rows) => {
        if (err) {
            console.error('[analyze-file] Database error:', err.message);
            return res.status(500).json({ error: 'Database error' });
        }
        
        console.log(`[analyze-file] Found ${rows.length} records for repo`);

        // Map<hash, {content, genId}>
        // 使用内容哈希作为 key，而不是行号，因为人工插入/删除行会导致行号变化
        const aiLinesMap = new Map();

        // 2. Build the AI knowledge base from all historical diffs
        rows.forEach(row => {
            try {
                const buffer = Buffer.from(row.compressed_diff, 'base64');
                const decompressed = zlib.gunzipSync(buffer).toString('utf8');
                const files = parseDiff(decompressed);

                const targetFile = files.find(f => f.to === file_path || `b/${file_path}` === f.to || f.to?.endsWith(file_path));
                if (targetFile) {
                    targetFile.chunks.forEach(chunk => {
                        chunk.changes.forEach(change => {
                            if (change.type === 'add') {
                                const content = change.content.substring(1);
                                const hash = hashLine(content);
                                // 使用哈希作为 key，存储 AI 生成的行
                                if (!aiLinesMap.has(hash)) {
                                    aiLinesMap.set(hash, {
                                        content,
                                        generation_id: row.generation_id,
                                        timestamp: row.created_at
                                    });
                                }
                            }
                        });
                    });
                }
            } catch (e) {
                console.error('Error parsing diff:', e.message);
            }
        });
        
        console.log(`[analyze-file] Collected ${aiLinesMap.size} unique AI-generated lines`);

        // 3. Fetch current file content from Git
        try {
            console.log(`[analyze-file] Fetching file: git show ${branch}:${file_path}`);
            const currentFileContent = execSync(`git show ${branch}:${file_path}`, { 
                cwd: repo_path, 
                encoding: 'utf8',
                maxBuffer: 10 * 1024 * 1024
            });
            const lines = currentFileContent.split('\n');
            console.log(`[analyze-file] File has ${lines.length} lines`);

            // 4. Compare current lines with AI records (基于内容哈希而非行号)
            const analysis = lines.map((content, index) => {
                const lineNumber = index + 1;
                const currentHash = hashLine(content);
                
                // 通过内容哈希查找是否是 AI 生成的行
                const aiRecord = aiLinesMap.get(currentHash);

                let attribution = 'human';
                let genId = null;

                if (aiRecord) {
                    // 内容哈希匹配，说明这行是 AI 原始生成的（未被修改）
                    attribution = 'ai';
                    genId = aiRecord.generation_id;
                }

                return {
                    lineNumber,
                    content,
                    attribution,
                    generation_id: genId
                };
            });

            const stats = {
                total_lines: lines.length,
                ai_lines: analysis.filter(a => a.attribution === 'ai').length,
                modified_lines: analysis.filter(a => a.attribution === 'ai-modified').length,
                human_lines: analysis.filter(a => a.attribution === 'human').length
            };

            res.json({ file_path, stats, analysis });

        } catch (e) {
            console.error('Git error:', e.message);
            res.status(500).json({ error: `Failed to fetch file from Git: ${e.message}. Make sure repo_path is a valid absolute path to a git repo.` });
        }
    });
});

// ==================== GitHub API 集成 ====================

// GET /api/github/commits - 获取 GitHub 仓库的 commits 列表
app.get('/api/github/commits', async (req, res) => {
    const { repo_url, branch = 'main', per_page = 30, page = 1, github_token } = req.query;

    if (!repo_url) {
        return res.status(400).json({ error: 'Missing repo_url' });
    }

    try {
        // 优先使用查询参数中的 token，否则使用环境变量
        const token = github_token || process.env.GITHUB_TOKEN;
        const github = new GitHubApi(token);
        const commits = await github.getCommits(repo_url, branch, parseInt(per_page), parseInt(page));
        
        const formattedCommits = commits.map(commit => ({
            sha: commit.sha,
            message: commit.commit.message.split('\n')[0], // 只取第一行
            author: commit.commit.author.name,
            date: commit.commit.author.date,
            url: commit.html_url
        }));

        res.json({
            commits: formattedCommits,
            total: formattedCommits.length,
            page: parseInt(page),
            per_page: parseInt(per_page)
        });
    } catch (error) {
        console.error('[github/commits] Error:', error.message);
        res.status(500).json({ error: `Failed to get commits: ${error.message}` });
    }
});

// GET /api/github/commit-diff - 获取 GitHub commit 的 diff
app.get('/api/github/commit-diff', async (req, res) => {
    const { repo_url, sha, github_token } = req.query;

    if (!repo_url || !sha) {
        return res.status(400).json({ error: 'Missing repo_url or sha' });
    }

    try {
        // 优先使用查询参数中的 token，否则使用环境变量
        const token = github_token || process.env.GITHUB_TOKEN;
        const github = new GitHubApi(token);
        const diff = await github.getCommitDiff(repo_url, sha);
        
        res.setHeader('Content-Type', 'text/plain');
        res.send(diff);
    } catch (error) {
        console.error('[github/commit-diff] Error:', error.message);
        res.status(500).json({ error: `Failed to get commit diff: ${error.message}` });
    }
});

// GET /api/github/compare-diff - 获取两个 commit 之间的 diff
app.get('/api/github/compare-diff', async (req, res) => {
    const { repo_url, base, head, github_token } = req.query;

    if (!repo_url || !base || !head) {
        return res.status(400).json({ error: 'Missing repo_url, base, or head' });
    }

    try {
        // 优先使用查询参数中的 token，否则使用环境变量
        const token = github_token || process.env.GITHUB_TOKEN;
        const github = new GitHubApi(token);
        const diff = await github.getCompareDiff(repo_url, base, head);
        
        res.setHeader('Content-Type', 'text/plain');
        res.send(diff);
    } catch (error) {
        console.error('[github/compare-diff] Error:', error.message);
        res.status(500).json({ error: `Failed to get compare diff: ${error.message}` });
    }
});

// GET /api/github/pr-diff - 获取 Pull Request 的 diff
app.get('/api/github/pr-diff', async (req, res) => {
    const { repo_url, pull_number, github_token } = req.query;

    if (!repo_url || !pull_number) {
        return res.status(400).json({ error: 'Missing repo_url or pull_number' });
    }

    try {
        // 优先使用查询参数中的 token，否则使用环境变量
        const token = github_token || process.env.GITHUB_TOKEN;
        const github = new GitHubApi(token);
        const diff = await github.getPullRequestDiff(repo_url, parseInt(pull_number));
        
        res.setHeader('Content-Type', 'text/plain');
        res.send(diff);
    } catch (error) {
        console.error('[github/pr-diff] Error:', error.message);
        res.status(500).json({ error: `Failed to get PR diff: ${error.message}` });
    }
});

// GET /api/github/analyze-commit-range - 分析 GitHub commit 范围的 AI 代码占比
app.get('/api/github/analyze-commit-range', async (req, res) => {
    const { repo_url, base, head, github_token } = req.query;

    if (!repo_url || !base || !head) {
        return res.status(400).json({ error: 'Missing repo_url, base, or head' });
    }

    try {
        // 1. 从 GitHub 获取 diff
        // 优先使用查询参数中的 token，否则使用环境变量
        const token = github_token || process.env.GITHUB_TOKEN;
        const github = new GitHubApi(token);
        const diff = await github.getCompareDiff(repo_url, base, head);
        
        // 2. 解析 diff
        const files = parseDiff(diff);
        if (files.length === 0) {
            return res.json({
                repo_url,
                from_commit: base,
                to_commit: head,
                files: [],
                summary: { ai_lines: 0, total_added: 0, total_deleted: 0, ai_ratio: 0 }
            });
        }

        // 3. 从数据库获取 AI 代码知识库
        const repoName = path.basename(repo_url.replace('.git', ''));
        db.all('SELECT * FROM task_records WHERE repo_url LIKE ?', [`%${repoName}%`], async (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            // 4. 构建 AI 代码知识库（包括添加和删除）
            const allAiLines = buildAiLinesMap(rows, zlib, parseDiff);
            const allAiDeletes = buildAiDeletesMap(rows, zlib, parseDiff);

            // 5. 获取手动标记（按文件路径分组）
            const branch = head.includes('/') ? head.split('/').pop() : head;
            const manualAttrs = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT file_path, line_number, content_hash, attribution 
                     FROM manual_attributions 
                     WHERE repo_url = ? AND branch = ?`,
                    [repo_url, branch],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            // 按文件路径分组手动标记（按行号索引，包含内容哈希用于验证）
            const manualMapsByFile = new Map();
            manualAttrs.forEach(m => {
                if (!manualMapsByFile.has(m.file_path)) {
                    manualMapsByFile.set(m.file_path, new Map());
                }
                manualMapsByFile.get(m.file_path).set(m.line_number, {
                    attribution: m.attribution,
                    content_hash: m.content_hash
                });
            });

            // 6. 分析每个文件的变更
            const fileStats = [];
            let totalAiAdded = 0;
            let totalAdded = 0;
            let totalDeleted = 0;

            files.forEach(file => {
                const filePath = file.to || file.from;
                
                // 获取该文件的手动标记
                const manualMap = manualMapsByFile.get(filePath) || new Map();
                
                // 分析文件 diff
                const { changes, stats } = analyzeCommitRangeDiff(file, allAiLines, allAiDeletes);
                
                // 应用手动标记（行号和内容都必须匹配）
                const updatedChanges = changes.map(change => {
                    const manual = manualMap.get(change.lineNumber);
                    if (manual) {
                        const hash = hashLine(change.content);
                        if (manual.content_hash === hash) {
                            // 行号和内容都匹配，应用手动标记
                            return {
                                ...change,
                                isAI: manual.attribution === 'ai',
                                isManual: true,
                                autoAttribution: change.isAI ? 'ai' : 'human'
                            };
                        }
                        // 行号匹配但内容不匹配，标记为失效
                        return {
                            ...change,
                            manualInvalid: true
                        };
                    }
                    return change;
                });
                
                // 重新计算统计（考虑手动标记）
                const finalStats = {
                    ai_added: updatedChanges.filter(c => c.type === 'add' && c.isAI).length,
                    added: stats.added,
                    deleted: stats.deleted
                };
                
                fileStats.push({
                    file_path: filePath,
                    ai_lines: finalStats.ai_added,
                    added_lines: finalStats.added,
                    deleted_lines: finalStats.deleted,
                    ai_ratio: finalStats.added > 0 ? (finalStats.ai_added / finalStats.added * 100) : 0
                });

                totalAiAdded += finalStats.ai_added;
                totalAdded += finalStats.added;
                totalDeleted += finalStats.deleted;
            });

            res.json({
                repo_url,
                from_commit: base,
                to_commit: head,
                files: fileStats,
                summary: {
                    ai_lines: totalAiAdded,
                    total_added: totalAdded,
                    total_deleted: totalDeleted,
                    ai_ratio: totalAdded > 0 ? (totalAiAdded / totalAdded * 100) : 0
                },
                hasManualAttributions: manualAttrs.length > 0
            });
        });
    } catch (error) {
        console.error('[github/analyze-commit-range] Error:', error.message);
        res.status(500).json({ error: `Failed to analyze commit range: ${error.message}` });
    }
});

// GET /api/github/commit-range-file-diff - 获取 GitHub commit 范围内特定文件的 diff
app.get('/api/github/commit-range-file-diff', async (req, res) => {
    const { repo_url, file_path, from_commit, to_commit, github_token } = req.query;

    if (!repo_url || !file_path || !from_commit) {
        return res.status(400).json({ error: 'Missing repo_url, file_path, or from_commit' });
    }

    try {
        // 1. 从 GitHub 获取 commit range 的完整 diff
        const token = github_token || process.env.GITHUB_TOKEN;
        const github = new GitHubApi(token);
        const head = to_commit || 'HEAD';
        const diff = await github.getCompareDiff(repo_url, from_commit, head);
        
        // 2. 解析 diff，找到目标文件
        const files = parseDiff(diff);
        const normalizePath = (path) => path ? path.replace(/^[ab]\//, '') : '';
        const targetFile = files.find(file => {
            const fileTo = normalizePath(file.to);
            const fileFrom = normalizePath(file.from);
            const normalizedFilePath = file_path.replace(/^[ab]\//, '');
            return (fileTo === normalizedFilePath || fileFrom === normalizedFilePath || 
                    fileTo.endsWith('/' + normalizedFilePath) || fileFrom.endsWith('/' + normalizedFilePath));
        });

        if (!targetFile) {
            return res.json({
                file_path,
                from_commit,
                to_commit: head,
                changes: [],
                stats: { added: 0, deleted: 0, ai_added: 0, ai_deleted: 0 }
            });
        }

        // 3. 从数据库获取 AI 代码知识库
        const repoName = path.basename(repo_url.replace('.git', ''));
        db.all('SELECT * FROM task_records WHERE repo_url LIKE ?', [`%${repoName}%`], async (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            // 4. 构建 AI 代码知识库（包括添加和删除）
            const allAiLines = buildAiLinesMap(rows, zlib, parseDiff);
            const allAiDeletes = buildAiDeletesMap(rows, zlib, parseDiff);

            // 5. 获取手动标记
            const branch = head.includes('/') ? head.split('/').pop() : head;
            const manualAttrs = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT line_number, content_hash, attribution 
                     FROM manual_attributions 
                     WHERE repo_url = ? AND file_path = ? AND branch = ?`,
                    [repo_url, file_path, branch],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            // 构建手动标记 Map（按行号索引，验证内容哈希）
            const manualMap = new Map(
                manualAttrs.map(m => [m.line_number, {
                    attribution: m.attribution,
                    content_hash: m.content_hash
                }])
            );

            // 6. 分析文件 diff（传入 allAiDeletes 以支持识别 AI 删除操作）
            const { changes, stats } = analyzeCommitRangeDiff(targetFile, allAiLines, allAiDeletes);

            // 7. 应用手动标记（行号和内容都必须匹配）
            const updatedChanges = changes.map(change => {
                const manual = manualMap.get(change.lineNumber);
                if (manual) {
                    const hash = hashLine(change.content);
                    if (manual.content_hash === hash) {
                        // 行号和内容都匹配，应用手动标记
                        return {
                            ...change,
                            isAI: manual.attribution === 'ai',
                            isManual: true,
                            autoAttribution: change.isAI ? 'ai' : 'human'
                        };
                    }
                    // 行号匹配但内容不匹配，标记为失效
                    return {
                        ...change,
                        manualInvalid: true
                    };
                }
                return change;
            });

            // 8. 重新计算统计（考虑手动标记）
            const finalStats = {
                added: stats.added,
                deleted: stats.deleted,
                ai_added: updatedChanges.filter(c => c.type === 'add' && c.isAI).length,
                ai_deleted: updatedChanges.filter(c => c.type === 'del' && c.isAI).length
            };

            res.json({
                file_path: targetFile.to || targetFile.from || file_path,
                from_commit,
                to_commit: head,
                changes: updatedChanges,
                stats: finalStats,
                hasManualAttributions: manualAttrs.length > 0
            });
        });
    } catch (error) {
        console.error('[github/commit-range-file-diff] Error:', error.message);
        res.status(500).json({ error: `Failed to get file diff: ${error.message}` });
    }
});

// GET /api/github/analyze-file - 分析 GitHub 文件的 AI 代码归属
app.get('/api/github/analyze-file', async (req, res) => {
    const { repo_url, file_path, branch = 'main', github_token } = req.query;

    if (!repo_url || !file_path) {
        return res.status(400).json({ error: 'Missing repo_url or file_path' });
    }

    try {
        // 1. 从 GitHub 获取文件内容
        const token = github_token || process.env.GITHUB_TOKEN;
        const github = new GitHubApi(token);
        const fileContent = await github.getFileContent(repo_url, file_path, branch);
        const lines = fileContent.split('\n');

        // 2. 从数据库获取 AI 代码知识库
        const repoName = path.basename(repo_url.replace('.git', ''));
        db.all('SELECT * FROM task_records WHERE repo_url LIKE ?', [`%${repoName}%`], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            // 3. 构建 AI 代码知识库
            const allAiLines = buildAiLinesMap(rows, zlib, parseDiff);

            // 4. 分析文件归属
            const result = analyzeFileAttribution(lines, allAiLines);
            
            // 5. 获取并合并手动标记
            db.all(`
                SELECT line_number, attribution, content_hash
                FROM manual_attributions 
                WHERE repo_url = ? AND file_path = ? AND branch = ?
            `, [repo_url, file_path, branch], (manualErr, manualRows) => {
                if (manualErr) {
                    console.warn('[github/analyze-file] Failed to load manual attributions:', manualErr);
                    // 继续返回结果，只是没有手动标记
                }
                
                // 构建手动标记映射
                const manualMap = new Map();
                if (manualRows && manualRows.length > 0) {
                    manualRows.forEach(m => {
                        manualMap.set(m.line_number, {
                            attribution: m.attribution,
                            content_hash: m.content_hash
                        });
                    });
                }
                
                // 合并手动标记到分析结果
                result.analysis = result.analysis.map(line => {
                    const manual = manualMap.get(line.lineNumber);
                    
                    if (manual) {
                        // 验证内容是否匹配（防止文件变更后标记失效）
                        const currentHash = hashLine(line.content);
                        const isValid = currentHash === manual.content_hash;
                        
                        return {
                            ...line,
                            attribution: isValid ? manual.attribution : line.attribution,
                            isManual: isValid,
                            autoAttribution: line.attribution,
                            manualInvalid: !isValid  // 标记手动标记是否失效
                        };
                    }
                    
                    return line;
                });
                
                // 重新计算统计（考虑手动标记）
                const aiCount = result.analysis.filter(l => l.attribution === 'ai').length;
                const humanCount = result.analysis.filter(l => l.attribution === 'human').length;
                result.stats.ai_lines = aiCount;
                result.stats.human_lines = humanCount;

                res.json({
                    file_path,
                    stats: result.stats,
                    analysis: result.analysis,
                    duplicateStats: result.duplicateStats,
                    warning: result.warning,
                    hasManualAttributions: manualMap.size > 0,
                    manualAttributionCount: manualMap.size
                });
            });
        });
    } catch (error) {
        console.error('[github/analyze-file] Error:', error.message);
        res.status(500).json({ error: `Failed to analyze file: ${error.message}` });
    }
});

// GET /api/github/analyze-pr - 分析 Pull Request 的 AI 代码占比
app.get('/api/github/analyze-pr', async (req, res) => {
    const { repo_url, pull_number, github_token } = req.query;

    if (!repo_url || !pull_number) {
        return res.status(400).json({ error: 'Missing repo_url or pull_number' });
    }

    try {
        // 1. 从 GitHub 获取 PR diff
        // 优先使用查询参数中的 token，否则使用环境变量
        const token = github_token || process.env.GITHUB_TOKEN;
        const github = new GitHubApi(token);
        const diff = await github.getPullRequestDiff(repo_url, parseInt(pull_number));
        
        // 2. 解析 diff
        const files = parseDiff(diff);
        if (files.length === 0) {
            return res.json({
                repo_url,
                pull_number: parseInt(pull_number),
                files: [],
                summary: { ai_lines: 0, total_added: 0, total_deleted: 0, ai_ratio: 0 }
            });
        }

        // 3. 从数据库获取 AI 代码知识库
        const repoName = path.basename(repo_url.replace('.git', ''));
        db.all('SELECT * FROM task_records WHERE repo_url LIKE ?', [`%${repoName}%`], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            // 4. 构建 AI 代码知识库
            const allAiLines = buildAiLinesMap(rows, zlib, parseDiff);

            // 5. 分析每个文件的变更
            const fileStats = [];
            let totalAiAdded = 0;
            let totalAdded = 0;
            let totalDeleted = 0;

            files.forEach(file => {
                const { changes, stats } = analyzeCommitRangeDiff(file, allAiLines);
                
                fileStats.push({
                    file_path: file.to || file.from,
                    ai_lines: stats.ai_added,
                    added_lines: stats.added,
                    deleted_lines: stats.deleted,
                    ai_ratio: stats.added > 0 ? (stats.ai_added / stats.added * 100) : 0
                });

                totalAiAdded += stats.ai_added;
                totalAdded += stats.added;
                totalDeleted += stats.deleted;
            });

            res.json({
                repo_url,
                pull_number: parseInt(pull_number),
                files: fileStats,
                summary: {
                    ai_lines: totalAiAdded,
                    total_added: totalAdded,
                    total_deleted: totalDeleted,
                    ai_ratio: totalAdded > 0 ? (totalAiAdded / totalAdded * 100) : 0
                }
            });
        });
    } catch (error) {
        console.error('[github/analyze-pr] Error:', error.message);
        res.status(500).json({ error: `Failed to analyze PR: ${error.message}` });
    }
});

// ========================================
// 手动标记 API
// ========================================

// POST /api/manual-attribution - 保存手动标记
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

    // 使用事务批量插入/更新
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

// GET /api/manual-attribution - 获取手动标记
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
            console.error('[manual-attribution] Error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        res.json({ 
            manual_attributions: rows || [],
            count: rows ? rows.length : 0
        });
    });
});

// DELETE /api/manual-attribution - 删除特定行的手动标记
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
        // 删除特定行
        sql = `DELETE FROM manual_attributions 
               WHERE repo_url = ? AND file_path = ? AND branch = ? AND line_number = ?`;
        params = [repo_url, file_path, branch, parseInt(line_number)];
    } else {
        // 删除整个文件的所有标记
        sql = `DELETE FROM manual_attributions 
               WHERE repo_url = ? AND file_path = ? AND branch = ?`;
        params = [repo_url, file_path, branch];
    }

    db.run(sql, params, function(err) {
        if (err) {
            console.error('[manual-attribution] Delete error:', err);
            return res.status(500).json({ error: 'Failed to delete manual attributions' });
        }

        res.json({ 
            success: true, 
            deleted: this.changes,
            message: `Deleted ${this.changes} manual attribution(s)` 
        });
    });
});

const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log('Press Ctrl+C to stop the server');
    console.log('');
});

// 处理未捕获的异常，防止进程意外退出
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // 不要立即退出，让服务器继续运行
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // 不要立即退出，让服务器继续运行
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
            } else {
                console.log('Database closed');
            }
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('\nSIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
            } else {
                console.log('Database closed');
            }
            process.exit(0);
        });
    });
});

module.exports = { app, db, server };

