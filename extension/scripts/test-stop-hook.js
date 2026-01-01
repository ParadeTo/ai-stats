#!/usr/bin/env node

/**
 * test-stop-hook.js - 测试 stop.js 钩子的脚本
 * 用法：node test-stop-hook.js
 */

const { spawn } = require('child_process');
const path = require('path');

const testData = {
    generation_id: `test-gen-${Date.now()}`,
    conversation_id: 'test-conv-456',
    model: 'gpt-4',
    status: 'completed',
    workspace_roots: [process.cwd()]
};

console.log('🧪 Testing stop.js hook...');
console.log('📦 Test data:', JSON.stringify(testData, null, 2));
console.log('');

const stopScriptPath = path.join(__dirname, 'stop.js');
const child = spawn('node', [stopScriptPath], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe']
});

// 将测试数据发送到 stdin
child.stdin.write(JSON.stringify(testData));
child.stdin.end();

child.stdout.on('data', (data) => {
    console.log('📤 stdout:', data.toString());
});

child.stderr.on('data', (data) => {
    console.error('❌ stderr:', data.toString());
});

child.on('close', (code) => {
    console.log('');
    console.log(`✅ Process exited with code ${code}`);
    console.log('');
    console.log('📋 Next steps:');
    console.log('  1. Check debug log: tail -f ~/.ai-code-stats/debug.log');
    console.log('  2. Check hooks input: cat ~/.ai-code-stats/hooks_input.json');
    console.log('  3. Verify server received data: check http://localhost:3001/api/stats');
});

