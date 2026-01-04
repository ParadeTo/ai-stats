const https = require('https');

/**
 * GitHub API 客户端
 * 用于从 GitHub 获取 commit diff 和 PR diff 信息
 */
class GitHubApi {
    constructor(token) {
        this.token = token;
        this.baseUrl = 'api.github.com';
    }

    /**
     * 发送 GitHub API 请求
     */
    request(path, options = {}) {
        return new Promise((resolve, reject) => {
            const headers = {
                'User-Agent': 'AI-Code-Tracker',
                ...(options.headers || {}),
            };

            // 如果没有指定 Accept，默认使用 diff 格式
            if (!options.headers || !options.headers['Accept']) {
                headers['Accept'] = 'application/vnd.github.v3.diff';
            }

            if (this.token) {
                headers['Authorization'] = `token ${this.token}`;
            }

            const reqOptions = {
                hostname: this.baseUrl,
                path: path,
                method: options.method || 'GET',
                headers: headers,
            };

            const req = https.request(reqOptions, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(data);
                    } else {
                        reject(new Error(`GitHub API error: ${res.statusCode} - ${data}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.end();
        });
    }

    /**
     * 解析 GitHub 仓库 URL，提取 owner 和 repo
     * 支持格式：
     * - https://github.com/owner/repo.git
     * - https://github.com/owner/repo
     * - git@github.com:owner/repo.git
     * - owner/repo
     */
    parseRepoUrl(repoUrl) {
        let owner, repo;

        if (repoUrl.includes('github.com')) {
            const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
            if (match) {
                owner = match[1];
                repo = match[2].replace('.git', '');
            }
        } else if (repoUrl.includes('/')) {
            const parts = repoUrl.split('/');
            owner = parts[parts.length - 2];
            repo = parts[parts.length - 1].replace('.git', '');
        } else {
            throw new Error(`Invalid GitHub repository URL: ${repoUrl}`);
        }

        if (!owner || !repo) {
            throw new Error(`Cannot parse repository URL: ${repoUrl}`);
        }

        return { owner, repo };
    }

    /**
     * 获取单个 commit 的 diff
     * @param {string} repoUrl - GitHub 仓库 URL
     * @param {string} sha - Commit SHA
     * @returns {Promise<string>} - Git diff 格式的字符串
     */
    async getCommitDiff(repoUrl, sha) {
        const { owner, repo } = this.parseRepoUrl(repoUrl);
        const path = `/repos/${owner}/${repo}/commits/${sha}`;

        try {
            const diff = await this.request(path);
            return diff;
        } catch (error) {
            throw new Error(`Failed to get commit diff: ${error.message}`);
        }
    }

    /**
     * 比较两个 commit 之间的 diff
     * @param {string} repoUrl - GitHub 仓库 URL
     * @param {string} base - 基础 commit SHA 或分支名
     * @param {string} head - 目标 commit SHA 或分支名
     * @returns {Promise<string>} - Git diff 格式的字符串
     */
    async getCompareDiff(repoUrl, base, head) {
        const { owner, repo } = this.parseRepoUrl(repoUrl);
        const path = `/repos/${owner}/${repo}/compare/${base}...${head}`;

        try {
            const diff = await this.request(path);
            return diff;
        } catch (error) {
            throw new Error(`Failed to get compare diff: ${error.message}`);
        }
    }

    /**
     * 获取 Pull Request 的 diff
     * @param {string} repoUrl - GitHub 仓库 URL
     * @param {number} pullNumber - PR 编号
     * @returns {Promise<string>} - Git diff 格式的字符串
     */
    async getPullRequestDiff(repoUrl, pullNumber) {
        // 先获取 PR 信息
        const prInfo = await this.getPullRequestInfo(repoUrl, pullNumber);
        const base = prInfo.base.ref;
        const head = prInfo.head.sha;

        // 使用 compare API 获取 diff
        return await this.getCompareDiff(repoUrl, base, head);
    }

    /**
     * 获取仓库的所有 commits（分页）
     * @param {string} repoUrl - GitHub 仓库 URL
     * @param {string} branch - 分支名（默认：main）
     * @param {number} perPage - 每页数量（默认：30，最大：100）
     * @param {number} page - 页码（默认：1）
     * @returns {Promise<Array>} - Commit 列表
     */
    async getCommits(repoUrl, branch = 'main', perPage = 30, page = 1) {
        const { owner, repo } = this.parseRepoUrl(repoUrl);
        const path = `/repos/${owner}/${repo}/commits?sha=${branch}&per_page=${perPage}&page=${page}`;

        try {
            const response = await this.request(path, {
                headers: { 'Accept': 'application/vnd.github.v3+json' }
            });
            return JSON.parse(response);
        } catch (error) {
            throw new Error(`Failed to get commits: ${error.message}`);
        }
    }

    /**
     * 获取 Pull Request 信息（JSON 格式）
     * @param {string} repoUrl - GitHub 仓库 URL
     * @param {number} pullNumber - PR 编号
     * @returns {Promise<Object>} - PR 信息对象
     */
    async getPullRequestInfo(repoUrl, pullNumber) {
        const { owner, repo } = this.parseRepoUrl(repoUrl);
        const path = `/repos/${owner}/${repo}/pulls/${pullNumber}`;

        try {
            const response = await this.request(path, {
                headers: { 'Accept': 'application/vnd.github.v3+json' }
            });
            return JSON.parse(response);
        } catch (error) {
            throw new Error(`Failed to get PR info: ${error.message}`);
        }
    }

    /**
     * 获取文件内容
     * @param {string} repoUrl - GitHub 仓库 URL
     * @param {string} filePath - 文件路径
     * @param {string} ref - 分支名或 commit SHA（默认：main）
     * @returns {Promise<string>} - 文件内容（Base64 编码）
     */
    async getFileContent(repoUrl, filePath, ref = 'main') {
        const { owner, repo } = this.parseRepoUrl(repoUrl);
        const path = `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${ref}`;

        try {
            const response = await this.request(path, {
                headers: { 'Accept': 'application/vnd.github.v3+json' }
            });
            const fileInfo = JSON.parse(response);
            
            // GitHub API 返回 Base64 编码的内容
            if (fileInfo.encoding === 'base64' && fileInfo.content) {
                return Buffer.from(fileInfo.content, 'base64').toString('utf8');
            } else {
                throw new Error('Unexpected file encoding or missing content');
            }
        } catch (error) {
            throw new Error(`Failed to get file content: ${error.message}`);
        }
    }
}

module.exports = GitHubApi;

