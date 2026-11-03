import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, validateSettings } from '../app/config.mjs';
import { desktopQuote, vbsLaunch } from '../app/autostart.mjs';
import { selectQuestRunner } from '../app/quests.mjs';

test('fresh installation is disabled and does not enable autostart', () => {
    assert.equal(defaults.enabled, false);
    assert.equal(defaults.autostart, false);
    assert.deepEqual(validateSettings({}), defaults);
});
test('rejects invalid timing, ports, and process paths', () => {
    for (const settings of [{ port: 80 }, { scanSeconds: 0 }, { stallSeconds: -1 }, { enabled: 'yes' }, { discordPath: 'discord\n--bad' }]) {
        assert.throws(() => validateSettings(settings));
    }
    assert.equal(validateSettings({ unknownToken: 'not-persisted' }).unknownToken, undefined);
});
test('Windows never selects a Linux executable', () => {
    const quest = { appIds: ['1'] };
    const games = [{ id: '1', executables: [{ os: 'linux', name: 'native' }, { os: 'win32', name: 'game.exe' }] }];
    assert.equal(selectQuestRunner(quest, games, 'win32').executable.name, 'game.exe');
    assert.equal(selectQuestRunner(quest, [{ id: '1', executables: [{ os: 'linux', name: 'native' }] }], 'win32'), undefined);
});
test('startup file encoding handles spaces, desktop field codes and quotes', () => {
    assert.equal(desktopQuote('/tmp/user 100%/node'), '"/tmp/user 100%%/node"');
    const vbs = vbsLaunch('"C:\\User Files\\node.exe" "C:\\App\\agent.mjs" --background');
    assert.ok(vbs.includes('shell.Run """C:\\User Files\\node.exe""'));
    assert.ok(vbs.endsWith(', 0, False\r\n'));
});
