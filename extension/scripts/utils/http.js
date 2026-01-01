const http = require('http');
const { log } = require('./config');

/**
 * 上报数据到后端
 */
function reportData(payload, config) {
    const data = JSON.stringify(payload);
    const url = new URL(config.REPORT_URL);

    log(`Reporting data: ${data}`);

    const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        },
        timeout: config.TIMEOUT
    };

    const req = http.request(options);
    
    req.on('error', (e) => {
        log(`Report failed: ${e.message}`);
    });

    req.write(data);
    req.end();
    log('Report sent');
}

module.exports = {
    reportData
};

