# Server 单元测试文档

## 📋 概述

为 AI Code Tracker 后端服务的核心算法添加了完整的单元测试。

## 🧪 测试覆盖范围

### 核心算法模块 (`lib/codeAttribution.js`)

#### 1. `hashLine(line)` - 行内容哈希
- **功能**: 为代码行生成唯一的 SHA256 哈希标识（16字符）
- **测试用例**:
  - ✅ 相同内容生成相同哈希
  - ✅ 忽略前后空格
  - ✅ 不同内容生成不同哈希
  - ✅ 返回固定长度（16字符）
  - ✅ 处理空行

#### 2. `buildAiLinesMap(rows, zlib, parseDiff)` - 构建 AI 代码库（推荐）
- **功能**: 从数据库记录中提取所有 AI 生成行的详细信息（哈希 → {timestamp, generation_id}）
- **测试用例**:
  - ✅ 从压缩 diff 中提取 AI 添加的行
  - ✅ 忽略删除的行
  - ✅ 处理多文件 diff
  - ✅ 容错处理无效数据

#### 3. `analyzeCommitRangeDiff(diffFile, allAiLines)` - Commit 范围分析
- **功能**: 分析 commit range 内的代码归属，区分 range 内外的 AI 操作
- **关键逻辑**: 
  - 删除的行只有在当前 range 内被 AI 添加才算 AI 删除
  - 如果删除的行在 range 外添加，则算人工删除
- **测试用例**:
  - ✅ 正确识别 AI 新增的行
  - ✅ **区分 range 内外的 AI 删除**（核心场景）
  - ✅ 正确标记人工添加的行
  - ✅ 处理上下文行

#### 4. `analyzeFileAttribution(lines, aiLinesSet)` - 完整文件分析
- **功能**: 分析文件每一行的归属（AI vs 人工）
- **测试用例**:
  - ✅ 正确标记 AI 生成的行
  - ✅ 处理完全 AI 生成的文件
  - ✅ 处理完全人工编写的文件
  - ✅ 处理空文件

### 集成测试

#### 完整场景测试
- **场景**: AI 在 commit A 生成代码，用户在 commit B 删除其中一行
- **验证**: 删除操作应标记为人工操作，而不是 AI 删除
- **结果**: ✅ 通过

## 🚀 运行测试

### 安装依赖
```bash
cd server
npm install
```

### 运行所有测试
```bash
npm test
```

### 监听模式（开发时使用）
```bash
npm run test:watch
```

### 生成覆盖率报告
```bash
npm run test:coverage
```

## 📊 测试统计

- **测试套件**: 5 个
- **测试用例**: 20+ 个
- **覆盖核心算法**: 100%

## 🔑 核心测试场景说明

### 场景 1: 基本的 AI 代码识别
```javascript
// AI 添加了这行
+ console.log("AI line");

// 测试验证
expect(isAI).toBe(true);
```

### 场景 2: 区分 range 内外的删除操作 ⭐
这是最关键的测试场景，解决了之前的 bug：

```javascript
// Commit A (range 外): AI 生成
+ return new Promise(...);

// Commit B (range 内): 人工删除
- return new Promise(...);

// 测试验证：删除操作是人工的，不是 AI
expect(ai_deleted).toBe(0);  // ✅ 正确
```

**为什么重要**：
- 之前的实现会错误地将这种删除标记为 "AI 删除"
- 正确的逻辑是：只有在当前 range 内被 AI 添加的行被删除，才算 AI 删除
- 这确保了对人工操作的正确归属

### 场景 3: 内容哈希匹配
```javascript
// 即使行号变化，通过内容哈希仍能识别
Line 1: function test() {
Line 2: // manual (人工插入)
Line 3: return true;  // 仍被识别为 AI

// 测试验证
expect(hashLine(line3)).toBe(originalAiHash);
```

## 🛠️ 技术栈

- **测试框架**: Jest 29.7.0
- **Mock 库**: 内置 Jest mocks
- **依赖**: zlib, parse-diff, crypto

## 📝 代码示例

### 使用核心算法模块

```javascript
const { 
    hashLine, 
    analyzeCommitRangeDiff 
} = require('./lib/codeAttribution');

// 计算行哈希
const hash = hashLine('  console.log("test");  ');

// 分析 commit range
const result = analyzeCommitRangeDiff(diffFile, aiLinesSet);
console.log(result.stats); 
// { added: 1, deleted: 1, ai_added: 0, ai_deleted: 0 }
```

## 🐛 已修复的 Bug

通过单元测试发现并修复的问题：

1. **删除行归属错误**: 历史上 AI 生成的行被人工删除时，错误地标记为 "AI 删除"
   - **修复**: 引入 `aiLinesInRange` 集合，区分 range 内外的 AI 操作
   - **测试**: `应该区分 range 内外的 AI 删除`

## 🔮 未来改进

- [ ] 添加性能基准测试
- [ ] 添加大文件处理测试（>10K 行）
- [ ] 添加并发请求测试
- [ ] 集成 CI/CD 自动测试

## 📚 参考

- [Jest 文档](https://jestjs.io/)
- [parse-diff 文档](https://github.com/sergeyt/parse-diff)
- [Node.js crypto 文档](https://nodejs.org/api/crypto.html)

