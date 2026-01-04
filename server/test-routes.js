#!/usr/bin/env node

/**
 * 测试所有 API 路由是否正常工作
 */

const http = require('http');

const BASE_URL = 'http://localhost:3001';

const routes = [
    '/',
    '/api/projects',
    '/api/stats',
    '/api/github/commits?repo_url=https://github.com/youxingzhi/ai-stat-demo&branch=main',
];

function testRoute(path) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname + url.search,
            method: 'GET',
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    path: path,
                    data: data.substring(0, 100) // 只显示前100个字符
                });
            });
        });

        req.on('error', (error) => {
            reject({ path: path, error: error.message });
        });

        req.end();
    });
}

async function testAllRoutes() {
    console.log('Testing API routes...\n');

    for (const route of routes) {
        try {
            const result = await testRoute(route);
            const status = result.statusCode === 200 ? '✓' : '✗';
            console.log(`${status} ${route.padEnd(60)} [${result.statusCode}]`);
            if (result.statusCode !== 200) {
                console.log(`   Response: ${result.data}`);
            }
        } catch (error) {
            console.log(`✗ ${route.padEnd(60)} [ERROR]`);
            console.log(`   Error: ${error.error || error.message}`);
        }
    }

    console.log('\nDone!');
}

testAllRoutes().catch(console.error);


