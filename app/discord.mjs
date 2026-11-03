import { access, stat, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
async function executable(path, platform) {
    try {
        if (!(await stat(path)).isFile()) return false;
        if (platform !== 'win32') await access(path, constants.X_OK);
        return true;
    } catch { return false; }
}

export async function discoverDiscord(options = {}) {
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const home = options.home ?? homedir();
    const clients = [];
    const seen = new Set();
    async function add(path, label, kind = 'native', args = [], key = path) {
        const identity = platform === 'win32' ? key.toLowerCase() : key;
        if (seen.has(identity) || !await executable(path, platform)) return;
        seen.add(identity);
        clients.push({ key, command: path, args, path, label, kind });
    }
    if (platform === 'win32') {
        const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
        for (const [folder, label] of [['Discord', 'Discord'], ['DiscordPTB', 'Discord PTB'], ['DiscordCanary', 'Discord Canary']]) {
            const parents = [join(local, folder), ...[env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean).map(base => join(base, folder))];
            for (const parent of parents) {
                const versions = await readdir(parent).then(names => names.filter(name => /^app-\d/.test(name)), () => []);
                versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
                // Expose only the newest working executable per installation.
                const executableNames = folder === 'Discord' ? ['Discord.exe'] : [folder + '.exe', 'Discord.exe'];
                for (const version of versions) {
                    let found = false;
                    for (const name of executableNames) {
                        const path = join(parent, version, name);
                        if (await executable(path, platform)) { await add(path, label); found = true; break; }
                    }
                    if (found) break;
                }
                if (!clients.some(client => client.command.startsWith(parent + '\\') || client.command.startsWith(parent + '/'))) {
                    for (const name of executableNames) {
                        const path = join(parent, name);
                        if (await executable(path, platform)) { await add(path, label); break; }
                    }
                }
            }
        }
    } else {
        const names = [['discord', 'Discord'], ['Discord', 'Discord'], ['discord-ptb', 'Discord PTB'], ['discord-canary', 'Discord Canary']];
        for (const [name, label] of names) {
            for (const directory of (env.PATH || '').split(':').filter(Boolean)) await add(join(directory, name), label);
        }
        const locations = options.linuxLocations ?? [
            join(home, '.local', 'bin', 'discord'), join(home, '.config', 'discord', 'Discord'),
            '/usr/bin/discord', '/usr/lib/discord/Discord', '/usr/share/discord/Discord',
            '/opt/discord/Discord', '/opt/Discord/Discord', '/snap/bin/discord',
            '/opt/discord-ptb/DiscordPTB', '/opt/discord-canary/DiscordCanary',
        ];
        for (const path of locations) await add(path, /canary/i.test(path) ? 'Discord Canary' : /ptb/i.test(path) ? 'Discord PTB' : path.startsWith('/snap/') ? 'Discord (Snap)' : 'Discord');
        const flatpak = options.flatpakPath ?? '/usr/bin/flatpak';
        if (await executable(flatpak, platform)) {
            try {
                const result = await (options.execute ?? execute)(flatpak, ['list', '--app', '--columns=application'], { timeout: 4000, maxBuffer: 1024 * 1024, windowsHide: true });
                for (const id of result.stdout.trim().split(/\s+/)) {
                    if (!['com.discordapp.Discord', 'com.discordapp.DiscordPTB', 'com.discordapp.DiscordCanary'].includes(id)) continue;
                    await add(flatpak, `${id.replace('com.discordapp.', '')} (Flatpak)`, 'flatpak', ['run', id], `flatpak:${id}`);
                }
            } catch { /* Native installations remain available when Flatpak is unavailable. */ }
        }
    }
    return clients;
}

export async function resolveDiscord(settings, options = {}) {
    const platform = options.platform ?? process.platform;
    const path = settings.discordPath?.trim().replace(/^"(.*)"$/, '$1');
    if (path && !path.startsWith('flatpak:')) {
        if (await executable(path, platform)) return { key: path, command: path, args: [], path, label: 'Discord', kind: 'native' };
        // A command name is also accepted, without invoking a shell.
        if (!isAbsolute(path) && !/[\\/]/.test(path)) {
            const separator = platform === 'win32' ? ';' : ':';
            for (const directory of ((options.env ?? process.env).PATH || '').split(separator).filter(Boolean)) {
                const candidate = join(directory, path);
                if (await executable(candidate, platform)) return { key: candidate, command: candidate, args: [], path: candidate, label: 'Discord', kind: 'native' };
            }
        }
        throw new Error('Выбранный Discord не найден. Нажми «Найти Discord» или выбери другой файл.');
    }
    const clients = await discoverDiscord(options);
    const selected = path ? clients.find(client => client.key === path) : clients[0];
    if (!selected) throw new Error('Discord не найден. Установи клиент или укажи путь к исполняемому файлу в настройках.');
    return selected;
}
