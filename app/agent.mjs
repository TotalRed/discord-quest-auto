import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn, fork } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, root, loadSettings, saveSettings } from './config.mjs';
import { setAutostart } from './autostart.mjs';

await mkdir(dataDir, { recursive: true, mode: 0o700 });
const infoPath = join(dataDir, 'control.json');
const lockPath = join(dataDir, 'agent.lock');
const logPath = join(dataDir, 'latest.log');
const ui = process.argv.includes('--ui');
const token = randomBytes(32).toString('hex');
let settings = await loadSettings();
let worker;
let quitting = false;
let restartTimer;
let saveBusy = false;

function openBrowser(url) {
    const child = process.platform === 'win32'
        ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true })
        : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => console.log('Открой настройки: ' + url));
    child.unref();
}
async function existing() {
    try {
        const info = JSON.parse(await readFile(infoPath, 'utf8'));
        if (!Number.isInteger(info.port) || info.port < 1024 || info.port > 65535 || !/^[a-f0-9]{64}$/.test(info.token)) return;
        const response = await fetch(`http://127.0.0.1:${info.port}/api/status`, {
            headers: { authorization: `Bearer ${info.token}` }, signal: AbortSignal.timeout(2000),
        });
        if (response.ok) return info;
    } catch { /* No live instance. */ }
}
const previous = await existing();
if (previous) {
    if (ui) openBrowser(`http://127.0.0.1:${previous.port}/#${previous.token}`);
    process.exit(0);
}
// Atomic lock prevents two login/menu launches from starting duplicate workers.
async function acquireLock() {
    try { return await open(lockPath, 'wx', 0o600); }
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const pid = Number(await readFile(lockPath, 'utf8').catch(() => '0'));
        if (pid > 0) {
            try { process.kill(pid, 0); throw new Error('Программа уже запускается. Повтори открытие настроек через несколько секунд.'); }
            catch (error) { if (error.code !== 'ESRCH') throw error; }
        } else {
            const live = await existing();
            if (live) throw new Error('Программа уже запущена');
            // An empty lock may belong to an instance between open() and write().
            const { stat } = await import('node:fs/promises');
            if (Date.now() - (await stat(lockPath)).mtimeMs < 10000) throw new Error('Программа запускается. Повтори через несколько секунд.');
        }
        await unlink(lockPath);
        return open(lockPath, 'wx', 0o600);
    }
}
const lock = await acquireLock();
await lock.writeFile(String(process.pid));

async function startWorker() {
    if (worker || !settings.enabled || quitting) return;
    // Rotate the text log before spawning a new worker (up to 5 MiB per file).
    const fs = await import('node:fs/promises');
    if (await fs.stat(logPath).then(s => s.size > 5 * 1024 * 1024, () => false)) {
        await fs.rm(logPath + '.old', { force: true });
        await fs.rename(logPath, logPath + '.old');
    }
    const log = await open(logPath, 'a', 0o600);
    try {
        worker = fork(join(root, 'app', 'quests.mjs'), ['--launch'], {
            stdio: ['ignore', log.fd, log.fd, 'ipc'], windowsHide: true,
            env: { ...process.env, QUEST_AUTO_DATA_DIR: dataDir, DISCORD_QUEST_BACKGROUND: '0' },
        });
    } finally { await log.close(); }
    worker.once('error', error => console.error('Worker:', error.message));
    worker.once('exit', () => {
        worker = undefined;
        if (!quitting && settings.enabled) restartTimer = setTimeout(() => startWorker().catch(console.error), 60000);
    });
}
async function stopWorker() {
    clearTimeout(restartTimer);
    if (!worker) return;
    const current = worker;
    await new Promise(resolve => {
        const timeout = setTimeout(() => current.kill('SIGKILL'), 10000);
        current.once('exit', () => { clearTimeout(timeout); resolve(); });
        try { if (current.connected) current.send('stop'); else current.kill(); }
        catch { current.kill(); }
    });
}
function authorized(request) {
    const actual = Buffer.from(request.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function json(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
}
const server = createServer(async (request, response) => {
    try {
        const allowedHost = `127.0.0.1:${server.address().port}`;
        if (request.headers.host !== allowedHost || (request.headers.origin && request.headers.origin !== `http://${allowedHost}`)) return json(response, 403, { error: 'Forbidden origin' });
        response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'");
        response.setHeader('x-content-type-options', 'nosniff');
        response.setHeader('referrer-policy', 'no-referrer');
        if (request.url.startsWith('/api/')) {
            if (!authorized(request)) return json(response, 403, { error: 'Открой настройки через ярлык программы' });
            if (request.method === 'GET' && request.url === '/api/status') {
                let logs = '';
                try {
                    const file = await open(logPath, 'r');
                    try {
                        const size = (await file.stat()).size;
                        const buffer = Buffer.alloc(Math.min(50000, size));
                        await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
                        logs = buffer.toString('utf8');
                    } finally { await file.close(); }
                } catch { /* No logs yet. */ }
                return json(response, 200, { settings, running: Boolean(worker), platform: process.platform, logs });
            }
            if (request.method === 'POST' && request.url === '/api/settings') {
                if (saveBusy) return json(response, 409, { error: 'Настройки уже сохраняются' });
                saveBusy = true;
                try {
                    let body = '';
                    for await (const chunk of request) {
                        body += chunk;
                        if (Buffer.byteLength(body) > 10000) return json(response, 413, { error: 'Request too large' });
                    }
                    const { validateSettings } = await import('./config.mjs');
                    const next = validateSettings(JSON.parse(body));
                    await setAutostart(next.autostart);
                    settings = await saveSettings(next);
                    await stopWorker();
                    await startWorker();
                    return json(response, 200, { ok: true });
                } finally { saveBusy = false; }
            }
            return json(response, 404, { error: 'Not found' });
        }
        const files = { '/': ['index.html', 'text/html'], '/ui.js': ['ui.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
        if (request.method !== 'GET' || !files[request.url]) { response.writeHead(404); return response.end(); }
        const [file, mime] = files[request.url];
        response.writeHead(200, { 'content-type': `${mime}; charset=utf-8`, 'cache-control': 'no-store' });
        response.end(await readFile(join(root, 'app', file)));
    } catch (error) { if (!response.headersSent) json(response, 400, { error: error.message }); else response.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
await writeFile(infoPath, JSON.stringify({ port, token }), { mode: 0o600 });
if (ui) openBrowser(`http://127.0.0.1:${port}/#${token}`);
await startWorker();
async function quit() {
    if (quitting) return;
    quitting = true;
    await stopWorker();
    await unlink(infoPath).catch(() => {});
    await lock.close();
    await unlink(lockPath).catch(() => {});
    server.closeAllConnections();
    server.close();
}
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
