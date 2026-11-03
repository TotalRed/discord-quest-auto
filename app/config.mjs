import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = process.env.QUEST_AUTO_DATA_DIR || (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'DiscordQuestAuto')
    : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'discord-quest-auto'));
export const settingsPath = join(dataDir, 'settings.json');
export const defaults = Object.freeze({ discordPath: '', port: 9237, scanSeconds: 60,
    stallSeconds: 600, retrySeconds: 900, autostart: false, enabled: false });

export function validateSettings(input) {
    const result = {};
    for (const key of ['enabled', 'autostart']) {
        const value = input[key] ?? defaults[key];
        if (typeof value !== 'boolean') throw new Error(`${key}: требуется true или false`);
        result[key] = value;
    }
    const limits = { port: [1024, 65535], scanSeconds: [30, 3600], stallSeconds: [180, 3600], retrySeconds: [60, 86400] };
    for (const [key, [min, max]] of Object.entries(limits)) {
        const value = input[key] ?? defaults[key];
        if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key}: допустимо ${min}–${max}`);
        result[key] = value;
    }
    const path = input.discordPath ?? '';
    if (typeof path !== 'string' || path.length > 4096 || /[\x00\r\n]/.test(path)) throw new Error('Некорректный путь к Discord');
    result.discordPath = path.trim();
    return result;
}
export async function loadSettings() {
    try { return validateSettings(JSON.parse(await readFile(settingsPath, 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') return { ...defaults }; throw error; }
}
export async function saveSettings(input) {
    const settings = validateSettings(input);
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
    return settings;
}
