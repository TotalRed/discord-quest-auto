import { mkdir, cp, copyFile, chmod, rm, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root } from '../app/config.mjs';
const [platform, nodeBinary] = process.argv.slice(2);
if (!['linux', 'windows'].includes(platform) || !nodeBinary) throw new Error('Usage: node scripts/package.mjs linux|windows /path/to/node');
const version = JSON.parse(await readFile(join(root, 'package.json'))).version;
const name = `discord-quest-auto-${version}-${platform}-x64`;
const output = join(root, 'dist');
const folder = join(output, name);
await rm(folder, { recursive: true, force: true });
await mkdir(join(folder, 'runtime'), { recursive: true });
await mkdir(join(folder, 'assets'), { recursive: true });
for (const entry of ['app', 'scripts', 'docs', 'README.md', 'README.ru.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(join(root, entry), join(folder, entry), { recursive: true });
const runner = platform === 'windows' ? 'runner-win.exe' : 'runner-linux';
await copyFile(join(root, 'assets', runner), join(folder, 'assets', runner));
await copyFile(resolve(nodeBinary), join(folder, 'runtime', platform === 'windows' ? 'node.exe' : 'node'));
if (platform === 'windows') {
    const desktop = process.env.DESKTOP_EXE;
    if (!desktop) throw new Error('DESKTOP_EXE: path to the built Tauri window (Discord Quest Auto.exe) is required');
    await copyFile(resolve(desktop), join(folder, 'Discord Quest Auto.exe'));
}
await copyFile(join(root, 'runtime', 'NODE-LICENSE'), join(folder, 'runtime', 'NODE-LICENSE'));
for (const entry of platform === 'windows' ? ['Start.vbs', 'Install.vbs'] : ['Start.sh', 'Install.sh']) {
    await copyFile(join(root, entry), join(folder, entry));
    if (platform === 'linux') await chmod(join(folder, entry), 0o755);
}
if (platform === 'linux') {
    await chmod(join(folder, 'runtime', 'node'), 0o755);
    await chmod(join(folder, 'assets', runner), 0o755);
}
const zip = join(output, name + '.zip');
await rm(zip, { force: true });
const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive', '-LiteralPath', folder, '-DestinationPath', zip], { stdio: 'inherit' })
    : spawnSync('zip', ['-q', '-r', zip, name], { cwd: output, stdio: 'inherit' });
if (result.error || result.status !== 0) throw new Error('Archive creation failed');
const hash = createHash('sha256').update(await readFile(zip)).digest('hex');
await writeFile(zip + '.sha256', `${hash}  ${name}.zip\n`);
console.log(zip);
