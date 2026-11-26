'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadApp() {
  const context = { console, setTimeout, clearTimeout };
  context.window = context;
  vm.createContext(context);
  for (const file of ['data/words.js', 'js/util.js', 'js/store.js', 'js/bank.js', 'js/quiz.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
  }
  return context.WM;
}

test('old backups keep choice questions and receive a valid group size', () => {
  const { store } = loadApp();
  assert.equal(store.sanitize({ settings: {} }).settings.trainingMode, 'choice');
  assert.equal(store.sanitize({ settings: {} }).settings.sessionSize, 10);
  assert.equal(store.sanitize({ settings: { sessionSize: 0 } }).settings.sessionSize, 0);
  assert.equal(store.sanitize({ settings: { sessionSize: -1 } }).settings.sessionSize, 10);
  assert.equal(store.sanitize({ settings: { trainingMode: 'spelling' } }).settings.trainingMode, 'spelling');
});

test('spelling tolerates casing and typographical variants, but rejects missing letters', () => {
  const { quiz } = loadApp();
  for (const [typed, expected] of [
    ['  HEALTHY  ', 'healthy'], ['ａｐｐｌｅ', 'apple'], ['don’t', "don't"],
    ['mother–in–law', 'mother-in-law'], ['look  after', 'look after'],
  ]) assert.ok(quiz.spellingMatches(typed, expected), typed);
  for (const typed of ['heal', 'health', 'healty', '']) {
    assert.equal(quiz.spellingMatches(typed, 'healthy'), false);
  }
  assert.equal(quiz.spellingMatches('lookafter', 'look after'), false);
});

test('spelling questions hide the answer and choice questions still have four options', () => {
  const { bank, quiz } = loadApp();
  const entry = bank.list('junior')[0];
  const q = quiz.makeQuestion(entry, { trainingMode: 'spelling', pool: bank.all() });
  assert.equal(q.prompt.text, entry.zh);
  assert.equal(q.prompt.sub, entry.pos);
  assert.equal(q.options.length, 0);
  assert.equal(q.direction, 'zh2en');
  assert.equal(quiz.makeQuestion(entry, { pool: bank.all() }).options.length, 4);
});

test('reopening or changing settings keeps completed work and daily limits', () => {
  const { bank, store } = loadApp();
  let state = store.defaultState();
  state.settings.dailyCount = 20;
  const plan = bank.ensurePlan(state);
  const ids = Array.from(plan.newIds);
  for (const id of ids.slice(0, 10)) bank.recordAnswer(state, id, true, 'new', true);
  state = store.sanitize(JSON.parse(JSON.stringify(state)));
  bank.ensurePlan(state, { rebuild: true });
  assert.equal(bank.planProgress(state).newDone, 10);
  assert.equal(bank.planProgress(state).newLeft, 10);
  assert.deepEqual(Array.from(bank.buildQueue(state, 'new'), item => item.id), ids.slice(10));
  for (const item of bank.buildQueue(state, 'new')) bank.recordAnswer(state, item.id, true, 'new', true);
  bank.ensurePlan(state, { rebuild: true });
  assert.equal(bank.buildQueue(state, 'new').length, 0);
  state.settings.dailyCount = 30;
  bank.ensurePlan(state, { rebuild: true });
  assert.equal(bank.buildQueue(state, 'new').length, 10);
});

test('Chinese prompts never include another English answer with the same meaning', () => {
  const { bank, quiz, util } = loadApp();
  const study = bank.get('primary:study');
  const learn = bank.get('primary:learn');
  assert.equal(study.zh, learn.zh);
  const pool = [study, learn, ...bank.list('primary').filter(word => word.zh !== study.zh).slice(0, 3)];
  for (const entry of [study, learn]) {
    for (let seed = 1; seed <= 20; seed++) {
      const q = quiz.makeQuestion(entry, { direction: 'zh2en', pool, random: util.rng(seed) });
      assert.equal(q.options.length, 4);
      assert.equal(q.options.filter(option => bank.get(option.entryId).zh === entry.zh).length, 1);
      assert.equal(q.options[q.answerIndex].entryId, entry.id);
    }
  }
});

test('reopening never replenishes the daily review budget', () => {
  const { bank, store, util } = loadApp();
  const state = store.defaultState();
  state.settings.dailyCount = 20;
  state.settings.reviewLimit = 10;
  const day = bank.today();
  const plan = bank.ensurePlan(state);
  for (const id of plan.newIds) bank.recordAnswer(state, id, true, 'new', true);
  util.dayStr = () => util.addDays(day, 1);
  bank.ensurePlan(state, { rebuild: true });
  for (const item of bank.buildQueue(state, 'review').slice(0, 5)) {
    bank.recordAnswer(state, item.id, true, 'review', true);
  }
  bank.ensurePlan(state, { rebuild: true });
  assert.equal(bank.planProgress(state).reviewDone, 5);
  assert.equal(bank.buildQueue(state, 'review').length, 5);
  for (const item of bank.buildQueue(state, 'review')) bank.recordAnswer(state, item.id, true, 'review', true);
  bank.ensurePlan(state, { rebuild: true });
  assert.equal(bank.buildQueue(state, 'review').length, 0);
  assert.equal(bank.historyOf(state).reviewCount, 10);
});
