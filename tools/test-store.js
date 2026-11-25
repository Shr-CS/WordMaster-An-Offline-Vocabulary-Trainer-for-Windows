'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createStore() {
  const disk = new Map();
  const timers = new Map();
  let failWrites = false;
  let timerId = 0;
  const sandbox = {
    console: { warn() {}, error() {} },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    localStorage: {
      getItem: (key) => disk.get(key) ?? null,
      setItem(key, value) {
        if (failWrites) throw new Error('QuotaExceededError');
        disk.set(key, value);
      },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['util.js', 'store.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js', file), 'utf8'), sandbox);
  }
  sandbox.WM.util.toast = () => {};
  const store = sandbox.WM.store;
  store.load();
  store.flush();
  return {
    store, timers,
    readDisk: () => JSON.parse(disk.get(store.STORAGE_KEY)),
    failWrites: (value) => { failWrites = value; },
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      for (const fn of pending) fn();
    },
  };
}

test('a failed import preserves memory, disk, and subscribers', () => {
  const env = createStore();
  const before = env.store.get();
  const diskBefore = env.readDisk();
  let notifications = 0;
  env.store.subscribe(() => notifications++);
  env.failWrites(true);

  const result = env.store.importJSON(JSON.stringify({ settings: { dailyCount: 80 } }));

  assert.equal(result.ok, false);
  assert.equal(env.store.get(), before);
  assert.deepEqual(env.readDisk(), diskBefore);
  assert.equal(notifications, 0);
});

test('a failed import keeps an earlier pending save', () => {
  const env = createStore();
  env.store.setSettings({ dailyCount: 30 });
  env.failWrites(true);
  assert.equal(env.store.importJSON('{"settings":{"dailyCount":80}}').ok, false);
  assert.equal(env.timers.size, 1);

  env.failWrites(false);
  env.runTimers();
  assert.equal(env.readDisk().settings.dailyCount, 30);
});

test('successful imports are persisted before subscribers run and cancel pending saves', () => {
  const env = createStore();
  env.store.setSettings({ dailyCount: 30 });
  let notifications = 0;
  let observed;
  env.store.subscribe((state) => {
    notifications++;
    observed = [state.settings.dailyCount, env.readDisk().settings.dailyCount];
  });

  const result = env.store.importJSON('{"app":"WordMaster","data":{"settings":{"dailyCount":80}}}');

  assert.equal(result.ok, true);
  assert.equal(env.store.get().settings.dailyCount, 80);
  assert.equal(env.timers.size, 0);
  assert.equal(notifications, 1);
  assert.deepEqual(observed, [80, 80]);
});

test('raw state and exported backups both restore word records', () => {
  const env = createStore();
  const data = { words: { 'junior:hello': { en: 'hello', zh: '你好', correct: 3 } } };
  assert.equal(env.store.importJSON(JSON.stringify(data)).ok, true);
  const backup = env.store.exportJSON();
  const restored = createStore();
  assert.equal(restored.store.importJSON(backup).ok, true);
  assert.equal(restored.readDisk().words['junior:hello'].correct, 3);
});

test('invalid backup containers leave existing state untouched', () => {
  const env = createStore();
  const before = env.store.get();
  for (const text of ['{', 'null', '[]', '{"settings":[]}', '{"words":[]}', '{"settings":"dark"}']) {
    assert.equal(env.store.importJSON(text).ok, false, text);
    assert.equal(env.store.get(), before);
  }
});
