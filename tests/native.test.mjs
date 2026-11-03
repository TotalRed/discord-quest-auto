import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const runner = new URL(process.platform === 'win32' ? '../assets/runner-win.exe' : '../assets/runner-linux', import.meta.url);
test('native runner starts and remains alive until stopped', async () => {
    await access(runner);
    const child = spawn(fileURLToPath(runner), [], { stdio: 'ignore', windowsHide: true });
    const exit = once(child, 'exit');
    try {
        await once(child, 'spawn');
        await delay(150);
        assert.equal(child.exitCode, null);
        assert.equal(child.signalCode, null);
    } finally { child.kill(); await exit; }
});
