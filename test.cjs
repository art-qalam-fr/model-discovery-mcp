const { spawnSync } = require('child_process');
const req = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } };
const input = JSON.stringify(req) + '\n';
const result = spawnSync('node', ['dist/index.js'], { input, encoding: 'utf8' });
console.log('stdout:', result.stdout);
console.error('stderr:', result.stderr);
console.log('exit code:', result.status);
