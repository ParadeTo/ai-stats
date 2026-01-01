# 前端 Dashboard 使用指南

## 🎯 实现的功能

### 1. 项目列表页 (`/`)
- 显示所有项目的统计信息
- 包含：仓库名称、分支名称、AI 代码占比、作者、最后更新时间
- 点击项目可进入详情页

### 2. 文件详情页 (`/project/:repoUrl/:branch`)
- 左侧显示文件列表，包含 AI 生成行数和人工修改行数
- 右侧显示选中文件的逐行代码归属
- 颜色标识：
  - 绿色背景：AI 原始生成的代码
  - 黄色背景：AI 生成后被人工修改的代码
  - 白色背景：纯人工编写的代码

## 🚀 启动步骤

### 方案 1：升级 Node.js（推荐）

```bash
# 使用 nvm 安装 Node.js 20+
nvm install 20
nvm use 20

# 启动后端
cd server
node index.js &

# 启动前端
cd ../dashboard
npm run dev
```

### 方案 2：降级 Vite

如果不想升级 Node.js，可以降级 Vite：

```bash
cd dashboard
npm install vite@5.4.11 @vitejs/plugin-react@4.3.4 --save-dev
npm run dev
```

## 📂 项目结构

```
dashboard/
├── src/
│   ├── pages/
│   │   ├── ProjectList.tsx    # 项目列表页
│   │   └── FileDetail.tsx     # 文件详情页
│   ├── App.tsx                # 路由配置
│   ├── App.css                # 全局样式
│   └── main.tsx               # 入口文件
└── package.json
```

## 🔌 后端 API

### 1. 获取项目列表
```
GET /api/projects
返回: [
  {
    repo_url: string,
    branch_name: string,
    user_id: string,
    ai_lines: number,
    total_lines: number,
    ai_ratio: number,
    last_generation: string
  }
]
```

### 2. 获取项目文件列表
```
GET /api/project-files?repo_url=xxx&branch=xxx
返回: [
  {
    file_path: string,
    ai_lines: number,
    manual_lines: number,
    unchanged_lines: number,
    total_lines: number,
    ai_ratio: number
  }
]
```

### 3. 获取文件详细分析
```
GET /api/analyze-file?repo_path=/local/path&file_path=src/file.ts
返回: {
  file_path: string,
  stats: {
    total_lines: number,
    ai_lines: number,
    modified_lines: number,
    human_lines: number
  },
  analysis: [
    {
      lineNumber: number,
      content: string,
      attribution: 'ai' | 'ai-modified' | 'human',
      generation_id: string | null
    }
  ]
}
```

## 🎨 界面截图说明

### 项目列表页
- 顶部显示总体统计：项目数、AI 生成行数、平均 AI 占比
- 表格显示各个项目的详细信息
- 点击任意行进入详情页

### 文件详情页
- 顶部显示项目名称和分支
- 需要输入本地仓库路径（用于读取当前文件内容）
- 左侧文件列表显示所有变更文件
- 右侧逐行展示代码归属
  - 行号 | 归属图标 | 代码内容
  - 图标：CPU（AI）、铅笔（修改）、人像（人工）

## ⚠️ 注意事项

1. **本地仓库路径**：在文件详情页需要输入本地 Git 仓库的绝对路径，用于读取当前文件内容进行对比
2. **后端服务**：确保后端服务运行在 `http://localhost:3001`
3. **数据同步**：每次在 Cursor 中使用 AI 生成代码并 Accept 后，数据会自动上报到后端

## 🔧 故障排查

### 前端无法启动
- 检查 Node.js 版本：`node --version`
- 应该 >= 20.19.0 或 >= 22.12.0

### 无法获取数据
- 确认后端服务运行：`curl http://localhost:3001/api/projects`
- 检查浏览器控制台是否有 CORS 错误

### 文件分析失败
- 确认输入的本地仓库路径正确
- 确认路径下是 Git 仓库：`cd /your/path && git status`
- 确认文件在 Git 中存在：`git show HEAD:file_path`

## 📝 下一步改进

- [ ] 添加日期范围筛选
- [ ] 支持多仓库对比
- [ ] 导出统计报告
- [ ] 实时数据刷新
- [ ] 代码归属的可视化时间线

