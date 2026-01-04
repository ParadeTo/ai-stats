#!/bin/bash

# 停止可能正在运行的服务器
echo "Stopping any existing server on port 3001..."
lsof -ti:3001 | xargs kill -9 2>/dev/null || echo "No existing server found"

# 等待端口释放
sleep 1

# 启动服务器
echo "Starting AI Code Tracker Server..."
echo "Server will run in the foreground. Press Ctrl+C to stop."
echo ""

cd "$(dirname "$0")"
node index.js


