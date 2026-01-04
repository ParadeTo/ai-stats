# AI 删除识别优化

## 问题

用户反馈：删除的代码只要是 AI 删除的，不管之前是不是 AI 添加的，都应该算 AI 删除。

### 原始行为

```javascript
// 旧逻辑
AI 删除 = 在当前 commit range 内先由 AI 添加，然后被删除
```

示例：
- Day 1: AI 删除了两行注释
- 查询 commit range 时，这两行显示 `isAI: false, ai_deleted: 0`
- 原因：这两行不是在当前 range 内由 AI 添加的

### 新行为

```javascript
// 新逻辑
AI 删除 = AI 曾经执行过删除操作（不管代码来源）
```

示例：
- Day 1: AI 删除了两行注释
- 查询 commit range 时，这两行显示 `isAI: true, ai_deleted: 2`
- 原因：这两行在历史上被 AI 删除过

## 实现方案

### 1. 新增函数 `buildAiDeletesSet`

提取 AI 删除过的代码行：

```javascript
function buildAiDeletesMap(rows, zlib, parseDiff) {
    const aiDeletesMap = new Map();
    
    rows.forEach(row => {
        files.forEach(file => {
            chunk.changes.forEach(change => {
                if (change.type === 'del') {  // 关键：提取删除的行
                    const hash = hashLine(content);
                    if (!aiDeletesMap.has(hash)) {
                        aiDeletesMap.set(hash, {
                            timestamp: row.created_at,
                            generation_id: row.generation_id
                        });
                    }
                }
            });
        });
    });
    
    return aiDeletesMap;
}

function buildAiDeletesSet(rows, zlib, parseDiff) {
    const aiDeletesMap = buildAiDeletesMap(rows, zlib, parseDiff);
    return new Set(aiDeletesMap.keys());
}
```

### 2. 修改 `analyzeCommitRangeDiff` 函数

添加可选参数 `allAiDeletes`：

```javascript
function analyzeCommitRangeDiff(diffFile, allAiLines, allAiDeletes = null) {
    // ... 第一遍扫描保持不变 ...
    
    // 第二遍扫描：判断删除行
    if (change.type === 'del') {
        stats.deleted++;
        
        let isAI;
        if (allAiDeletes !== null) {
            // 新逻辑：只要 AI 删除过就算
            isAI = allAiDeletes.has(hash);
        } else {
            // 旧逻辑：只有在 range 内被 AI 添加的才算
            isAI = aiLinesInRange.has(hash);
        }
        
        if (isAI) stats.ai_deleted++;
    }
}
```

### 3. 更新 API 调用

在所有使用 `analyzeCommitRangeDiff` 的地方，添加 `allAiDeletes` 参数：

```javascript
// 构建 AI 知识库
const allAiLines = buildAiLinesSet(rows, zlib, parseDiff);
const allAiDeletes = buildAiDeletesSet(rows, zlib, parseDiff);

// 分析时传入两个参数
const { changes, stats } = analyzeCommitRangeDiff(
    targetFile, 
    allAiLines, 
    allAiDeletes  // 新增参数
);
```

## 测试用例

### 测试 1: AI 删除识别

```javascript
it('应该支持 AI 删除识别（新逻辑：只要 AI 删除过就算）', () => {
    // AI 在历史上删除了某些行
    const aiDiff = `diff --git a/test.js b/test.js
@@ -1,3 +1,1 @@
 function test() {
-    console.log('debug');
-    return null;
 }`;
    
    const allAiDeletes = buildAiDeletesSet([{ compressed_diff }], zlib, parseDiff);
    
    // 当前 diff 也删除了相同的行
    const result = analyzeCommitRangeDiff(currentFile, allAiLines, allAiDeletes);

    // 验证：即使不是在 range 内添加的，也算 AI 删除
    expect(result.stats.ai_deleted).toBe(2);
});
```

### 测试 2: 向后兼容

```javascript
it('应该保持旧逻辑的向后兼容性（不传 allAiDeletes）', () => {
    // 不传 allAiDeletes，使用旧逻辑
    const result = analyzeCommitRangeDiff(diffFile, allAiLines);

    // 旧逻辑：不在 range 内添加的，不算 AI 删除
    expect(result.stats.ai_deleted).toBe(0);
});
```

## 实际效果

### 测试数据

数据库中有一条记录，AI 删除了两行注释：

```diff
diff --git a/utis.js b/utis.js
-    // 使用 Promise 配合 setTimeout 是为了利用 JavaScript 的事件循环机制，
-    // 在不阻塞主线程的情况下实现延迟，从而避免阻塞 UI 渲染或后台任务。
```

### API 调用结果

```bash
curl "http://localhost:3001/api/github/commit-range-file-diff
  ?repo_url=https://github.com/ParadeTo/ai-stat-demo.git
  &file_path=utis.js
  &from_commit=fc5a5401
  &to_commit=feature-1"
```

**优化前**：
```json
{
  "stats": {
    "deleted": 2,
    "ai_deleted": 0  // ❌ 不正确
  },
  "changes": [
    {
      "type": "del",
      "content": "// 使用 Promise...",
      "isAI": false  // ❌ 不正确
    }
  ]
}
```

**优化后**：
```json
{
  "stats": {
    "deleted": 2,
    "ai_deleted": 2  // ✅ 正确
  },
  "changes": [
    {
      "type": "del",
      "content": "// 使用 Promise...",
      "isAI": true  // ✅ 正确
    }
  ]
}
```

## 优化的优点

### 1. 符合直觉

用户期望：AI 删除的代码就应该算 AI 删除，不管代码原本是谁写的。

### 2. 更全面的统计

现在可以追踪：
- AI 添加了多少代码
- AI 删除了多少代码
- AI 对代码库的完整影响

### 3. 向后兼容

通过可选参数 `allAiDeletes`：
- 传入参数：使用新逻辑
- 不传参数：使用旧逻辑
- 现有测试全部通过

## 注意事项

### 1. 数据库依赖

新逻辑依赖数据库中有 AI 删除的记录：
- 如果数据库中没有某行的删除记录，就不会被识别为 AI 删除
- 需要确保插件正确捕获了 AI 的删除操作

### 2. 语义变化

**旧定义**：
```
AI 删除 = 在当前 range 内，先由 AI 添加，然后被删除
```

**新定义**：
```
AI 删除 = AI 曾经执行过删除操作
```

这是一个语义的改变，更符合"AI 操作追踪"的目标。

### 3. 时序无关

新逻辑不考虑时序：
- 即使删除操作不在当前 commit range 内
- 只要历史上 AI 删除过，当前 range 中的相同删除也会被标记为 AI
- 这与"添加"的逻辑类似（相同内容就算 AI）

## 使用场景

### 场景 1: 代码清理

```javascript
// AI 帮忙删除了冗余代码
-    console.log('debug');  // AI 删除
-    const unused = 1;      // AI 删除

// 结果: ai_deleted = 2
```

### 场景 2: 重构

```javascript
// AI 重构时删除了旧的实现
-    // 旧的实现方式
-    return oldMethod();    // AI 删除

// 结果: ai_deleted = 1
```

### 场景 3: 统计 AI 贡献

```
总结:
- AI 添加: 100 行
- AI 删除: 50 行
- 净贡献: +50 行
```

## 相关文件

- `server/lib/codeAttribution.js` - 核心算法
- `server/index.js` - API 实现
- `server/__tests__/codeAttribution.test.js` - 测试用例
- `doc/WHY-AI-DELETED-IS-ZERO.md` - 问题分析文档

## 总结

这个优化：
- ✅ 符合用户的直觉和期望
- ✅ 提供更全面的 AI 操作统计
- ✅ 保持向后兼容
- ✅ 测试覆盖完整（32 个测试全部通过）
- ✅ 实际验证成功（`ai_deleted` 从 0 变为 2）

现在系统可以正确识别 AI 的删除操作，让用户更清楚地了解 AI 对代码库的完整影响。

