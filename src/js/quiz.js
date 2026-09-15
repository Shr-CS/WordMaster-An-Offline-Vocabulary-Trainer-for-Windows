/* ============================================================================
   quiz.js — 选择题生成
   支持两个方向：
     en2zh  看英文选中文
     zh2en  看中文选英文
   干扰项优先取「同等级 + 同词性」的词，再逐级放宽，保证选项看起来都在同一难度档。
   ========================================================================== */
'use strict';

window.WM = window.WM || {};

(function (WM) {
  const util = WM.util;
  const bank = WM.bank;

  const OPTION_COUNT = 4;

  /** 取用于比对的值：en2zh 比中文，zh2en 比英文 */
  const valueOf = (entry, direction) => (direction === 'en2zh' ? entry.zh : entry.en);

  /**
   * 挑 3 个干扰项。
   * 逐级放宽候选池，任一选项的「文字」都不允许与已选选项重复（归一化后比较）。
   */
  function pickDistractors(entry, direction, random, pool) {
    const correct = util.norm(valueOf(entry, direction));
    const used = new Set([correct]);
    const chosen = [];

    const sameLevelPos = [];
    const sameLevel = [];
    const others = [];

    for (const cand of pool) {
      if (cand.id === entry.id) continue;
      if (cand.level === entry.level && cand.pos && cand.pos === entry.pos) sameLevelPos.push(cand);
      else if (cand.level === entry.level) sameLevel.push(cand);
      else others.push(cand);
    }

    for (const tier of [sameLevelPos, sameLevel, others]) {
      if (chosen.length >= OPTION_COUNT - 1) break;
      for (const cand of util.shuffle(tier, random)) {
        if (chosen.length >= OPTION_COUNT - 1) break;
        const value = valueOf(cand, direction);
        const key = util.norm(value);
        if (!key || used.has(key)) continue;
        // 中文题干时，干扰项英文不能是题干的答案本身
        if (direction === 'zh2en' && util.norm(cand.en) === util.norm(valueOf(entry, 'zh2en'))) continue;
        used.add(key);
        chosen.push(cand);
      }
    }
    return chosen;
  }

  /**
   * 生成一道题。
   * @param {object} entry    目标词条
   * @param {object} options
   * @param {string} options.direction 'en2zh' | 'zh2en' | 'mixed'
   * @param {Array}  options.pool      干扰项候选池
   * @param {Function} options.random  可复现随机源
   * @param {string} options.mode      'new' | 'review'
   */
  function makeQuestion(entry, { direction = 'mixed', pool = [], random = Math.random, mode = 'new' } = {}) {
    const dir = direction === 'mixed' ? (random() < 0.5 ? 'en2zh' : 'zh2en') : direction;
    const distractors = pickDistractors(entry, dir, random, pool);

    const options = [entry, ...distractors].map((cand) => ({
      entryId: cand.id,
      text: valueOf(cand, dir),
      ok: cand.id === entry.id,
    }));

    const shuffled = util.shuffle(options, random);
    const answerIndex = shuffled.findIndex((o) => o.ok);

    const prompt = dir === 'en2zh'
      ? { text: entry.en, lang: 'en', sub: entry.ipa || '', label: '选出正确的中文释义' }
      : { text: entry.zh, lang: 'zh', sub: entry.pos || '', label: '选出正确的英文单词' };

    return {
      id: entry.id,
      entry,
      direction: dir,
      mode,
      prompt,
      options: shuffled,
      answerIndex,
    };
  }

  /**
   * 由「单词队列」生成题目队列。
   * @param {Array<{id:string, mode:string}>} items
   * @param {object} config { direction, pool, seed }
   */
  function buildQuestions(items, { direction = 'mixed', pool = [], seed = Date.now() } = {}) {
    const random = util.rng(seed >>> 0);
    const questions = [];
    for (const item of items) {
      const entry = bank.get(item.id);
      if (!entry) continue;
      questions.push(makeQuestion(entry, { direction, pool, random, mode: item.mode || 'new' }));
    }
    return questions;
  }

  /**
   * 为一次学习会话准备干扰项池。
   * 优先用所选等级的词；若所选范围太小，则并入全库，确保永远凑得出 4 个选项。
   */
  function poolForSession(state) {
    const selected = bank.poolFor(state.settings.levels);
    if (selected.length >= OPTION_COUNT * 12) return selected;
    const merged = new Map();
    for (const entry of selected) merged.set(entry.id, entry);
    for (const entry of bank.all()) merged.set(entry.id, entry);
    return Array.from(merged.values());
  }

  WM.quiz = {
    OPTION_COUNT,
    makeQuestion,
    buildQuestions,
    poolForSession,
  };
})(window.WM);
