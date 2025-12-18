const { spawn } = require('child_process');
const path = require('path');

// Start Next.js dev server
const nextDev = spawn('npm', ['run', 'dev'], {
  cwd: process.cwd(),
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true,
  env: { ...process.env, PORT: process.env.PORT || '3000' }
});

// Filter out the verbose GET request logs
let buffer = '';
nextDev.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  // Keep the last incomplete line in buffer
  buffer = lines.pop() || '';
  
  // Filter out lines that match "GET / 200 in Xms" or "GET /login 200 in Xms"
  const filtered = lines.filter(line => {
    const trimmed = line.trim();
    // Skip lines that match Next.js request logs:
    // - "[0]  GET / 200 in 22ms" (from concurrently)
    // - "GET / 200 in 22ms" (direct output)
    // Match pattern: optional [X] prefix, GET, path, status, "in", time, "ms"
    if (/^(\[\d+\]\s*)?GET\s+\/\s+\d+\s+in\s+\d+ms\s*$/.test(trimmed)) {
      return false;
    }
    if (/^(\[\d+\]\s*)?GET\s+\/login\s+\d+\s+in\s+\d+ms\s*$/.test(trimmed)) {
      return false;
    }
    return true;
  });
  
  if (filtered.length > 0) {
    process.stdout.write(filtered.join('\n') + '\n');
  }
});

nextDev.stderr.on('data', (data) => {
  process.stderr.write(data);
});

nextDev.on('close', (code) => {
  process.exit(code);
});

// Handle process termination
process.on('SIGINT', () => {
  nextDev.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  nextDev.kill('SIGTERM');
  process.exit(0);
});
