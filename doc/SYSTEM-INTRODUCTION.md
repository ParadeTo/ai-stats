# AI 代码追踪系统技术介绍

## 引言

在 AI 辅助编程日益普及的今天，开发团队面临着一个新的挑战：如何准确识别项目中哪些代码来自 AI 生成，哪些代码来自人工编写。这个问题看似简单，实则关系到代码审查、质量评估、团队协作效率评估等多个方面。

AI 代码追踪系统正是为了解决这一问题而设计的。该系统通过在代码生成的瞬间进行实时捕获和标记，为每一行代码打上明确的"身份标签"，使得代码归属识别变得准确、可靠、可追溯。与传统的基于 Git 提交记录的分析方法不同，本系统采用"源头捕获"的策略，不依赖推测，而是直接记录代码产生的真实过程。

系统的核心价值体现在三个方面：实时捕获、准确识别和可视化展示。实时捕获确保了数据的及时性和完整性；准确识别通过内容哈希匹配算法，即使代码位置发生变化也能正确识别；可视化展示则为用户提供了直观的统计和分析界面。

## 系统架构概览

AI 代码追踪系统采用三层架构设计，分别是插件层、后端层和前端层。每一层承担不同的职责，共同构成了完整的追踪链路。

<details>
<summary>点击展开查看系统架构图</summary>

<div style="width: 100%; overflow-x: auto; padding: 20px; background: #f8f9fa; border-radius: 8px; margin: 20px 0;">

<style>
.arch-diagram {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 1200px;
    margin: 0 auto;
}

.arch-layer {
    margin: 30px 0;
    padding: 20px;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.layer-plugin {
    background: linear-gradient(135deg, #e1f5ff 0%, #b3e5fc 100%);
    border-left: 5px solid #0288d1;
}

.layer-backend {
    background: linear-gradient(135deg, #fff4e1 0%, #ffe0b2 100%);
    border-left: 5px solid #f57c00;
}

.layer-frontend {
    background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%);
    border-left: 5px solid #388e3c;
}

.layer-title {
    font-size: 20px;
    font-weight: bold;
    margin-bottom: 15px;
    color: #333;
    display: flex;
    align-items: center;
}

.layer-title::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 10px;
    background: currentColor;
}

.layer-plugin .layer-title::before { background: #0288d1; }
.layer-backend .layer-title::before { background: #f57c00; }
.layer-frontend .layer-title::before { background: #388e3c; }

.components {
    display: flex;
    flex-wrap: wrap;
    gap: 15px;
    justify-content: center;
}

.component {
    background: white;
    padding: 15px 20px;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    min-width: 150px;
    text-align: center;
    font-size: 14px;
    color: #555;
    transition: transform 0.2s, box-shadow 0.2s;
}

.component:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0,0,0,0.15);
}

.component-name {
    font-weight: 600;
    color: #333;
    margin-bottom: 5px;
}

.arrow {
    text-align: center;
    margin: 10px 0;
    color: #666;
    font-size: 12px;
}

.arrow::after {
    content: '↓';
    display: block;
    font-size: 20px;
    color: #999;
    margin-top: 5px;
}

.arrow-right {
    display: inline-block;
    margin: 0 10px;
    color: #999;
}

.arrow-right::after {
    content: '→';
    font-size: 16px;
}

.data-flow {
    background: #f5f5f5;
    padding: 15px;
    border-radius: 8px;
    margin-top: 20px;
    border-left: 4px solid #2196f3;
}

.data-flow-title {
    font-weight: 600;
    color: #2196f3;
    margin-bottom: 10px;
}

.data-flow-item {
    padding: 8px 0;
    color: #666;
    font-size: 14px;
    border-bottom: 1px dashed #ddd;
}

.data-flow-item:last-child {
    border-bottom: none;
}

.data-flow-label {
    display: inline-block;
    min-width: 120px;
    font-weight: 500;
    color: #333;
}
</style>

<div class="arch-diagram">
    <!-- 插件层 -->
    <div class="arch-layer layer-plugin">
        <div class="layer-title">插件层 (Cursor Extension)</div>
        <div class="components">
            <div class="component">
                <div class="component-name">Cursor IDE</div>
                <div style="font-size: 12px; color: #888;">代码编辑器</div>
            </div>
            <div class="arrow-right"></div>
            <div class="component">
                <div class="component-name">stop.js 脚本</div>
                <div style="font-size: 12px; color: #888;">钩子处理器</div>
            </div>
            <div class="arrow-right"></div>
            <div class="component">
                <div class="component-name">Git Diff</div>
                <div style="font-size: 12px; color: #888;">差异捕获</div>
            </div>
            <div class="arrow-right"></div>
            <div class="component">
                <div class="component-name">压缩编码</div>
                <div style="font-size: 12px; color: #888;">Gzip + Base64</div>
            </div>
        </div>
        <div class="arrow">HTTP POST 请求</div>
    </div>

    <!-- 后端层 -->
    <div class="arch-layer layer-backend">
        <div class="layer-title">后端层 (Node.js + Express)</div>
        <div class="components">
            <div class="component">
                <div class="component-name">API 接收</div>
                <div style="font-size: 12px; color: #888;">POST /api/create-task</div>
            </div>
            <div class="arrow-right"></div>
            <div class="component">
                <div class="component-name">数据验证</div>
                <div style="font-size: 12px; color: #888;">格式检查</div>
            </div>
            <div class="arrow-right"></div>
            <div class="component">
                <div class="component-name">SQLite 数据库</div>
                <div style="font-size: 12px; color: #888;">持久化存储</div>
            </div>
        </div>
        <div style="margin-top: 20px;">
            <div class="components">
                <div class="component">
                    <div class="component-name">代码归属分析</div>
                    <div style="font-size: 12px; color: #888;">内容哈希匹配</div>
                </div>
                <div class="arrow-right"></div>
                <div class="component">
                    <div class="component-name">API 响应</div>
                    <div style="font-size: 12px; color: #888;">JSON 数据</div>
                </div>
            </div>
        </div>
        <div class="arrow">HTTP GET 响应</div>
    </div>

    <!-- 前端层 -->
    <div class="arch-layer layer-frontend">
        <div class="layer-title">前端层 (React + Vite)</div>
        <div class="components">
            <div class="component">
                <div class="component-name">项目列表页</div>
                <div style="font-size: 12px; color: #888;">统计概览</div>
            </div>
            <div class="arrow-right"></div>
            <div class="component">
                <div class="component-name">文件详情页</div>
                <div style="font-size: 12px; color: #888;">逐行分析</div>
            </div>
            <div class="arrow-right"></div>
            <div class="component">
                <div class="component-name">可视化展示</div>
                <div style="font-size: 12px; color: #888;">颜色标识</div>
            </div>
        </div>
    </div>

    <!-- 数据流向说明 -->
    <div class="data-flow">
        <div class="data-flow-title">数据流向说明</div>
        <div class="data-flow-item">
            <span class="data-flow-label">捕获阶段：</span>
            Cursor IDE → stop.js 脚本 → Git Diff → 压缩编码 → HTTP POST → 后端 API
        </div>
        <div class="data-flow-item">
            <span class="data-flow-label">存储阶段：</span>
            后端接收 → 数据验证 → 解压缩 → SQLite 数据库存储
        </div>
        <div class="data-flow-item">
            <span class="data-flow-label">分析阶段：</span>
            前端请求 → 后端查询 → 内容哈希匹配 → 代码归属分析 → JSON 响应
        </div>
        <div class="data-flow-item">
            <span class="data-flow-label">展示阶段：</span>
            前端接收数据 → 项目列表展示 → 文件详情展示 → 逐行归属可视化
        </div>
    </div>
</div>

</div>

</details>

插件层运行在 Cursor 编辑器内部，负责在 AI 代码生成完成时捕获代码差异。后端层负责数据的存储、管理和分析，提供 RESTful API 接口。前端层提供用户界面，展示统计数据和代码归属信息。

数据流向清晰明确：插件层捕获数据后发送到后端存储，前端通过 API 查询后端数据并展示。这种分层设计使得系统具有良好的可维护性和可扩展性。

## 插件层：实时捕获机制

插件层是整个系统的数据入口，它的核心任务是准确捕获 AI 生成的代码。这一层的工作机制基于 Cursor 编辑器的钩子系统。

### Cursor 钩子系统

Cursor 编辑器提供了生命周期钩子机制，允许开发者在特定事件发生时执行自定义脚本。系统通过修改 Cursor 的配置文件 `~/.cursor/hooks.json` 来注册钩子。核心钩子是 `stop`，它在每次 AI 代码生成完成且用户点击"应用"按钮时被触发。

当钩子被触发时，Cursor 会通过标准输入流向脚本传递一个 JSON 对象，包含丰富的元数据：对话 ID、生成 ID、使用的 AI 模型名称、工作区路径等。这些元数据为后续的数据分析提供了重要的上下文信息。

### stop.js 脚本的工作流程

stop.js 脚本是插件层的核心组件，它执行以下步骤来完成数据捕获：

首先，脚本从标准输入读取 Cursor 传入的元数据。这里有一个关键的技术细节：脚本需要从元数据中提取 `workspace_roots` 字段，这个字段包含了用户项目的本地路径。

接下来，脚本获取 Git 差异。这里需要处理两种情况：已跟踪文件的修改和未跟踪的新文件。对于已跟踪的文件，直接使用 `git diff` 命令即可。对于未跟踪的新文件，Git 默认不会包含在差异中。系统使用 `git add -N` 命令将新文件临时标记为"意图添加"状态，这样 `git diff` 就能捕获到新文件的内容，然后再用 `git reset` 撤销这个临时操作。

获取到差异后，脚本会进行压缩处理。使用 Gzip 算法压缩差异内容，通常能将数据量减少到原来的 10-20%。压缩后的数据再编码为 Base64 格式，便于通过 HTTP 传输。最后，脚本将压缩后的差异连同所有元数据一起，通过 HTTP POST 请求发送到后端服务器。

### 完整捕获示例

假设开发者小李在 Cursor 中请求 AI 生成一个快速排序函数。AI 生成了以下代码：

```javascript
function quickSort(arr) {
    if (arr.length <= 1) return arr;
    const pivot = arr[0];
    const left = arr.filter(x => x < pivot);
    const right = arr.filter(x => x > pivot);
    return [...quickSort(left), pivot, ...quickSort(right)];
}
```

当小李点击"应用"按钮时，stop.js 脚本被触发。脚本执行 `git diff` 命令，获取到如下差异：

```
diff --git a/utils.js b/utils.js
@@ -0,0 +1,7 @@
+function quickSort(arr) {
+    if (arr.length <= 1) return arr;
+    const pivot = arr[0];
+    const left = arr.filter(x => x < pivot);
+    const right = arr.filter(x => x > pivot);
+    return [...quickSort(left), pivot, ...quickSort(right)];
+}
```

脚本将这个差异压缩并编码，连同元数据（生成 ID、模型名称等）一起发送到后端。后端收到数据后，会将其存储到数据库中，为后续的分析提供数据基础。

## 后端层：存储与分析算法

后端层是整个系统的核心，它不仅要存储数据，更重要的是提供智能的分析能力。这一层的关键在于如何从存储的差异数据中准确识别出 AI 生成的代码。

### 数据库设计与存储策略

后端使用 SQLite 数据库存储 AI 代码生成记录。数据库表结构设计简洁明了：每条记录包含生成 ID、用户 ID、仓库地址、分支名称、使用的模型、压缩后的差异数据，以及创建时间等字段。生成 ID 作为唯一标识，确保每条记录的唯一性。

压缩后的差异数据以 Base64 编码的字符串形式存储在数据库中。虽然 SQLite 支持二进制数据存储，但使用 Base64 编码可以简化数据的序列化和反序列化过程。当需要分析时，系统会解压缩这些数据，还原为原始的 Git diff 格式。

#### 数据库存储示例

假设开发者使用 AI 生成了一个排序函数，系统会将以下数据存储到数据库中：

```sql
INSERT INTO task_records (
    generation_id,
    user_id,
    repo_url,
    branch_name,
    model,
    compressed_diff,
    created_at
) VALUES (
    'gen-1234567890',
    'developer001',
    'https://github.com/user/myproject.git',
    'feature-branch',
    'gpt-4',
    'H4sIAAAAAAAAA6tWSkksSVSyUqqOUcpLzE1VslJKy8xNtVKqTk4tKkktLlGyUlJQ...',  -- 压缩后的 Base64 字符串
    '2024-01-15 10:30:45'
);
```

这个压缩后的字符串实际上包含了完整的 Git diff 信息。当系统需要分析时，会执行以下步骤：

1. 从数据库读取 Base64 字符串
2. 解码为二进制数据
3. 使用 Gzip 解压缩，还原为原始 diff 文本
4. 使用 parse-diff 库解析 diff，提取出每一行代码

例如，压缩前的原始 diff 可能是这样的：

```
diff --git a/utils.js b/utils.js
@@ -0,0 +1,5 @@
+function quickSort(arr) {
+    if (arr.length <= 1) return arr;
+    const pivot = arr[0];
+    const left = arr.filter(x => x < pivot);
+    const right = arr.filter(x => x > pivot);
+    return [...quickSort(left), pivot, ...quickSort(right)];
+}
```

经过 Gzip 压缩和 Base64 编码后，这个 diff 被压缩到大约原来的 20% 大小，大大节省了存储空间。

### 核心算法：内容哈希匹配

系统识别 AI 代码的核心算法基于内容哈希匹配。这个算法的基本思想是：为每一行代码计算一个唯一的哈希值，通过比较哈希值来判断代码的来源。

哈希值的计算过程如下：首先去除代码行的首尾空格，然后使用 SHA256 算法计算哈希值，最后取前 16 个字符作为该行代码的"指纹"。这个指纹具有唯一性和稳定性：相同内容的代码行总是产生相同的哈希值，不同内容的代码行产生不同的哈希值。

当需要分析某个文件的代码归属时，系统首先从数据库中查询所有相关的 AI 生成记录。对每条记录，系统解压缩差异数据，解析出所有"新增"类型的代码行，并为每一行计算哈希值，将这些哈希值存储在一个集合中。这个集合构成了"AI 代码知识库"。

接下来，系统通过 Git 命令获取目标文件的当前完整内容，按行分割。对文件的每一行，系统也计算其哈希值，然后查询这个哈希值是否存在于 AI 代码知识库中。如果存在，说明这行代码是 AI 生成的；如果不存在，说明这行代码是人工编写的。

#### 内容哈希匹配的完整流程示例

让我们通过一个完整的例子来说明这个过程。假设数据库中存储了以下 AI 生成记录：

**记录 1**（生成时间：2024-01-15）：
```javascript
function quickSort(arr) {
    if (arr.length <= 1) return arr;
    const pivot = arr[0];
    const left = arr.filter(x => x < pivot);
    const right = arr.filter(x => x > pivot);
    return [...quickSort(left), pivot, ...quickSort(right)];
}
```

**记录 2**（生成时间：2024-01-16）：
```javascript
function binarySearch(arr, target) {
    let left = 0, right = arr.length - 1;
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (arr[mid] === target) return mid;
        if (arr[mid] < target) left = mid + 1;
        else right = mid - 1;
    }
    return -1;
}
```

系统会为这些代码行计算哈希值，构建 AI 代码知识库：

```javascript
AI代码知识库 = {
    "a3f5e9d2b1c8f4e1": "function quickSort(arr) {",
    "b7c2d4e8f1a9b3c5": "    if (arr.length <= 1) return arr;",
    "c9d1e3f5a7b9c1d3": "    const pivot = arr[0];",
    "d5e7f9a1b3c5d7e9": "    const left = arr.filter(x => x < pivot);",
    "e1f3a5b7c9d1e3f5": "    const right = arr.filter(x => x > pivot);",
    "f7a9b1c3d5e7f9a1": "    return [...quickSort(left), pivot, ...quickSort(right)];",
    "a1b3c5d7e9f1a3b5": "function binarySearch(arr, target) {",
    // ... 更多哈希值
}
```

现在，假设当前文件 `utils.js` 的内容是：

```javascript
function quickSort(arr) {
    if (arr.length <= 1) return arr;
    const pivot = arr[0];
    const left = arr.filter(x => x < pivot);
    const right = arr.filter(x => x > pivot);
    return [...quickSort(left), pivot, ...quickSort(right)];
}

// 手动添加的工具函数
function formatDate(date) {
    return date.toISOString().split('T')[0];
}
```

系统会逐行计算哈希值并匹配：

```javascript
第1行: hash("function quickSort(arr) {") = "a3f5e9d2b1c8f4e1" → 在知识库中 → AI生成
第2行: hash("    if (arr.length <= 1) return arr;") = "b7c2d4e8f1a9b3c5" → 在知识库中 → AI生成
第3行: hash("    const pivot = arr[0];") = "c9d1e3f5a7b9c1d3" → 在知识库中 → AI生成
第4行: hash("    const left = arr.filter(x => x < pivot);") = "d5e7f9a1b3c5d7e9" → 在知识库中 → AI生成
第5行: hash("    const right = arr.filter(x => x > pivot);") = "e1f3a5b7c9d1e3f5" → 在知识库中 → AI生成
第6行: hash("    return [...quickSort(left), pivot, ...quickSort(right)];") = "f7a9b1c3d5e7f9a1" → 在知识库中 → AI生成
第7行: hash("") = "..." → 不在知识库中 → 人工编写（空行）
第8行: hash("// 手动添加的工具函数") = "..." → 不在知识库中 → 人工编写
第9行: hash("function formatDate(date) {") = "..." → 不在知识库中 → 人工编写
第10行: hash("    return date.toISOString().split('T')[0];") = "..." → 不在知识库中 → 人工编写
第11行: hash("}") = "..." → 不在知识库中 → 人工编写
```

最终的分析结果：

```
文件: utils.js
总行数: 11
AI生成: 6行 (54.5%)
人工编写: 5行 (45.5%)
```

### 内容哈希匹配的优势

基于内容哈希的匹配方式有一个巨大的优势：它不依赖行号。当程序员在文件中间插入或删除代码时，后续代码的行号会发生变化，但代码内容本身没有变化，因此哈希值也不会变化。系统依然能准确识别出哪些代码来自 AI。

举个例子来说明这个优势。假设 AI 生成了这样一个函数：

```javascript
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
```

系统会为第二行代码计算出一个哈希值，比如 "a3f5e9d2b1c8f4e1"。这个哈希值被存储在数据库中。后来，程序员在第二行上方插入了一行注释：

```javascript
function sleep(ms) {
    // 等待指定的毫秒数
    return new Promise(resolve => setTimeout(resolve, ms));
}
```

现在 Promise 那行的行号从 2 变成了 3，但它的内容没变，所以哈希值还是 "a3f5e9d2b1c8f4e1"。系统通过匹配哈希值，能够准确识别出这行代码仍然是 AI 生成的。

### Commit 范围分析算法

系统还提供了 commit 范围分析功能，可以分析两个 commit 之间的代码变更，并计算 AI 代码的占比。这个功能的实现涉及一个重要的算法问题：如何区分 commit 范围内外的代码操作。

最初的实现版本存在一个逻辑错误：如果删除的代码在历史上是 AI 生成的，系统会错误地将其标记为"AI 删除"。但实际上，删除操作是程序员做的，应该算作人工操作。

修复后的版本采用了两遍扫描的策略。第一遍扫描：遍历 commit 范围内的所有变更，找出哪些新增的代码是 AI 生成的，将这些行的哈希值存储在一个临时集合中。第二遍扫描：再次遍历所有变更，对于删除的行，只有当它的哈希值存在于临时集合中时（即在当前范围内被 AI 添加），才算作"AI 删除"；否则，即使这行代码在历史上是 AI 生成的，删除操作也算作人工操作。

这个算法的正确性可以通过一个例子来说明。假设在 commit A 中，AI 生成了一行代码 `return new Promise(...)`。在 commit B 中，程序员删除了这行代码。如果我们分析 commit A 到 commit B 的范围，第一遍扫描会发现没有新增的 AI 代码（因为 commit A 在范围外），所以临时集合为空。第二遍扫描时，删除的那行代码的哈希值不在临时集合中，因此被标记为人工删除，而不是 AI 删除。这正是我们期望的结果。

#### Commit 范围分析的详细示例

让我们通过一个更复杂的场景来理解这个算法。假设我们有一个文件 `utils.js` 的提交历史：

**Commit A（2024-01-10）**：初始版本，包含人工编写的代码
```javascript
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
```

**Commit B（2024-01-15）**：AI 添加了新的工具函数
```javascript
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
```

**Commit C（2024-01-20）**：程序员删除了 Promise 那行，添加了注释
```javascript
function sleep(ms) {
    // 使用 setTimeout 实现
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
```

现在，如果我们分析 **Commit B 到 Commit C** 的范围：

**第一遍扫描**（识别范围内 AI 添加的代码）：
- 新增的行：`// 使用 setTimeout 实现`（人工添加）
- 删除的行：`return new Promise(resolve => setTimeout(resolve, ms));`（在 Commit A 中已存在，不在范围内添加）
- 结论：范围内没有新增的 AI 代码，临时集合 `aiLinesInRange` 为空

**第二遍扫描**（判断删除操作的归属）：
- 删除的行：`return new Promise(...)` 的哈希值不在 `aiLinesInRange` 中
- 结论：删除操作标记为人工操作（`isAI: false`）

**最终统计结果**：
```
范围: Commit B → Commit C
新增: 1行（人工）
删除: 1行（人工）
AI新增: 0行
AI删除: 0行
```

这个结果正确地反映了：虽然被删除的代码在历史上是 AI 生成的，但删除操作本身是在当前范围内由人工完成的。

#### API 接口使用示例

后端提供了多个 RESTful API 接口，下面展示几个核心接口的使用示例：

**1. 创建任务记录（插件调用）**

```http
POST /api/create-task
Content-Type: application/json

{
    "generation_id": "gen-1234567890",
    "user_id": "developer001",
    "repo_url": "https://github.com/user/myproject.git",
    "branch_name": "feature-branch",
    "model": "gpt-4",
    "compressed_diff": "H4sIAAAAAAAAA6tWSkksSVSyUqqOUcpLzE1VslJKy8xNtVKqTk4tKkktLlGyUlJQ...",
    "task_type": "adhoc"
}
```

**响应**：
```json
{
    "success": true,
    "id": 42,
    "message": "Task recorded successfully"
}
```

**2. 获取项目统计信息**

```http
GET /api/stats
```

**响应**：
```json
{
    "summary": {
        "ai_added_lines": 1250,
        "ai_deleted_lines": 50,
        "total_records": 25
    },
    "records": [
        {
            "id": 42,
            "generation_id": "gen-1234567890",
            "repo_url": "https://github.com/user/myproject.git",
            "branch_name": "feature-branch",
            "model": "gpt-4",
            "created_at": "2024-01-15 10:30:45"
        }
    ]
}
```

**3. 分析文件归属**

```http
GET /api/analyze-file?repo_path=/Users/user/myproject&file_path=utils.js
```

**响应**：
```json
{
    "file_path": "utils.js",
    "stats": {
        "total_lines": 25,
        "ai_lines": 15,
        "modified_lines": 2,
        "human_lines": 10
    },
    "analysis": [
        {
            "lineNumber": 1,
            "content": "function quickSort(arr) {",
            "attribution": "ai",
            "generation_id": "gen-1234567890"
        },
        {
            "lineNumber": 2,
            "content": "    if (arr.length <= 1) return arr;",
            "attribution": "ai",
            "generation_id": "gen-1234567890"
        },
        {
            "lineNumber": 3,
            "content": "    // 手动优化",
            "attribution": "human",
            "generation_id": null
        }
    ]
}
```

**4. Commit 范围分析**

```http
GET /api/commit-range-stats?repo_path=/Users/user/myproject&from_commit=abc123&to_commit=def456
```

**响应**：
```json
{
    "from_commit": "abc123",
    "to_commit": "def456",
    "files": [
        {
            "file_path": "utils.js",
            "ai_lines": 10,
            "added_lines": 15,
            "deleted_lines": 5,
            "ai_ratio": 66.67
        }
    ],
    "summary": {
        "ai_lines": 10,
        "total_added": 15,
        "total_deleted": 5,
        "ai_ratio": 66.67
    }
}
```

## 前端层：可视化展示

前端层为用户提供了直观的可视化界面，使得代码归属信息一目了然。前端使用 React 框架构建，采用组件化设计，提供了两个主要页面：项目列表页和文件详情页。

### 项目列表页

项目列表页展示了所有被追踪的项目，每个项目显示仓库名称、分支、作者、AI 代码占比、代码行数统计，以及最后更新时间等信息。这个页面还支持一个特殊的功能：分支差异统计。

分支差异统计功能允许用户输入本地仓库的路径，系统会计算当前分支相对于主分支（master 或 main）的差异，然后统计这些差异中有多少是 AI 生成的。这对于代码审查很有用。例如，团队负责人在合并代码前，可以快速了解这个功能分支里有多少 AI 代码，从而决定审查的重点。

### 文件详情页

文件详情页提供了更细粒度的代码归属信息。页面的左侧列出了所有变更的文件，每个文件旁边显示了新增、删除的行数，以及 AI 代码的数量。右侧则是代码的详细展示，这里用不同的颜色来标识代码的来源：绿色背景表示 AI 原始生成的代码，白色背景表示人工编写的代码。

文件详情页还支持 commit 范围分析功能。用户可以选择两个 commit 点，系统会分析这两个 commit 之间的所有代码变更，并计算 AI 代码的占比。这个功能在查看某个时间段的开发效率时特别有用。例如，项目经理想了解最近一周的开发中 AI 生成了多少代码，可以选择一周前的 commit 和当前的 HEAD，系统会展示这个时间段内的所有变更及其 AI 占比。

### 用户操作流程示例

假设开发者小王想查看自己最近一周的工作中 AI 代码的占比。他首先打开项目列表页，看到自己的项目 "my-project" 显示 AI 占比为 45%。点击进入项目详情页后，他勾选"使用 commit 范围分析"选项，输入本地仓库路径 `/Users/wang/projects/my-project`。系统自动加载最近的 commit 列表，小王选择一周前的 commit 作为起始点，当前 HEAD 作为结束点，然后点击"分析范围"按钮。

系统分析完成后，左侧文件列表显示：共有 5 个文件被修改，新增了 200 行代码，其中 90 行是 AI 生成的。小王点击其中一个文件 `utils.js`，右侧显示该文件的详细 diff，每一行都用颜色标识了来源。小王可以看到，大部分 AI 生成的代码集中在工具函数部分，而业务逻辑部分主要是人工编写的。这个分析结果帮助小王更好地了解自己的工作模式和 AI 的使用情况。

## 核心技术难点与解决方案

在系统实现过程中，开发团队遇到了几个关键的技术难题。这些难题的解决方案体现了系统设计的精妙之处。

### 问题一：工作目录识别

插件脚本在运行时，它的当前工作目录是 Cursor 编辑器的安装目录，而不是用户项目的目录。如果直接用这个目录去执行 Git 命令，肯定会出错。

解决方案是从 Cursor 传入的元数据中提取 `workspace_roots` 字段。这个字段是一个数组，包含了用户打开的所有工作区的根目录。脚本使用第一个工作区路径作为 Git 命令的工作目录，就能正确获取项目的差异信息。

代码实现如下：

```javascript
const cursorData = await readStdin();
const metadata = JSON.parse(cursorData);
let workspaceRoot = process.cwd(); // 默认值

if (metadata.workspace_roots && metadata.workspace_roots.length > 0) {
    workspaceRoot = metadata.workspace_roots[0];
}

// 使用正确的工作目录执行 Git 命令
const diff = execSync('git diff', { cwd: workspaceRoot });
```

### 问题二：新文件捕获

Git 默认不会将未跟踪的新文件包含在差异中。如果开发者创建了一个全新的文件并让 AI 生成内容，系统无法捕获这些代码。

解决方案是使用 `git add -N` 命令。这个命令将文件标记为"意图添加"状态，但不会真正将文件内容添加到暂存区。这样 `git diff` 就能捕获到新文件的内容。获取差异后，再用 `git reset` 命令撤销这个临时操作，保持工作区的干净。

代码实现如下：

```javascript
// 获取未跟踪的文件
const statusOutput = execSync('git status --porcelain', { cwd });
const untrackedFiles = statusOutput
    .split('\n')
    .filter(line => line.startsWith('??'))
    .map(line => line.substring(3).trim());

// 临时标记为意图添加
untrackedFiles.forEach(file => {
    execSync(`git add -N "${file}"`, { cwd });
});

// 获取差异（现在包含新文件）
const diff = execSync('git diff', { cwd });

// 撤销临时操作
execSync('git reset', { cwd });
```

### 问题三：Commit 范围内外区分

在分析 commit 范围时，如何正确区分删除操作是 AI 做的还是人工做的，这是一个复杂的逻辑问题。

解决方案是两遍扫描算法。第一遍扫描找出在当前范围内被 AI 新增的代码，第二遍扫描时，只有删除这些代码的操作才算"AI 删除"。这个算法确保了只有真正在当前范围内发生的 AI 操作才会被统计。

算法实现的核心代码如下：

```javascript
function analyzeCommitRangeDiff(diffFile, allAiLines) {
    const aiLinesInRange = new Set(); // 当前范围内 AI 添加的行
    
    // 第一遍：识别当前范围内 AI 添加的行
    diffFile.chunks.forEach(chunk => {
        chunk.changes.forEach(change => {
            if (change.type === 'add') {
                const hash = hashLine(change.content);
                if (allAiLines.has(hash)) {
                    aiLinesInRange.add(hash);
                }
            }
        });
    });
    
    // 第二遍：判断删除操作
    diffFile.chunks.forEach(chunk => {
        chunk.changes.forEach(change => {
            if (change.type === 'del') {
                const hash = hashLine(change.content);
                // 只有删除当前范围内 AI 添加的代码才算 AI 删除
                const isAI = aiLinesInRange.has(hash);
            }
        });
    });
}
```

### 问题四：大文件处理

当代码仓库很大，或者某次 AI 生成的代码量很大时，传输和存储都会成为问题。差异数据可能达到几 MB 甚至几十 MB。

解决方案包括两个方面：数据压缩和目录过滤。系统使用 Gzip 算法压缩差异数据，通常能将数据量减少到原来的 10-20%。同时，在获取 Git 差异时，系统会过滤掉 `node_modules`、`.git`、`dist`、`build` 等不需要追踪的目录，避免产生巨大的差异数据。

代码实现如下：

```javascript
// 获取差异时排除大目录
const diff = execSync(
    'git diff -- . ":(exclude)node_modules" ":(exclude)dist" ":(exclude)build"',
    { cwd, maxBuffer: 50 * 1024 * 1024 } // 50MB 缓冲区
);

// 压缩差异数据
const compressed = zlib.gzipSync(Buffer.from(diff));
const base64 = compressed.toString('base64');
```

## 总结

AI 代码追踪系统通过实时捕获、准确识别和可视化展示三个核心能力，为开发团队提供了一个完整的代码归属追踪解决方案。系统采用三层架构设计，插件层负责数据捕获，后端层负责存储和分析，前端层负责可视化展示。每一层都经过精心设计，解决了实际应用中的各种技术难题。

系统的价值体现在多个实际应用场景中。对于个人开发者，它是一个自我认知的工具，帮助开发者了解自己的工作模式和 AI 的使用情况。对于团队管理者，它是一个有力的管理工具，在代码审查时能快速识别需要重点关注的部分，在评估团队效率时能提供客观的数据支持。对于开源项目维护者，它提供了一种新的透明度，帮助维护者更好地理解代码的来源。

当然，系统也有一些局限性。首先，它完全依赖 Cursor 编辑器的钩子机制，如果开发者使用其他编辑器，系统就无法工作。其次，它只能追踪"应用"了的 AI 代码，如果开发者生成了代码但没有应用，这些代码就不会被追踪。再次，对于代码的修改，系统目前的处理还比较粗糙，无法准确追踪修改的程度和细节。

展望未来，系统有很多可以扩展的方向。可以增加更多的统计维度，比如按模型类型统计、按时间段统计、按文件类型统计等。也可以增加更智能的分析功能，比如自动识别 AI 生成的代码中可能存在的问题模式，或者分析哪些类型的任务最适合交给 AI。还可以支持团队协作场景，设计数据同步和权限管理机制，让团队成员能够共享和对比代码归属数据。

在这个人机协作的新时代，我们需要的不是排斥 AI，也不是盲目依赖 AI，而是建立一套完善的机制，让每一次人机协作都有迹可循，让每一行代码都能找到它的出处。AI 代码追踪系统，正是朝这个方向迈出的重要一步。

