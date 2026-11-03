import { spawn, execFile } from 'node:child_process';
import { copyFile, mkdir, chmod } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { root, dataDir, loadSettings } from './config.mjs';
import { resolveDiscord } from './discord.mjs';
const settings = await loadSettings();
const port = settings.port;
const endpoint = `http://127.0.0.1:${port}`;
let stopping = false;
const shutdown = new AbortController();
const pause = async ms => {
    try { await delay(ms, undefined, { signal: shutdown.signal }); }
    catch (error) { if (error.name !== 'AbortError') throw error; }
};
const runners = new Map();
const startingRunners = new Map();
let questSnapshot;
let questSnapshotTime = 0;
let rateLimitUntil = 0;
let client;
function stop() {
    stopping = true;
    shutdown.abort();
    for (const { process } of runners.values()) process.kill();
    client?.close();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
process.on('message', message => { if (message === 'stop') stop(); });
const log = message => console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
const report = (type, value = {}) => {
    if (process.connected) process.send({ type, ...value }, () => {});
};

export function executableParts(name) {
    const parts = name.split(/[\\/]/);
    if (!parts.length || parts.some(p => !p || p === '.' || p === '..' || /[:\x00-\x1f]/.test(p))) {
        throw new Error('Небезопасный путь исполняемого файла');
    }
    return parts;
}

export function pendingQuests(body, now = Date.now()) {
    const quests = Array.isArray(body) ? body : body?.quests;
    if (!Array.isArray(quests)) throw new Error('Discord изменил формат списка квестов');
    return quests.flatMap(q => {
        const config = q.config;
        const status = q.user_status ?? q.userStatus ?? {};
        const taskConfig = config?.task_config_v2 ?? config?.taskConfigV2 ?? config?.task_config ?? config?.taskConfig;
        const tasks = taskConfig?.tasks;
        const task = tasks?.PLAY_ON_DESKTOP;
        const expires = Date.parse(config?.expires_at ?? config?.expiresAt);
        const target = Number(task?.target);
        const appIds = [...new Set((task?.applications?.length ? task.applications.map(app => String(app.id)) :
            [String(config?.application?.id ?? '')]).filter(id => /^\d+$/.test(id)))];
        const appId = appIds[0] ?? '';
        if (!/^\d+$/.test(String(q.id)) || !/^\d+$/.test(appId) ||
            !Number.isFinite(expires) || expires <= now || status.completed_at || status.completedAt ||
            !Number.isFinite(target) || target <= 0) return [];
        // With OR, PC / Xbox / PlayStation are alternatives, not extra requirements.
        if (Object.keys(tasks).length !== 1 && String(taskConfig.join_operator ?? taskConfig.joinOperator).toLowerCase() !== 'or') return [];
        return [{ id: String(q.id), appId, appIds, target, expires,
            name: config.messages?.quest_name ?? config.messages?.questName ?? config.application?.name ?? q.id,
            enrolled: Boolean(status.enrolled_at ?? status.enrolledAt),
            progress: Number(status.progress?.PLAY_ON_DESKTOP?.value ?? status.stream_progress_seconds ?? 0) }];
    });
}

export function selectQuestRunner(quest, games, platform = process.platform) {
    const candidates = (quest.appIds ?? [quest.appId]).flatMap(appId => {
        const game = games.find(game => String(game.id) === appId);
        return (game?.executables ?? []).filter(executable => !executable.is_launcher).flatMap(executable => {
            if (!(platform === 'win32' ? ['win32'] : ['linux', 'win32']).includes(executable.os)) return [];
            try { executableParts(executable.name); }
            catch { return []; }
            return [{ appId, gameName: game.name, executable }];
        });
    });
    return candidates.find(candidate => candidate.executable.os === platform) ?? candidates[0];
}

class CDP {
    constructor(socket) {
        this.socket = socket;
        this.nextId = 0;
        this.pending = new Map();
        socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            const entry = this.pending.get(message.id);
            if (!entry) return;
            this.pending.delete(message.id);
            clearTimeout(entry.timer);
            if (message.error) entry.reject(new Error(message.error.message));
            else entry.resolve(message.result);
        });
        socket.addEventListener('close', () => {
            for (const entry of this.pending.values()) {
                clearTimeout(entry.timer);
                entry.reject(new Error('Соединение с Discord закрыто'));
            }
            this.pending.clear();
        });
    }
    static async connect(url) {
        const parsed = new URL(url);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('CDP должен быть локальным');
        const socket = new WebSocket(url);
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { socket.close(); reject(new Error('CDP timeout')); }, 10000);
            socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
            socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
        });
        return new CDP(socket);
    }
    send(method, params) {
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Discord не ответил за 30 секунд'));
            }, 30000);
            this.pending.set(id, { resolve, reject, timer });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }
    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error('Ошибка внутри клиента Discord: ' + (result.exceptionDetails.exception?.description ?? result.exceptionDetails.text));
        return result.result.value;
    }
    close() { this.socket.close(); }
}

// Resolve Discord's existing HTTP client inside its renderer. Its credentials
// stay inside Discord; no account token is requested, extracted, or persisted.
const rendererRequest = async (method, url, body) => {
    const chunks = window.webpackChunkdiscord_app;
    if (!chunks) throw new Error('Открой основной экран Discord и дождись загрузки');
    const require = chunks.push([[`quest-helper-${Date.now()}`], {}, r => r]);
    chunks.pop();
    let api;
    for (const module of Object.values(require.c)) {
        const exported = module?.exports;
        if (!exported) continue;
        for (const key of Object.keys(exported)) {
            try {
                const candidate = exported[key];
                if (candidate && typeof candidate.get === 'function' && typeof candidate.post === 'function' &&
                    typeof candidate.put === 'function' && typeof candidate.del === 'function') { api = candidate; break; }
            } catch { /* Some exports are lazy getters. */ }
        }
        if (api) break;
    }
    if (!api) throw new Error('Не найден HTTP-клиент Discord; требуется обновление помощника');
    try {
        const response = await api[method]({ url, ...(body === undefined ? {} : { body }), retries: 0 });
        return { ok: true, status: response.status, body: response.body };
    } catch (error) {
        // Return only status and retry interval, never headers or account data.
        return { ok: false, status: error.status ?? error.response?.status ?? 0,
            retryAfter: error.body?.retry_after ?? error.response?.body?.retry_after };
    }
};

async function request(method, url, body) {
    if (Date.now() < rateLimitUntil) await pause(rateLimitUntil - Date.now());
    if (stopping) throw new Error('Остановка');
    const response = await client.evaluate(`(${rendererRequest.toString()})(${JSON.stringify(method)},${JSON.stringify(url)},${JSON.stringify(body)})`);
    if (!response?.ok) {
        const error = new Error(`Discord API: HTTP ${response?.status ?? 'unknown'} (${url})`);
        error.retryAfter = response?.status === 429 ? Math.max(60, Number(response.retryAfter) || 60) : null;
        if (error.retryAfter) rateLimitUntil = Math.max(rateLimitUntil, Date.now() + error.retryAfter * 1000);
        throw error;
    }
    return response.body;
}

// Returns { open, tabs } for the debugging endpoint.
async function probe() {
    try {
        const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(2000) });
        return { open: true, tabs: await response.json() };
    } catch { return { open: false, tabs: [] }; }
}
const discordTab = tabs => tabs.find(t => t.type === 'page' && /^https:\/\/(?:canary\.|ptb\.)?discord\.com\/(?:channels|app|quest-home|store|shop|discovery)(?:[/?#]|$)/.test(t.url));

function runningImages(names) {
    return new Promise(resolveList => {
        if (process.platform !== 'win32') {
            execFile('ps', ['-eo', 'comm='], { timeout: 4000 }, (error, stdout) =>
                resolveList(error ? [] : names.filter(n => stdout.split('\n').some(l => l.trim() === n))));
            return;
        }
        execFile('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 6000, windowsHide: true }, (error, stdout) => {
            if (error) return resolveList([]);
            const running = new Set(stdout.split(/\r?\n/).map(line => line.split('","')[0]?.replace(/^"/, '').toLowerCase()));
            resolveList(names.filter(n => running.has(n.toLowerCase())));
        });
    });
}
function killImage(name) {
    return new Promise(done => {
        const [cmd, args] = process.platform === 'win32' ? ['taskkill', ['/IM', name, '/T', '/F']] : ['pkill', ['-x', name]];
        execFile(cmd, args, { timeout: 10000, windowsHide: true }, () => done());
    });
}

async function attach(launch) {
    // Discord may already be running with the debugging port from an earlier start.
    const initial = await probe();
    if (initial.open && discordTab(initial.tabs)?.webSocketDebuggerUrl) return CDP.connect(discordTab(initial.tabs).webSocketDebuggerUrl);
    if (launch && !initial.open) {
        const selected = await resolveDiscord(settings);
        if (selected.kind === 'native') {
            const image = basename(selected.command);
            const running = await runningImages([image]);
            if (running.length) {
                if (!settings.restartDiscord) throw new Error(`${image} уже запущен без отладочного порта. Закрой Discord через трей → Quit или включи «Перезапускать Discord» в настройках.`);
                log(`${image} уже открыт без порта ${port} — перезапускаю его с нужными параметрами.`);
                await killImage(image);
                for (let i = 0; i < 20 && (await runningImages([image])).length; i++) await pause(500);
                await pause(1500);
            }
        }
    }
    if (launch) {
        const args = [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'];
        // Keep Discord outside the helper's service cgroup: stopping the helper
        // should terminate its runners without closing the user's Discord.
        const background = process.platform === 'linux' && process.env.DISCORD_QUEST_BACKGROUND === '1';
        const selected = await resolveDiscord(settings);
        report('connection', { state: 'connecting', client: selected.label });
        const app = spawn(background ? '/usr/bin/systemd-run' : selected.command, background ?
            ['--user', '--collect', '--unit=discord-quest-client', selected.command, ...selected.args, ...args] : [...selected.args, ...args], {
            detached: true, stdio: 'ignore', windowsHide: true,
        });
        app.on('error', () => log('Не удалось запустить Discord. Проверь путь в настройках.'));
        app.unref();
    }
    let last = { open: false, tabs: [] };
    for (let i = 0; i < (launch ? 60 : 1) && !stopping; i++) {
        last = await probe();
        const tab = discordTab(last.tabs);
        if (tab?.webSocketDebuggerUrl) return CDP.connect(tab.webSocketDebuggerUrl);
        await pause(1000);
    }
    if (last.open) {
        const urls = last.tabs.filter(t => t.type === 'page').map(t => t.url.replace(/[?#].*$/, '')).join(', ') || 'нет страниц';
        throw new Error(`Порт ${port} открыт, но главное окно Discord не найдено (страницы: ${urls}). Войди в аккаунт и дождись загрузки.`);
    }
    throw new Error(`Порт ${port} так и не открылся. Discord запущен без отладочного режима: закрой его через трей → Quit (или включи «Перезапускать Discord») и запусти снова.`);
}

async function waitForDiscord() {
    log('Ожидаю загрузку Discord…');
    const deadline = Date.now() + 120000;
    while (!stopping && Date.now() < deadline) {
        try {
            const ready = await client.evaluate(`(() => {
                const chunks = window.webpackChunkdiscord_app;
                if (!chunks || document.readyState !== 'complete') return false;
                const require = chunks.push([['quest-ready-' + Date.now()], {}, r => r]);
                chunks.pop();
                if (!require?.c) return false;
                return Object.values(require.c).some(module => {
                    try {
                        return Object.values(module?.exports ?? {}).some(value =>
                            value && typeof value.get === 'function' &&
                            typeof value.post === 'function' && typeof value.put === 'function' &&
                            typeof value.del === 'function');
                    } catch { return false; }
                });
            })()`);
            if (ready) return;
        } catch { /* A page navigation can briefly destroy the execution context. */ }
        await pause(1000);
    }
    if (!stopping) throw new Error('Discord не загрузился за 2 минуты. Открой основной экран клиента и повтори запуск.');
}

async function createRunner(quest, executable) {
    const key = `${quest.appId}:${executable.name}`;
    const existing = runners.get(key);
    if (existing) {
        existing.users.add(quest.id);
        return existing.process;
    }
    const parts = executableParts(executable.name);
    const base = join(dataDir, 'games-cache');
    await mkdir(base, { recursive: true });
    const template = join(root, 'assets', process.platform === 'win32' ? 'runner-win.exe' : 'runner-linux');
    const path = join(base, 'games', quest.appId, ...parts);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(template, path);
    await chmod(path, 0o755);
    const child = spawn(path, [], { cwd: dirname(path), stdio: 'ignore', windowsHide: true });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    runners.set(key, { process: child, users: new Set([quest.id]) });
    if (stopping) child.kill();
    return child;
}

async function startRunner(quest, executable) {
    const key = `${quest.appId}:${executable.name}`;
    let starting = startingRunners.get(key);
    if (!starting) {
        starting = createRunner(quest, executable);
        startingRunners.set(key, starting);
    }
    try {
        const process = await starting;
        runners.get(key)?.users.add(quest.id);
        return process;
    } finally {
        startingRunners.delete(key);
    }
}

function releaseRunner(quest, executable) {
    const key = `${quest.appId}:${executable.name}`;
    const runner = runners.get(key);
    if (!runner) return;
    runner.users.delete(quest.id);
    if (!runner.users.size) {
        runner.process.kill();
        runners.delete(key);
    }
}

async function readQuests() {
    // Concurrent workers share one API request per polling interval.
    if (!questSnapshot || Date.now() - questSnapshotTime >= 10000) {
        questSnapshotTime = Date.now();
        questSnapshot = request('get', '/quests/@me');
    }
    return questSnapshot;
}

async function runQuest(quest, executable) {
    let runner;
    try {
        // Check the runner before enrolling, so missing build tools do not enroll quests.
        runner = await startRunner(quest, executable);
        if (!quest.enrolled) {
            await request('post', `/quests/${quest.id}/enroll`, { location: 11, is_targeted: false });
            log(`Принят квест: ${quest.name}`);
        }
        log(`Запущен ${executable.name}. Проверяю, засчитывает ли Discord время.`);
        report('quest', { id: quest.id, name: quest.name, target: quest.target, progress: quest.progress, status: 'running' });
        let lastProgress = quest.progress;
        let lastChange = Date.now();
        const deadline = Date.now() + Math.max(0, quest.target - quest.progress) * 1000 + 900000;
        let lastWaitingLog = Date.now();
        while (!stopping && Date.now() < Math.min(deadline, quest.expires)) {
            await pause(15000);
            if (stopping) return;
            if (runner.exitCode !== null || runner.signalCode !== null) throw new Error('Runner завершился раньше времени');
            const body = await readQuests();
            const quests = Array.isArray(body) ? body : body?.quests;
            if (!Array.isArray(quests)) throw new Error('Не удалось прочитать состояние квеста');
            const current = quests.find(q => String(q.id) === quest.id);
            if (!current) throw new Error('Квест исчез из списка доступных');
            const status = current.user_status ?? current.userStatus ?? {};
            if (status.completed_at || status.completedAt) {
                log(`Квест выполнен: ${quest.name}. Награду забери в Discord.`);
                report('quest', { id: quest.id, status: 'completed', progress: quest.target });
                return;
            }
            const progress = Number(status.progress?.PLAY_ON_DESKTOP?.value ?? status.stream_progress_seconds ?? 0);
            if (progress > lastProgress) {
                lastProgress = progress;
                lastChange = Date.now();
                log(`${quest.name}: ${progress}/${quest.target} сек.`);
                report('quest', { id: quest.id, progress, status: 'running' });
            }
            if (Date.now() - lastChange > settings.stallSeconds * 1000) throw new Error(`За ${settings.stallSeconds} сек. Discord не сообщил нового прогресса; процесс остановлен`);
            if (Date.now() - lastChange > 120000 && Date.now() - lastWaitingLog > 60000) {
                log(`${quest.name}: ${lastProgress}/${quest.target} сек.; ожидаю обновления от Discord, процесс работает.`);
                lastWaitingLog = Date.now();
            }
        }
        if (!stopping) throw new Error('Истекло время ожидания или срок действия квеста');
    } finally {
        if (runner) releaseRunner(quest, executable);
    }
}

async function main() {
    if (!['linux', 'win32'].includes(process.platform)) throw new Error('Поддерживаются Windows и Linux');
    const launch = process.argv.includes('--launch');
    const check = process.argv.includes('--check');
    client = await attach(launch);
    log('Подключено к Discord. Токен аккаунта не нужен. Остановка: Ctrl+C.');
    await waitForDiscord();
    if (stopping) return;
    report('connection', { state: 'connected' });
    const attempts = new Map();
    const workers = new Map();
    let games = await request('get', '/applications/detectable');
    let gamesUpdatedAt = Date.now();
    if (!Array.isArray(games)) throw new Error('Неверный формат списка игр');
    while (!stopping) {
        try {
            if (Date.now() - gamesUpdatedAt > 3600000) {
                const latest = await request('get', '/applications/detectable');
                if (Array.isArray(latest)) { games = latest; gamesUpdatedAt = Date.now(); }
            }
            const quests = pendingQuests(await readQuests());
            report('scan', { available: quests.length, nextScanAt: Date.now() + settings.scanSeconds * 1000 });
            log(`Доступно квестов на запуск игры: ${quests.length}; сейчас выполняется: ${workers.size}.`);
            if (check) {
                for (const quest of quests) log(`${quest.name}: ${quest.progress}/${quest.target} сек.; принят: ${quest.enrolled}`);
                return;
            }
            for (const quest of quests) {
                if (stopping || workers.has(quest.id) || (attempts.get(quest.id) ?? 0) > Date.now()) continue;
                const selected = selectQuestRunner(quest, games);
                if (!selected) {
                    attempts.set(quest.id, Date.now() + 3600000);
                    log(`Пропущен ${quest.name}: нет подходящего исполняемого файла ни у одной из ${quest.appIds.length} игр.`);
                    report('quest', { id: quest.id, name: quest.name, target: quest.target, progress: quest.progress, status: 'skipped', reason: 'Нет подходящего процесса в справочнике Discord' });
                    continue;
                }
                const { executable } = selected;
                if (quest.appIds.length > 1) log(`${quest.name}: выбрана ${selected.gameName} из ${quest.appIds.length} допустимых игр.`);
                // Start each worker without waiting for the previous quest to finish.
                attempts.set(quest.id, Infinity);
                const worker = runQuest({ ...quest, appId: selected.appId }, executable).catch(error => {
                    log(`${quest.name}: ${error.message}`);
                    report('quest', { id: quest.id, name: quest.name, target: quest.target, status: 'waiting', reason: error.message });
                    attempts.set(quest.id, Date.now() + (error.retryAfter ? error.retryAfter * 1000 : settings.retrySeconds * 1000));
                }).finally(() => workers.delete(quest.id));
                workers.set(quest.id, worker);
                // Avoid concurrent copies to the same executable and space enrollments.
                await pause(1000);
                if (Date.now() < rateLimitUntil) break;
            }
            // Keep discovering quests while existing workers monitor their progress.
            if (!stopping) await pause(settings.scanSeconds * 1000);
        } catch (error) {
            if (!error.retryAfter) throw error;
            log(`Ограничение Discord: пауза ${error.retryAfter} сек.`);
            await pause(error.retryAfter * 1000);
        }
    }
    await Promise.all(workers.values());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        if (!stopping) { console.error(error.message); process.exitCode = 1; }
    }).finally(() => {
        stopping = true;
        shutdown.abort();
        for (const { process } of runners.values()) process.kill();
        client?.close();
        if (process.connected) process.disconnect();
    });
}
