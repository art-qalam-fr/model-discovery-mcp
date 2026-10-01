import { spawn } from 'child_process';
const server = spawn('node', ['dist/index.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', data => { output += data; console.log('stdout:', data.toString()); });
server.stderr.on('data', data => { console.error('stderr:', data.toString()); });
server.on('close', code => { console.log('exit code:', code); });
setTimeout(() => {
  const initReq = {
    jsonrpc: '2.0',
    id:',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
  };
  server.stdin.write(JSON.stringify(initReq) + '\n');
}, 100);
setTimeout(() => { server.stdin.end(); }, 500);
