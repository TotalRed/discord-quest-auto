import test from 'node:test';
import assert from 'node:assert/strict';
import { executableParts, pendingQuests, selectQuestRunner } from '../app/quests.mjs';

const now = Date.parse('2026-11-03T00:00:00Z');
const quest = () => ({ id: '123', config: {
    application: { id: '456', name: 'Game' }, expires_at: '2026-11-04T00:00:00Z',
    task_config: { tasks: { PLAY_ON_DESKTOP: { target: 900 } } },
}, user_status: { enrolled_at: '2026-11-02', progress: { PLAY_ON_DESKTOP: { value: 60 } } } });

test('normalizes API progress and enrollment', () => {
    const [q] = pendingQuests({ quests: [quest()] }, now);
    assert.equal(q.progress, 60);
    assert.equal(q.target, 900);
    assert.equal(q.enrolled, true);
});

test('never queues expired, completed, malformed, or multi-task quests', () => {
    const expired = quest(); expired.config.expires_at = '2026-11-02';
    const completed = quest(); completed.user_status.completed_at = '2026-11-02';
    const multi = quest(); multi.config.task_config.tasks.STREAM_ON_DESKTOP = { target: 900 };
    const invalid = quest(); invalid.config.task_config.tasks.PLAY_ON_DESKTOP.target = -1;
    const video = quest(); video.config.task_config.tasks = { WATCH_VIDEO: { target: 30 } };
    assert.deepEqual(pendingQuests({ quests: [expired, completed, multi, invalid, video] }, now), []);
    assert.throws(() => pendingQuests({}, now));
});

test('accepts PC as an alternative to console tasks with OR, rejects AND', () => {
    const q = quest();
    q.config.task_config.tasks.PLAY_ON_XBOX = { target: 900 };
    q.config.task_config.join_operator = 'or';
    assert.equal(pendingQuests({ quests: [q] }, now).length, 1);
    q.config.task_config.join_operator = 'and';
    assert.equal(pendingQuests({ quests: [q] }, now).length, 0);
});

test('uses V2 config and task application when legacy config is also present', () => {
    const q = quest();
    q.config.task_config_v2 = { tasks: { PLAY_ON_DESKTOP: { target: 1200, applications: [{ id: '789' }] } } };
    const [result] = pendingQuests({ quests: [q] }, now);
    assert.equal(result.target, 1200);
    assert.equal(result.appId, '789');
});

test('selects an eligible alternative when the primary game has no runner', () => {
    const q = quest();
    q.config.task_config.tasks.PLAY_ON_DESKTOP.applications = [{ id: '111' }, { id: '222' }, { id: '333' }];
    const [normalized] = pendingQuests({ quests: [q] }, now);
    assert.deepEqual(normalized.appIds, ['111', '222', '333']);
    const games = [
        { id: '222', name: 'Windows alternative', executables: [{ os: 'win32', name: 'game.exe' }] },
        { id: '333', name: 'Linux alternative', executables: [{ os: 'linux', name: 'bin/game' }] },
    ];
    assert.equal(selectQuestRunner(normalized, games, 'linux').appId, '333');
    assert.equal(selectQuestRunner(normalized, games.slice(0, 1), 'linux').appId, '222');
    assert.equal(selectQuestRunner(normalized, [], 'linux'), undefined);
});

test('never selects games outside the eligible list or unsafe paths', () => {
    const q = { appIds: ['111'] };
    assert.equal(selectQuestRunner(q, [
        { id: '111', executables: [{ os: 'linux', name: '../game' }] },
        { id: '222', executables: [{ os: 'linux', name: 'game' }] },
    ]), undefined);
});

test('splits Windows and Unix paths and rejects escaping the game directory', () => {
    assert.deepEqual(executableParts('Game\\bin\\Game.exe'), ['Game', 'bin', 'Game.exe']);
    assert.deepEqual(executableParts('bin/game'), ['bin', 'game']);
    for (const value of ['../game', '/tmp/game', 'C:\\game.exe', 'foo/../../game', 'foo\u0000bar', '']) {
        assert.throws(() => executableParts(value));
    }
});
