import { cp, mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { root, dataDir } from '../app/config.mjs';
import { desktopQuote } from '../app/autostart.mjs';

const target = join(dataDir, 'program');
if (root === target) throw new Error('Программа уже установлена. Открой ярлык Discord Quest Auto.');
await mkdir(target, { recursive: true });
const files = ['app', 'assets', 'runtime', 'scripts', 'docs', 'README.md', 'README.ru.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
for (const file of files) await cp(join(root, file), join(target, file), { recursive: true });
const { existsSync } = await import('node:fs');
const desktopExe = join(target, 'Discord Quest Auto.exe');
if (process.platform === 'win32' && existsSync(join(root, 'Discord Quest Auto.exe'))) await cp(join(root, 'Discord Quest Auto.exe'), desktopExe);
const node = join(target, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
if (process.platform === 'win32') {
    // Encode PowerShell as UTF-16LE, not shell interpolation. File paths are
    // literal PowerShell strings with apostrophes escaped.
    const literal = text => "'" + text.replaceAll("'", "''") + "'";
    const directory = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    await mkdir(directory, { recursive: true });
    const vbs = join(target, 'Start.vbs');
    await cp(join(root, 'Start.vbs'), vbs);
    const code = `$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut(${literal(join(directory, 'Discord Quest Auto.lnk'))}); ${existsSync(desktopExe) ? `$s.TargetPath=${literal(desktopExe)}; $s.IconLocation=${literal(desktopExe + ',0')}` : `$s.TargetPath='wscript.exe'; $s.Arguments=${literal('"' + vbs + '"')}`}; $s.WorkingDirectory=${literal(target)}; $s.Save()`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error('Не удалось создать ярлык в меню Пуск');
} else {
    await chmod(node, 0o755);
    await chmod(join(target, 'assets', 'runner-linux'), 0o755);
    const applications = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'applications');
    await mkdir(applications, { recursive: true });
    await writeFile(join(applications, 'discord-quest-auto.desktop'), `[Desktop Entry]\nType=Application\nName=Discord Quest Auto\nExec=${desktopQuote(node)} ${desktopQuote(join(target, 'app', 'agent.mjs'))} --ui\nIcon=discord\nTerminal=false\nCategories=Game;\n`, { mode: 0o644 });
}
const log = await import('node:fs').then(fs => fs.openSync(join(dataDir, 'launcher.log'), 'a', 0o600));
const child = process.platform === 'win32' && existsSync(desktopExe)
    ? spawn(desktopExe, [], { detached: true, stdio: 'ignore' })
    : spawn(node, [join(target, 'app', 'agent.mjs'), '--ui'], { detached: true, windowsHide: true, stdio: ['ignore', log, log] });
child.on('error', console.error);
child.unref();
console.log('Установлено. Открываю настройки Discord Quest Auto.');
