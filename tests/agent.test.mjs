import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

test('local UI rejects unauthenticated and foreign-origin requests; settings survive restart', { timeout: 20000, skip: process.platform === 'win32' }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dqa-test-'));
    let child;
    let exited;
    let output = '';
    const start = async () => {
        child = spawn(process.execPath, ['app/agent.mjs', '--background'], {
            cwd: new URL('..', import.meta.url), env: { ...process.env, QUEST_AUTO_DATA_DIR: dir, XDG_CONFIG_HOME: join(dir, 'config') }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        exited = once(child, 'exit');
        child.stdout.on('data', c => output += c);
        child.stderr.on('data', c => output += c);
        for (let i = 0; i < 100; i++) {
            try { return JSON.parse(await readFile(join(dir, 'control.json'), 'utf8')); }
            catch { if (child.exitCode !== null) throw new Error(output); await delay(50); }
        }
        throw new Error('agent did not start: ' + output);
    };
    try {
        const info = await start();
        const base = `http://127.0.0.1:${info.port}`;
        const headers = { authorization: `Bearer ${info.token}` };
        assert.equal((await fetch(base + '/api/status')).status, 403);
        assert.equal((await fetch(base + '/api/clients')).status, 403);
        assert.equal((await fetch(base + '/api/status', { headers: { ...headers, origin: 'https://example.org' } })).status, 403);
        const foreignHostStatus = await new Promise((resolve, reject) => {
            const req = httpRequest(base + '/api/status', { headers: { ...headers, host: 'example.org' } }, response => { response.resume(); resolve(response.statusCode); });
            req.on('error', reject); req.end();
        });
        assert.equal(foreignHostStatus, 403);
        const state = await (await fetch(base + '/api/status', { headers })).json();
        assert.equal(state.running, false);
        assert.equal(state.settings.enabled, false);
        assert.deepEqual(state.quests, []);
        assert.equal(state.connection, 'idle');
        assert.ok(Array.isArray(state.clients));
        assert.ok(Array.isArray((await (await fetch(base + '/api/clients', { headers })).json()).clients));
        const settings = { ...state.settings, scanSeconds: 120, autostart: true };
        assert.equal((await fetch(base + '/api/settings', { method: 'POST', headers, body: JSON.stringify(settings) })).status, 200);
        const startup = await readFile(join(dir, 'config', 'autostart', 'discord-quest-auto.desktop'), 'utf8');
        assert.ok(startup.includes('--background'));
        assert.equal((await fetch(base + '/api/settings', { method: 'POST', headers, body: JSON.stringify({ ...settings, autostart: false }) })).status, 200);
        assert.deepEqual(await readdir(join(dir, 'config', 'autostart')), []);
        assert.equal((await fetch(base + '/api/settings', { method: 'POST', headers, body: JSON.stringify({ port: 0 }) })).status, 400);
        const duplicate = spawn(process.execPath, ['app/agent.mjs', '--background'], { cwd: new URL('..', import.meta.url), env: { ...process.env, QUEST_AUTO_DATA_DIR: dir }, stdio: 'ignore' });
        assert.equal((await once(duplicate, 'exit'))[0], 0);
        child.kill('SIGTERM');
        await exited;
        const next = await start();
        assert.notEqual(info.token, next.token);
        const persisted = await (await fetch(`http://127.0.0.1:${next.port}/api/status`, { headers: { authorization: `Bearer ${next.token}` } })).json();
        assert.equal(persisted.settings.scanSeconds, 120);
        assert.equal(persisted.running, false);
    } finally {
        if (child && child.exitCode === null) { child.kill('SIGTERM'); await exited; }
        await rm(dir, { recursive: true, force: true });
    }
});
