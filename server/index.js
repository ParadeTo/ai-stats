const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const zlib = require('zlib');
const path = require('path');
const parseDiff = require('parse-diff');
const crypto = require('crypto');
const { execSync } = require('child_process');

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

// Helper: Hash a single line of code
function hashLine(line) {
    return crypto.createHash('sha256')
        .update(line.trim())
        .digest('hex')
        .substring(0, 16);
}

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

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

module.exports = { app, db };

