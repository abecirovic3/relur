// node-pty 1.1.0 publishes its prebuilt spawn-helper without the executable
// bit, so every PTY spawn fails with "posix_spawnp failed". Restore it.
import fs from 'node:fs';
import path from 'node:path';

const prebuilds = path.join(import.meta.dirname, '..', 'node_modules', 'node-pty', 'prebuilds');
if (fs.existsSync(prebuilds)) {
  for (const dir of fs.readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, dir, 'spawn-helper');
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
  }
}
