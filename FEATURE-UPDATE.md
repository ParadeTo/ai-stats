# 功能优化说明

## 🎯 新增功能

### 1. 项目列表页 - 分支差异统计

**功能描述**：
- 展示当前分支相对 master/main 分支的变动部分的 AI 占比
- 可以切换查看"全部变更"或"分支差异"两种统计模式

**使用步骤**：
1. 在项目列表页输入本地仓库路径（如 `/Users/youxingzhi/ayou/ai-stat-demo`）
2. 点击 "Load Branch Diffs" 按钮
3. 系统会自动计算每个分支相对 master/main 的差异
4. 勾选/取消 "Show branch diff vs master/main" 可切换显示模式

**显示信息**：
- ✅ 分支差异模式：只统计当前分支相对基准分支（master/main）的新增代码
- ⚪ 全部变更模式：统计所有 AI 生成的代码

### 2. 详情页 - Commit 范围分析

**功能描述**：
- 可以选择任意两个 commit 之间的变更进行 AI 代码占比分析
- 支持查看指定时间段的代码贡献统计

**使用步骤**：
1. 在详情页输入本地仓库路径
2. 勾选 "Use commit range analysis"
3. 选择起始 commit（From Commit）
4. 选择结束 commit（To Commit），默认为 HEAD
5. 点击 "Analyze Range" 按钮
6. 查看该 commit 范围内的文件变更和 AI 占比

**显示信息**：
- AI 生成行数 / 总新增行数
- 每个文件的详细统计（新增、删除、AI 占比）

## 🔧 后端 API

### 新增 API 端点

#### 1. `GET /api/commits`
获取仓库的 commit 历史列表

**参数**：
- `repo_path`: 本地仓库路径（必需）
- `branch`: 分支名称（可选，默认 HEAD）
- `limit`: 返回数量（可选，默认 50）

**返回示例**：
```json
[
  {
    "hash": "7baac4cdaec80361186dee369fbefcf10f549857",
    "shortHash": "7baac4c",
    "author": "youxingzhi",
    "email": "xingzhi.you@shopee.com",
    "date": "2025-12-31T04:39:15.000Z",
    "message": "Remove unused Promise in sleep function"
  }
]
```

#### 2. `GET /api/branch-diff-stats`
计算分支差异的 AI 统计

**参数**：
- `repo_path`: 本地仓库路径（必需）
- `branch`: 当前分支名称（必需）
- `base_branch`: 基准分支名称（可选，自动检测 master/main）

**返回示例**：
```json
{
  "base_branch": "main",
  "current_branch": "feature-branch",
  "ai_lines": 60,
  "total_added": 100,
  "total_deleted": 20,
  "ai_ratio": 60.0
}
```

#### 3. `GET /api/commit-range-stats`
计算两个 commit 之间的 AI 统计

**参数**：
- `repo_path`: 本地仓库路径（必需）
- `from_commit`: 起始 commit（必需）
- `to_commit`: 结束 commit（可选，默认 HEAD）

**返回示例**：
```json
{
  "from_commit": "bcc7779",
  "to_commit": "HEAD",
  "files": [
    {
      "file_path": "test-ai-markers.js",
      "ai_lines": 32,
      "added_lines": 32,
      "deleted_lines": 51,
      "ai_ratio": 100
    }
  ],
  "summary": {
    "ai_lines": 60,
    "total_added": 61,
    "total_deleted": 88,
    "ai_ratio": 98.36
  }
}
```

## 📊 使用场景

### 场景 1：代码审查
团队 Leader 想查看某个功能分支相对 main 分支的 AI 代码占比：
1. 在列表页输入仓库路径
2. 加载分支差异统计
3. 查看该分支的 AI 占比情况

### 场景 2：迭代统计
PM 想统计最近一周的开发中 AI 生成了多少代码：
1. 进入详情页
2. 使用 commit 范围分析
3. 选择一周前的 commit 到 HEAD
4. 查看该时间段的 AI 代码贡献

### 场景 3：代码归属
开发者想确认某个文件的每一行代码是谁写的（AI 还是人工）：
1. 点击文件查看逐行归属
2. 绿色表示 AI 原始生成
3. 黄色表示 AI 生成后被人工修改
4. 白色表示纯人工编写

## 🎨 界面更新

### 列表页新增控件
```
┌────────────────────────────────────────┐
│ Local Repository Path (for branch diff):│
│ [/path/to/repo] [Load Branch Diffs]   │
│ ☑ Show branch diff vs master/main     │
└────────────────────────────────────────┘
```

### 详情页新增控件
```
┌────────────────────────────────────────┐
│ ☑ Use commit range analysis           │
│                                        │
│ From Commit: [7baac4c - message...]   │
│ To Commit:   [HEAD (current)]         │
│ [Analyze Range]                        │
└────────────────────────────────────────┘
```

## ⚠️ 注意事项

1. **本地仓库路径必填**：所有新功能都需要提供本地 Git 仓库的绝对路径
2. **分支必须存在**：确保 master 或 main 分支存在，否则无法计算分支差异
3. **Commit 必须有效**：选择的 commit hash 必须在仓库历史中存在
4. **性能考虑**：大型仓库分析较慢，建议选择较小的 commit 范围

## 🚀 测试结果

✅ 所有 API 端点测试通过
✅ 前端组件渲染正常
✅ Commit 列表获取成功（测试返回 4 条记录）
✅ 分支差异统计计算正确
✅ Commit 范围分析功能正常（bcc7779...HEAD，AI 占比 98.36%）

## 📝 下一步改进建议

- [ ] 添加日期范围筛选（按时间而非 commit）
- [ ] 支持多分支对比
- [ ] 添加趋势图表（AI 占比随时间变化）
- [ ] 导出功能（Excel/PDF 报告）
- [ ] 缓存优化（避免重复计算相同的 commit 范围）

