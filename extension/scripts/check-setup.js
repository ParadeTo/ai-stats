#!/usr/bin/env node

/**
 * check-setup.js - 检查插件环境配置是否正确
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('🔍 AI Code Tracker - Environment Check\n');

const checks = [];

// 1. 检查 ~/.cursor/hooks.json
const hooksPath = path.join(os.homedir(), '.cursor', 'hooks.json');
if (fs.existsSync(hooksPath)) {
    checks.push({ name: '✅ Hooks config exists', path: hooksPath, status: 'ok' });
    try {
        const content = fs.readFileSync(hooksPath, 'utf8');
        const config = JSON.parse(content);
        
        const hasStop = config.hooks?.stop?.some?.(h => h.command?.includes('stop.js'));
        const hasBeforeSubmit = config.hooks?.beforeSubmitPrompt?.some?.(h => h.command?.includes('beforeSubmitPrompt.js'));
        
        if (hasStop) {
            checks.push({ name: '✅ stop hook registered', status: 'ok' });
        } else {
            checks.push({ name: '⚠️  stop hook NOT found', status: 'warning' });
        }
        
        if (hasBeforeSubmit) {
            checks.push({ name: '✅ beforeSubmitPrompt hook registered', status: 'ok' });
        } else {
            checks.push({ name: '⚠️  beforeSubmitPrompt hook NOT found', status: 'warning' });
        }
    } catch (e) {
        checks.push({ name: '❌ Failed to parse hooks.json', error: e.message, status: 'error' });
    }
} else {
    checks.push({ name: '❌ Hooks config NOT found', path: hooksPath, status: 'error' });
}

// 2. 检查 ~/.ai-code-stats 目录
const trackerDir = path.join(os.homedir(), '.ai-code-stats');
if (fs.existsSync(trackerDir)) {
    checks.push({ name: '✅ Tracker directory exists', path: trackerDir, status: 'ok' });
    
    const debugLog = path.join(trackerDir, 'debug.log');
    if (fs.existsSync(debugLog)) {
        const stats = fs.statSync(debugLog);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        checks.push({ name: `✅ Debug log exists (${sizeMB} MB)`, path: debugLog, status: 'ok' });
    } else {
        checks.push({ name: 'ℹ️  Debug log not yet created', path: debugLog, status: 'info' });
    }
} else {
    checks.push({ name: 'ℹ️  Tracker directory will be created on first run', path: trackerDir, status: 'info' });
}

// 3. 检查钩子脚本是否存在
const extensionDir = path.join(__dirname, '..');
const stopScript = path.join(extensionDir, 'scripts', 'stop.js');
const beforeSubmitScript = path.join(extensionDir, 'scripts', 'beforeSubmitPrompt.js');

if (fs.existsSync(stopScript)) {
    checks.push({ name: '✅ stop.js script exists', path: stopScript, status: 'ok' });
} else {
    checks.push({ name: '❌ stop.js script NOT found', path: stopScript, status: 'error' });
}

if (fs.existsSync(beforeSubmitScript)) {
    checks.push({ name: '✅ beforeSubmitPrompt.js script exists', path: beforeSubmitScript, status: 'ok' });
} else {
    checks.push({ name: '❌ beforeSubmitPrompt.js script NOT found', path: beforeSubmitScript, status: 'error' });
}

// 4. 检查后端服务
const http = require('http');
const req = http.get('http://localhost:3001/', (res) => {
    checks.push({ name: '✅ Backend server is running', status: 'ok' });
    printResults();
});

req.on('error', (e) => {
    checks.push({ name: '⚠️  Backend server NOT running', detail: 'Start with: cd server && node index.js', status: 'warning' });
    printResults();
});

req.setTimeout(2000, () => {
    req.destroy();
    checks.push({ name: '⚠️  Backend server timeout', status: 'warning' });
    printResults();
});

function printResults() {
    console.log('═'.repeat(60));
    checks.forEach(check => {
        console.log(check.name);
        if (check.path) console.log(`   Path: ${check.path}`);
        if (check.detail) console.log(`   Detail: ${check.detail}`);
        if (check.error) console.log(`   Error: ${check.error}`);
    });
    console.log('═'.repeat(60));
    
    const errors = checks.filter(c => c.status === 'error').length;
    const warnings = checks.filter(c => c.status === 'warning').length;
    
    console.log('\n📊 Summary:');
    console.log(`   Errors: ${errors}`);
    console.log(`   Warnings: ${warnings}`);
    
    if (errors === 0 && warnings === 0) {
        console.log('\n🎉 All checks passed! You can start debugging.\n');
        console.log('Next steps:');
        console.log('  1. Press F5 in Cursor to start Extension Development Host');
        console.log('  2. Use AI to generate code and Accept');
        console.log('  3. Monitor: tail -f ~/.ai-code-stats/debug.log');
    } else {
        console.log('\n⚠️  Please fix the issues above before debugging.\n');
    }
}

