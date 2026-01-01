# AI Code Tracker Extension 调试指南

## 快速开始

### 1. 编译插件
```bash
cd extension
pnpm install  # 如果还没安装依赖
pnpm run compile
```

### 2. 启动调试模式

在 Cursor 中：
1. 打开 `extension` 文件夹作为工作区
2. 按 `F5` 或点击 **Run and Debug** > **Run Extension**
3. 新的 Cursor 窗口（Extension Development Host）会启动

### 3. 验证插件安装

在新窗口中：
1. 按 `Cmd+Shift+P`（Mac）或 `Ctrl+Shift+P`（Windows）
2. 输入 `AI Code Tracker: Show Dashboard`
3. 如果看到信息提示 "Hooks initialized successfully"，说明钩子注入成功

### 4. 检查钩子是否注入成功

```bash
cat ~/.cursor/hooks.json
```

应该看到类似的内容：
```json
{
  "hooks": {
    "beforeSubmitPrompt": [
      {
        "command": "node \"/path/to/extension/scripts/beforeSubmitPrompt.js\""
      }
    ],
    "stop": [
      {
        "command": "node \"/path/to/extension/scripts/stop.js\""
      }
    ]
  }
}
```

## 调试钩子脚本

### 查看实时日志

钩子执行的所有日志会写入到：
```bash
tail -f ~/.ai-code-stats/debug.log
```

### 查看钩子接收的原始输入

Cursor 传给钩子的原始数据会保存到：
```bash
cat ~/.ai-code-stats/hooks_input.json
```

### 手动测试 stop.js

创建一个测试 diff 文件：
```bash
cd /path/to/your/test/repo
echo '--- a/test.txt
+++ b/test.txt
@@ -0,0 +1,3 @@
+line 1
+line 2
+line 3' | node /path/to/extension/scripts/stop.js
```

然后检查日志：
```bash
cat ~/.ai-code-stats/debug.log
```

## 常见问题

### 1. 钩子未触发

**现象**：使用 AI 生成代码后，日志文件没有更新。

**排查步骤**：
1. 检查 `~/.cursor/hooks.json` 是否存在且格式正确
2. 确认脚本路径是否正确（绝对路径）
3. 检查脚本是否有执行权限：`chmod +x extension/scripts/*.js`
4. 查看 Cursor 的开发者工具（Help > Toggle Developer Tools）中的 Console 是否有错误

### 2. 后端无法接收数据

**现象**：日志显示 "Report request sent"，但服务端没收到。

**排查步骤**：
1. 确认后端服务正在运行：`curl http://localhost:3001/`
2. 检查防火墙是否阻止了本地连接
3. 在 `stop.js` 中临时添加更详细的日志

### 3. Git 命令失败

**现象**：日志中出现 "Git diff error"。

**排查步骤**：
1. 确认当前目录是 Git 仓库：`git status`
2. 检查是否有未提交的更改
3. 手动运行 `git diff` 看是否有输出

## 调试技巧

### 在钩子脚本中添加断点

由于钩子脚本是独立进程，无法直接附加调试器。但可以：

1. **使用详细日志**：在关键位置添加 `log()` 调用
2. **输出到文件**：将中间数据写入临时文件查看
3. **使用 Node 调试器**：
   ```bash
   node --inspect-brk extension/scripts/stop.js
   ```

### 模拟 Cursor 钩子调用

创建测试脚本 `test-hook.sh`：
```bash
#!/bin/bash
echo '{
  "generation_id": "test-gen-123",
  "conversation_id": "test-conv-456",
  "model": "gpt-4",
  "status": "completed"
}' | node extension/scripts/stop.js
```

运行：
```bash
chmod +x test-hook.sh
./test-hook.sh
```

## 配置文件位置

| 文件 | 路径 | 用途 |
|------|------|------|
| 钩子配置 | `~/.cursor/hooks.json` | Cursor 读取的钩子脚本路径 |
| 调试日志 | `~/.ai-code-stats/debug.log` | 所有钩子执行的详细日志 |
| 原始输入 | `~/.ai-code-stats/hooks_input.json` | Cursor 传递给钩子的原始 JSON |
| 会话缓存 | `~/.ai-code-stats/session.json` | generation_id 和 prompt 的临时存储 |

## 下一步

调试成功后，可以：
1. 使用 Cursor 生成一段代码并 Accept
2. 查看 `~/.ai-code-stats/debug.log` 确认钩子执行
3. 访问 Dashboard (`http://localhost:5173`) 查看统计数据

