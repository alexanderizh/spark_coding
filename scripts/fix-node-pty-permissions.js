#!/usr/bin/env node
/**
 * postinstall: 修复 node-pty spawn-helper 在 macOS 上丢失的执行权限。
 * yarn/npm 安装时 prebuild 二进制可能丢失 +x，导致 posix_spawnp failed。
 * 仅 darwin 平台执行，静默跳过其他平台。
 */
const fs = require('fs');
const path = require('path');

if (process.platform !== 'darwin') return;

const root = path.resolve(__dirname, '..');
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const helperPath = path.join(root, 'node_modules', 'node-pty', 'prebuilds', `darwin-${arch}`, 'spawn-helper');

try {
  if (fs.existsSync(helperPath)) {
    fs.chmodSync(helperPath, 0o755);
  }
} catch {
  // 无写权限等场景静默忽略
}
