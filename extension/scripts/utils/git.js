const { execSync } = require('child_process');
const { log } = require('./config');

/**
 * 获取 Git 仓库 URL
 */
function getGitRepoUrl(cwd = process.cwd()) {
    try {
        return execSync('git config --get remote.origin.url', {
            encoding: 'utf8',
            cwd
        }).trim();
    } catch (e) {
        log(`getGitRepoUrl failed in ${cwd}: ${e.message}`);
        return 'unknown';
    }
}

/**
 * 获取当前分支名
 */
function getGitBranch(cwd = process.cwd()) {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', {
            encoding: 'utf8',
            cwd
        }).trim();
    } catch (e) {
        log(`getGitBranch failed in ${cwd}: ${e.message}`);
        return 'unknown';
    }
}

/**
 * 获取当前 commit ID
 */
function getGitCommitId(cwd = process.cwd()) {
    try {
        return execSync('git rev-parse HEAD', {
            encoding: 'utf8',
            cwd
        }).trim();
    } catch (e) {
        log(`getGitCommitId failed in ${cwd}: ${e.message}`);
        return 'unknown';
    }
}

/**
 * 获取 Git diff（未提交的变更）
 */
function getGitDiff(cwd = process.cwd()) {
    try {
        // 获取所有未暂存和已暂存的变更
        const diff = execSync('git diff HEAD', {
            encoding: 'utf8',
            cwd,
            maxBuffer: 10 * 1024 * 1024 // 10MB
        });
        log(`getGitDiff success in ${cwd}, diff length: ${diff.length}`);
        return diff;
    } catch (e) {
        log(`getGitDiff failed in ${cwd}: ${e.message}`);
        return '';
    }
}

/**
 * 分析 diff 统计新增和删除行数
 */
function analyzeDiff(diff) {
    let added = 0;
    let deleted = 0;
    
    if (!diff) {
        return { added, deleted };
    }

    const lines = diff.split('\n');
    for (const line of lines) {
        // 统计以 + 开头但不是 +++ 的行（新增行）
        if (line.startsWith('+') && !line.startsWith('+++')) {
            added++;
        } 
        // 统计以 - 开头但不是 --- 的行（删除行）
        else if (line.startsWith('-') && !line.startsWith('---')) {
            deleted++;
        }
    }

    return { added, deleted };
}

module.exports = {
    getGitRepoUrl,
    getGitBranch,
    getGitCommitId,
    getGitDiff,
    analyzeDiff
};

