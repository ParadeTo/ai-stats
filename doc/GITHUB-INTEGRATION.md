# GitHub API 集成使用指南

## 概述

系统现在支持直接从 GitHub 获取代码 diff 信息并进行 AI 代码分析，无需本地 Git 仓库。这对于分析已推送到 GitHub 的代码非常有用。

## GitHub API 认证

GitHub API 有速率限制：
- **未认证**：每小时 60 次请求
- **已认证**：每小时 5000 次请求

建议使用 GitHub Personal Access Token 进行认证。

### 获取 GitHub Token

1. 访问 https://github.com/settings/tokens
2. 点击 "Generate new token (classic)"
3. 选择权限：至少需要 `public_repo`（公开仓库）或 `repo`（私有仓库）
4. 生成并复制 token

### 配置 Token

**推荐方式：使用 `.env` 文件（更安全）**

1. 在 `server` 目录下创建 `.env` 文件：
```bash
cd server
cp .env.example .env
```

2. 编辑 `.env` 文件，填入你的 token：
```env
GITHUB_TOKEN=ghp_your_token_here
```

3. 重启服务器，系统会自动从 `.env` 文件读取 token

**备选方式：通过查询参数传递（不推荐，仅用于测试）**

如果 `.env` 文件中没有配置 token，也可以通过查询参数传递（向后兼容）：
```
?github_token=ghp_your_token_here
```

**注意**：`.env` 文件已被 `.gitignore` 排除，不会被提交到代码仓库。

## API 端点说明

### 1. 获取 Commits 列表

获取指定仓库的 commits 列表。

**请求**：
```http
GET /api/github/commits?repo_url=https://github.com/owner/repo&branch=main&per_page=30&page=1&github_token=YOUR_TOKEN
```

**参数**：
- `repo_url` (必需): GitHub 仓库 URL，支持多种格式：
  - `https://github.com/owner/repo.git`
  - `https://github.com/owner/repo`
  - `owner/repo`
- `branch` (可选): 分支名，默认 `main`
- `per_page` (可选): 每页数量，默认 30，最大 100
- `page` (可选): 页码，默认 1
- `github_token` (可选): GitHub Personal Access Token（如果 `.env` 中已配置，可省略）

**响应示例**：
```json
{
  "commits": [
    {
      "sha": "abc123def456...",
      "message": "Add new feature",
      "author": "John Doe",
      "date": "2024-01-15T10:30:00Z",
      "url": "https://github.com/owner/repo/commit/abc123..."
    }
  ],
  "total": 30,
  "page": 1,
  "per_page": 30
}
```

### 2. 获取单个 Commit 的 Diff

获取指定 commit 的完整 diff。

**请求**：
```http
GET /api/github/commit-diff?repo_url=https://github.com/owner/repo&sha=abc123&github_token=YOUR_TOKEN
```

**参数**：
- `repo_url` (必需): GitHub 仓库 URL
- `sha` (必需): Commit SHA
- `github_token` (可选): GitHub token（如果 `.env` 中已配置，可省略）

**响应**：返回 Git diff 格式的纯文本

### 3. 比较两个 Commit 的 Diff

获取两个 commit 之间的 diff。

**请求**：
```http
GET /api/github/compare-diff?repo_url=https://github.com/owner/repo&base=main&head=feature-branch&github_token=YOUR_TOKEN
```

**参数**：
- `repo_url` (必需): GitHub 仓库 URL
- `base` (必需): 基础 commit SHA 或分支名
- `head` (必需): 目标 commit SHA 或分支名
- `github_token` (可选): GitHub token

**响应**：返回 Git diff 格式的纯文本

### 4. 获取 Pull Request 的 Diff

获取指定 PR 的 diff。

**请求**：
```http
GET /api/github/pr-diff?repo_url=https://github.com/owner/repo&pull_number=123&github_token=YOUR_TOKEN
```

**参数**：
- `repo_url` (必需): GitHub 仓库 URL
- `pull_number` (必需): PR 编号
- `github_token` (可选): GitHub token

**响应**：返回 Git diff 格式的纯文本

### 5. 分析 Commit 范围的 AI 代码占比

分析两个 commit 之间的 AI 代码占比（核心功能）。

**请求**：
```http
GET /api/github/analyze-commit-range?repo_url=https://github.com/owner/repo&base=main&head=feature-branch&github_token=YOUR_TOKEN
```

**参数**：
- `repo_url` (必需): GitHub 仓库 URL
- `base` (必需): 基础 commit SHA 或分支名
- `head` (必需): 目标 commit SHA 或分支名
- `github_token` (可选): GitHub token

**响应示例**：
```json
{
  "repo_url": "https://github.com/owner/repo",
  "from_commit": "main",
  "to_commit": "feature-branch",
  "files": [
    {
      "file_path": "src/utils.js",
      "ai_lines": 15,
      "added_lines": 25,
      "deleted_lines": 5,
      "ai_ratio": 60.0
    }
  ],
  "summary": {
    "ai_lines": 15,
    "total_added": 25,
    "total_deleted": 5,
    "ai_ratio": 60.0
  }
}
```

### 6. 分析 Pull Request 的 AI 代码占比

分析指定 PR 的 AI 代码占比。

**请求**：
```http
GET /api/github/analyze-pr?repo_url=https://github.com/owner/repo&pull_number=123&github_token=YOUR_TOKEN
```

**参数**：
- `repo_url` (必需): GitHub 仓库 URL
- `pull_number` (必需): PR 编号
- `github_token` (可选): GitHub token

**响应格式**：与 `analyze-commit-range` 相同

## 使用示例

### 示例 1：分析 GitHub 仓库的 PR

假设你想分析 PR #42 的 AI 代码占比：

**如果已配置 `.env` 文件**（推荐）：
```bash
curl "http://localhost:3001/api/github/analyze-pr?repo_url=https://github.com/youxingzhi/ai-stat-demo&pull_number=42"
```

**如果未配置 `.env` 文件**：
```bash
curl "http://localhost:3001/api/github/analyze-pr?repo_url=https://github.com/youxingzhi/ai-stat-demo&pull_number=42&github_token=ghp_xxxxxxxxxxxx"
```

### 示例 2：分析两个 commit 之间的差异

假设你想分析 `main` 分支和 `feature-branch` 分支之间的差异：

**如果已配置 `.env` 文件**（推荐）：
```bash
curl "http://localhost:3001/api/github/analyze-commit-range?repo_url=https://github.com/youxingzhi/ai-stat-demo&base=main&head=feature-branch"
```

**如果未配置 `.env` 文件**：
```bash
curl "http://localhost:3001/api/github/analyze-commit-range?repo_url=https://github.com/youxingzhi/ai-stat-demo&base=main&head=feature-branch&github_token=ghp_xxxxxxxxxxxx"
```

### 示例 3：获取 commits 列表（用于前端选择）

**如果已配置 `.env` 文件**（推荐）：
```bash
curl "http://localhost:3001/api/github/commits?repo_url=https://github.com/youxingzhi/ai-stat-demo&branch=main&per_page=50"
```

**如果未配置 `.env` 文件**：
```bash
curl "http://localhost:3001/api/github/commits?repo_url=https://github.com/youxingzhi/ai-stat-demo&branch=main&per_page=50&github_token=ghp_xxxxxxxxxxxx"
```

### 示例 4：在 JavaScript 中使用

**如果已配置 `.env` 文件**（推荐，无需传递 token）：
```javascript
// 获取 commits 列表
const response = await fetch(
  'http://localhost:3001/api/github/commits?' + 
  new URLSearchParams({
    repo_url: 'https://github.com/youxingzhi/ai-stat-demo',
    branch: 'main',
    per_page: '50'
  })
);
const data = await response.json();
console.log('Commits:', data.commits);

// 分析 commit 范围
const analyzeResponse = await fetch(
  'http://localhost:3001/api/github/analyze-commit-range?' +
  new URLSearchParams({
    repo_url: 'https://github.com/youxingzhi/ai-stat-demo',
    base: 'main',
    head: 'feature-branch'
  })
);
const stats = await analyzeResponse.json();
console.log('AI Code Ratio:', stats.summary.ai_ratio + '%');
```

**如果未配置 `.env` 文件**（需要在代码中传递 token，不推荐）：
```javascript
const githubToken = 'ghp_xxxxxxxxxxxx'; // 不推荐：token 暴露在代码中

const response = await fetch(
  'http://localhost:3001/api/github/commits?' + 
  new URLSearchParams({
    repo_url: 'https://github.com/youxingzhi/ai-stat-demo',
    branch: 'main',
    per_page: '50',
    github_token: githubToken
  })
);
```

## 工作原理

1. **获取 Diff**：系统通过 GitHub API 获取指定 commit 或 PR 的 diff
2. **解析 Diff**：使用 `parse-diff` 库解析 Git diff 格式
3. **匹配 AI 代码**：从数据库中查询历史 AI 生成记录，构建 AI 代码知识库
4. **内容哈希匹配**：对 diff 中的每一行代码计算哈希值，与 AI 知识库匹配
5. **统计分析**：计算 AI 代码占比、新增/删除行数等统计信息

## 注意事项

1. **GitHub Token 安全**：
   - ✅ **推荐**：使用 `.env` 文件存储 token（已自动排除在 `.gitignore` 中）
   - ❌ **不推荐**：在代码或 URL 中硬编码 token
   - Token 只需要 `public_repo` 权限即可（公开仓库）
   - 如果 `.env` 中已配置 token，API 调用时无需传递 `github_token` 参数

2. **速率限制**：
   - 未认证用户每小时 60 次请求
   - 已认证用户每小时 5000 次请求
   - 如果超过限制，API 会返回 403 错误

3. **仓库 URL 格式**：
   - 支持多种格式：完整 URL、简短格式（owner/repo）
   - 系统会自动解析并提取 owner 和 repo 名称

4. **AI 代码识别**：
   - 系统只能识别**已经通过 Cursor 插件捕获**的 AI 代码
   - 如果代码是直接推送到 GitHub 而没有经过 Cursor 插件，系统无法识别
   - 建议在使用 GitHub 分析前，确保相关代码已经通过 Cursor 插件生成并记录

## 与本地 Git 分析的对比

| 特性 | 本地 Git 分析 | GitHub API 分析 |
|------|--------------|----------------|
| 需要本地仓库 | ✅ 是 | ❌ 否 |
| 需要 GitHub 访问 | ❌ 否 | ✅ 是 |
| 分析速度 | 快 | 中等（网络请求） |
| 支持私有仓库 | ✅ 是 | ✅ 是（需要 token） |
| 支持 PR 分析 | ❌ 否 | ✅ 是 |
| 实时性 | ✅ 实时 | ✅ 实时 |

## 未来改进

- [ ] 支持批量分析多个 PR
- [ ] 缓存 GitHub API 响应以提高性能
- [ ] 支持 GitHub Enterprise Server
- [ ] 支持 GitLab、Bitbucket 等其他 Git 托管平台

