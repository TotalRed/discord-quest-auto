import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { root } from './config.mjs';

export function vbsLaunch(command) {
    return `Set shell = CreateObject("WScript.Shell")\r\nshell.Run "${command.replaceAll('"', '""')}", 0, False\r\n`;
}
export function desktopQuote(value) {
    return '"' + value.replace(/[\\"`$]/g, '\\$&').replaceAll('%', '%%') + '"';
}
export async function setAutostart(enabled) {
    let file;
    let content;
    if (process.platform === 'win32') {
        file = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Discord Quest Auto.vbs');
        const desktop = join(root, 'Discord Quest Auto.exe');
        content = existsSync(desktop) ? vbsLaunch(`"${desktop}" --hidden`)
            : vbsLaunch(`"${process.execPath}" "${join(root, 'app', 'agent.mjs')}" --background`);
    } else {
        file = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart', 'discord-quest-auto.desktop');
        content = `[Desktop Entry]\nType=Application\nName=Discord Quest Auto\nExec=${desktopQuote(process.execPath)} ${desktopQuote(join(root, 'app', 'agent.mjs'))} --background\nTerminal=false\n`;
    }
    if (enabled) {
        await mkdir(join(file, '..'), { recursive: true });
        await writeFile(file, content, { mode: 0o600 });
    } else await rm(file, { force: true });
}
