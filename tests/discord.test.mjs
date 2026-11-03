import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { discoverDiscord, resolveDiscord } from '../app/discord.mjs';

async function fixture(run) {
    const dir = await mkdtemp(join(tmpdir(), 'discord-discovery-'));
    const file = async relative => {
        const path = join(dir, relative);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, '#!/bin/sh\nexit 0\n');
        await chmod(path, 0o755);
        return path;
    };
    try { await run(dir, file); } finally { await rm(dir, { recursive: true, force: true }); }
}
test('Windows selects newest stable and finds PTB and Canary executables', async () => fixture(async (dir, file) => {
    await file('Discord/app-1.0.9/Discord.exe');
    const newest = await file('Discord/app-1.0.10/Discord.exe');
    await file('DiscordPTB/app-2.0.1/DiscordPTB.exe');
    await file('DiscordCanary/DiscordCanary.exe');
    const clients = await discoverDiscord({ platform: 'win32', env: { LOCALAPPDATA: dir }, home: dir });
    assert.equal(clients.length, 3);
    assert.equal(clients[0].command, newest);
    assert.equal(clients[1].label, 'Discord PTB');
    assert.equal(clients[2].label, 'Discord Canary');
}));
test('Linux discovers PATH clients and registered Flatpak without a shell', { skip: process.platform === 'win32' }, async () => fixture(async (dir, file) => {
    const native = await file('bin/discord');
    const flatpak = await file('bin/flatpak');
    const options = { platform: 'linux', env: { PATH: join(dir, 'bin') }, home: dir, linuxLocations: [], flatpakPath: flatpak,
        execute: async (command, args) => { assert.equal(command, flatpak); assert.deepEqual(args, ['list', '--app', '--columns=application']); return { stdout: 'com.discordapp.Discord\norg.example.Other\n' }; } };
    const clients = await discoverDiscord(options);
    assert.equal(clients[0].command, native);
    assert.equal(clients[1].key, 'flatpak:com.discordapp.Discord');
    const selected = await resolveDiscord({ discordPath: clients[1].key }, options);
    assert.deepEqual(selected.args, ['run', 'com.discordapp.Discord']);
    assert.equal((await resolveDiscord({ discordPath: '' }, options)).command, native);
}));
test('missing installations report failure; custom executable paths are validated', async () => fixture(async (dir, file) => {
    const options = { platform: 'linux', env: { PATH: '' }, home: dir, linuxLocations: [], flatpakPath: join(dir, 'missing') };
    assert.deepEqual(await discoverDiscord(options), []);
    await assert.rejects(resolveDiscord({ discordPath: '' }, options), /не найден/);
    await assert.rejects(resolveDiscord({ discordPath: join(dir, 'missing') }, options), /не найден/);
    const custom = await file('Custom Client/Discord');
    assert.equal((await resolveDiscord({ discordPath: '"' + custom + '"' }, options)).command, custom);
}));
