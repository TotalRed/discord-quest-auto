import { mkdir, writeFile, copyFile, cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root } from '../app/config.mjs';
// Runtime version is pinned; update deliberately, then rebuild both packages.
const version = 'v22.23.4';
const base = `https://nodejs.org/dist/${version}/`;
const sumsResponse = await fetch(base + 'SHASUMS256.txt');
if (!sumsResponse.ok) throw new Error('Cannot download Node checksums');
const sums = new Map((await sumsResponse.text()).trim().split('\n').map(line => {
    const [hash, name] = line.trim().split(/\s+/); return [name, hash];
}));
const folder = join(root, 'runtime');
await mkdir(folder, { recursive: true });
for (const [platform, name] of [['linux', `node-${version}-linux-x64.tar.xz`], ['windows', `node-${version}-win-x64.zip`]]) {
    const response = await fetch(base + name);
    if (!response.ok) throw new Error(`Cannot download ${name}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== sums.get(name)) throw new Error(`SHA-256 mismatch: ${name}`);
    const archive = join(folder, name);
    await writeFile(archive, bytes);
    const tool = platform === 'linux' ? 'tar' : 'unzip';
    const args = platform === 'linux' ? ['-xJf', archive, '-C', folder] : ['-q', '-o', archive, '-d', folder];
    const result = spawnSync(tool, args, { stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error(`Extraction failed: ${name}`);
    const extracted = join(folder, `node-${version}-${platform === 'linux' ? 'linux' : 'win'}-x64`);
    const destination = join(folder, platform);
    await mkdir(destination, { recursive: true });
    await copyFile(join(extracted, platform === 'linux' ? 'bin/node' : 'node.exe'), join(destination, platform === 'linux' ? 'node' : 'node.exe'));
    await copyFile(join(extracted, 'LICENSE'), join(folder, 'NODE-LICENSE'));
    await rm(extracted, { recursive: true });
    await rm(archive);
    console.log(`${name}: SHA-256 verified`);
}
