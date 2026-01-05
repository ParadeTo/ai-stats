#!/bin/bash

# 测试手动标记功能的完整流程

BASE_URL="http://localhost:3001"
REPO_URL="https://github.com/ParadeTo/ai-stat-demo.git"
FILE_PATH="test.js"
BRANCH="feature-1"

echo "========================================="
echo "手动标记功能完整流程测试"
echo "========================================="
echo ""

# 步骤 1: 获取文件分析（初始状态）
echo "步骤 1: 获取文件分析（初始状态）"
echo "-----------------------------------"
curl -s "${BASE_URL}/api/github/analyze-file?repo_url=${REPO_URL}&file_path=${FILE_PATH}&branch=${BRANCH}" \
  | jq '{
      warning: .warning,
      hasManualAttributions: .hasManualAttributions,
      line6: .analysis[5]
    }'
echo ""
echo ""

# 步骤 2: 保存手动标记（将第 6 行从 AI 改为 human）
echo "步骤 2: 保存手动标记（将第 6 行从 AI 改为 human）"
echo "-----------------------------------"
curl -s -X POST "${BASE_URL}/api/manual-attribution" \
  -H "Content-Type: application/json" \
  -d "{
    \"repo_url\": \"${REPO_URL}\",
    \"file_path\": \"${FILE_PATH}\",
    \"branch\": \"${BRANCH}\",
    \"manual_attributions\": [
      {
        \"lineNumber\": 6,
        \"content\": \"    console.log('hello');\",
        \"attribution\": \"human\"
      }
    ]
  }" | jq '.'
echo ""
echo ""

# 步骤 3: 获取手动标记列表
echo "步骤 3: 获取手动标记列表"
echo "-----------------------------------"
curl -s "${BASE_URL}/api/manual-attribution?repo_url=${REPO_URL}&file_path=${FILE_PATH}&branch=${BRANCH}" \
  | jq '.'
echo ""
echo ""

# 步骤 4: 再次获取文件分析（查看手动标记是否生效）
echo "步骤 4: 再次获取文件分析（查看手动标记是否生效）"
echo "-----------------------------------"
curl -s "${BASE_URL}/api/github/analyze-file?repo_url=${REPO_URL}&file_path=${FILE_PATH}&branch=${BRANCH}" \
  | jq '{
      hasManualAttributions: .hasManualAttributions,
      manualAttributionCount: .manualAttributionCount,
      line6: .analysis[5],
      stats: .stats
    }'
echo ""
echo ""

# 步骤 5: 删除手动标记
echo "步骤 5: 删除手动标记"
echo "-----------------------------------"
curl -s -X DELETE "${BASE_URL}/api/manual-attribution?repo_url=${REPO_URL}&file_path=${FILE_PATH}&branch=${BRANCH}&line_number=6" \
  | jq '.'
echo ""
echo ""

# 步骤 6: 最终验证（手动标记应该被删除）
echo "步骤 6: 最终验证（手动标记应该被删除）"
echo "-----------------------------------"
curl -s "${BASE_URL}/api/github/analyze-file?repo_url=${REPO_URL}&file_path=${FILE_PATH}&branch=${BRANCH}" \
  | jq '{
      hasManualAttributions: .hasManualAttributions,
      manualAttributionCount: .manualAttributionCount,
      line6: .analysis[5]
    }'
echo ""
echo ""

echo "========================================="
echo "测试完成！"
echo "========================================="

