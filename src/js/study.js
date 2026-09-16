/* ============================================================================
   study.js — 学习会话控制器
   负责：组卷 → 展示题目 → 判定 → 音效 → 反馈 → 错题重练 → 结算
   键盘：1~4 / A~D 选项，Enter/Space 继续，Esc 退出，S 重听
   ========================================================================== */
'use strict';

window.WM = window.WM || {};

(function (WM) {
  const { h, icon, mount, toast, confirmDialog, clamp } = WM.util;
  const store = WM.store;
  const bank = WM.bank;
  const quiz = WM.quiz;
  const sound = WM.sound;

  /** @type {null | object} */
  let session = null;
  let nextTimer = null;
  let keyHandler = null;

  const isActive = () => !!session;

  function clearTimer() {
    if (nextTimer) {
      clearTimeout(nextTimer);
      nextTimer = null;
    }
  }

  /* ------------------------------- 启动会话 ------------------------------- */

  function start(kind = 'mixed', { silent = false } = {}) {
    const state = store.get();
    const items = bank.buildQueue(state, kind);

    if (!items.length) {
      const msg = kind === 'review'
        ? '今天没有需要复习的单词，明天再来吧'
        : kind === 'new'
          ? '今天的计划已经完成了'
          : '当前范围没有可学的单词，去设置里换个词库吧';
      if (!silent) toast(msg, 'warn', 2800);
      return false;
    }

    const pool = quiz.poolForSession(state);
    const questions = quiz.buildQuestions(items, {
      direction: state.settings.direction,
      pool,
      seed: (Math.random() * 0xffffffff) >>> 0,
    });

    session = {
      kind,
      questions,
      index: -1,
      correct: 0,
      wrong: 0,
      firstWrong: [],
      attempts: {},
      startedAt: Date.now(),
      answered: false,
      current: null,
      finished: false,
    };

    renderShell(); // 必须先建好骨架，renderQuestion 才有容器可用
    attachKeys();
    next();
    return true;
  }

  /* ------------------------------- 视图骨架 ------------------------------- */

  let viewEl = null;
  let topEl = null;
  let cardEl = null;
  let barFill = null;
  let metaLeft = null;
  let metaRight = null;
  let tallyGood = null;
  let tallyBad = null;

  function renderShell() {
    const state = store.get();
    const view = document.getElementById('view');

    barFill = h('i', { style: { width: '0%' } });
    metaLeft = h('span', { text: '' });
    metaRight = h('span', { text: '' });
    tallyGood = h('span', { class: 't-good', text: '✓ 0' });
    tallyBad = h('span', { class: 't-bad', text: '✗ 0' });

    topEl = h('div', { class: 'study-top' },
      h('div', { class: 'progress-wrap' },
        h('div', { class: 'progress-meta' }, metaLeft, metaRight),
        h('div', { class: 'bar' }, barFill)),
      h('div', { class: 'tally' }, tallyGood, tallyBad),
      h('button', {
        class: 'btn ghost sm',
        type: 'button',
        onclick: () => requestExit(),
      }, icon('i-arrow-left'), '退出'));

    cardEl = h('div', { class: 'qcard' });

    viewEl = h('div', { class: 'study narrow' },
      topEl,
      cardEl,
      h('div', { class: 'study-foot' },
        h('div', { class: 'kbd-tip' },
          h('span', { class: 'kbd', text: '1' }), '~', h('span', { class: 'kbd', text: '4' }), ' 选择',
          ' · ', h('span', { class: 'kbd', text: 'Enter' }), ' 继续',
          ' · ', h('span', { class: 'kbd', text: 'S' }), ' 发音',
          ' · ', h('span', { class: 'kbd', text: 'Esc' }), ' 退出'),
        h('div', { class: 'hint', text: describeScope(state) })));

    mount(view, viewEl);
  }

  function describeScope(state) {
    const names = state.settings.levels.map((id) => bank.levelMeta(id).name);
    const dirText = { en2zh: '英译中', zh2en: '中译英', mixed: '英中混合' }[state.settings.direction] || '混合';
    return `范围：${names.length ? names.join(' / ') : '全部'} · 方向：${dirText}`;
  }

  function syncTop() {
    if (!session) return;
    const total = session.questions.length;
    const done = session.index;
    if (metaLeft) metaLeft.textContent = `第 ${clamp(session.index + 1, 1, total)} / ${total} 题`;
    if (metaRight) metaRight.textContent = `${session.correct} 对 · ${session.wrong} 错`;
    if (barFill) barFill.style.width = `${total ? (done / total) * 100 : 0}%`;
    if (tallyGood) tallyGood.textContent = `✓ ${session.correct}`;
    if (tallyBad) tallyBad.textContent = `✗ ${session.wrong}`;
  }

  /* ------------------------------- 展示题目 ------------------------------- */

  function next() {
    clearTimer();
    if (!session) return;
    session.index += 1;
    if (session.index >= session.questions.length) {
      finish();
      return;
    }
    session.current = session.questions[session.index];
    session.answered = false;
    renderQuestion();
    syncTop();
  }

  function renderQuestion() {
    const state = store.get();
    const q = session.current;
    const attempt = session.attempts[q.id] || 0;
    const level = bank.levelMeta(q.entry.level);

    const isEn = q.direction === 'en2zh';

    const metas = [
      q.mode === 'review'
        ? h('span', { class: 'tag review' }, icon('i-review'), '复习')
        : h('span', { class: 'tag new' }, icon('i-bolt'), '新词'),
      h('span', { class: 'tag' },
        h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: level.color, display: 'inline-block' } }),
        level.name),
    ];
    if (attempt > 0) metas.push(h('span', { class: 'tag err' }, icon('i-review'), `第 ${attempt + 1} 次作答`));
    if (q.entry.starred) metas.push(h('span', { class: 'tag' }, icon('i-star'), '生词'));

    const speakBtn = h('button', {
      class: 'speak-btn',
      type: 'button',
      title: '朗读单词（S）',
      onclick: (e) => {
        e.stopPropagation();
        speakCurrent();
      },
    }, icon('i-speaker'));

    const prompt = h('div', { class: 'q-prompt' },
      h('div', { class: 'q-label', text: q.prompt.label }),
      h('div', { class: `q-word ${isEn ? '' : 'zh'}`, text: q.prompt.text }),
      h('div', { class: 'q-sub' },
        q.prompt.sub ? h('span', { class: 'q-ipa', text: q.prompt.sub }) : null,
        speakBtn));

    const opts = h('div', { class: 'opts' });
    q.options.forEach((opt, i) => {
      opts.appendChild(h('button', {
        class: `opt${isEn ? '' : ' zh-opt'}`,
        type: 'button',
        dataset: { index: String(i) },
        style: { animationDelay: `${i * 45}ms` },
        onclick: () => answer(i),
      },
        h('span', { class: 'key', text: String(i + 1) }),
        h('span', { class: `txt ${isEn ? 'zh' : 'en'}`, text: opt.text }),
        h('span', { class: 'mark' }, icon('i-check'))));
    });

    mount(cardEl, h('div', { class: 'q-meta' }, metas), prompt, opts);

    // 英文题面出现时自动朗读
    if (isEn && state.settings.autoPronounce) {
      setTimeout(() => {
        if (session && session.current === q && !session.answered) speakCurrent();
      }, 120);
    }
  }

  function speakCurrent() {
    if (!session || !session.current) return;
    sound.speak(session.current.entry.en);
  }

  /* ------------------------------- 判定与反馈 ------------------------------- */

  function answer(index) {
    if (!session || session.answered) return;
    const q = session.current;
    const state = store.get();
    const ok = index === q.answerIndex;
    const isRetry = (session.attempts[q.id] || 0) > 0;

    session.answered = true;
    session.attempts[q.id] = (session.attempts[q.id] || 0) + 1;

    // 1) 音效：答对/答错各有专属音色
    if (ok) sound.correct();
    else sound.wrong();

    // 2) 结算：只有「今天第一次作答」才推进复习计划
    bank.recordAnswer(state, q.id, ok, q.mode, !isRetry);

    if (ok) {
      session.correct += 1;
    } else {
      session.wrong += 1;
      if (!isRetry) session.firstWrong.push(q.entry);
    }

    // 3) 选项视觉反馈
    Array.from(cardEl.querySelectorAll('.opt')).forEach((node, i) => {
      node.classList.add('locked');
      if (i === q.answerIndex) node.classList.add('correct');
      else if (i === index) node.classList.add('wrong');
      else node.classList.add('dim');
      const mark = node.querySelector('.mark');
      if (mark) {
        mark.replaceChildren(icon(i === q.answerIndex ? 'i-check' : 'i-close'));
      }
    });

    // 4) 反馈条
    cardEl.appendChild(buildFeedback(ok, q, isRetry));

    // 5) 首次答错 → 追加到队尾重练（只重练一次）
    if (!ok && !isRetry) {
      const again = quiz.makeQuestion(q.entry, {
        direction: state.settings.direction,
        pool: quiz.poolForSession(state),
        random: Math.random,
        mode: q.mode,
      });
      session.questions.push(again);
    }

    // 6) 中译英答完后朗读，帮助建立音形义联系
    if (q.direction === 'zh2en' && state.settings.autoPronounce) {
      setTimeout(() => sound.speak(q.entry.en), 220);
    }

    syncTop();

    // 7) 答对自动进入下一题；答错停下来看清楚
    if (ok && state.settings.autoNext) {
      const base = state.settings.autoNextDelay || 1100;
      // 展开详细词条时留更长时间——卡片上有例句和翻译两行要读
      const delay = state.settings.showDetail ? Math.max(base, 3200) : base;
      scheduleNext(delay);
    }
  }

  /**
   * 答对后的「详细词条卡」。
   *
   * 只在设置里打开 showDetail 且**答对**时用它。答错时不展开：
   * 那时用户更需要尽快看清正确答案，一屏信息反而碍事。
   */
  function buildDetailCard(q) {
    const entry = q.entry;
    const level = bank.levelMeta(entry.level);
    const state = store.get();
    const record = state.words[entry.id] || null;

    const reviewText = record
      ? `复习等级 ${(record.box || 0) + 1} · 下次复习 ${record.nextReview} · 累计对 ${record.correct} / 错 ${record.wrong}`
      : '首次学习 · 明天进入复习';

    const speakBtn = (text, title, cls = 'speak-btn') => h('button', {
      class: cls,
      type: 'button',
      title,
      onclick: (e) => {
        e.stopPropagation();
        sound.speak(text);
      },
    }, icon('i-speaker'));

    return h('div', { class: 'feedback ok detail' },
      h('div', { class: 'detail-head' },
        h('div', { class: 'detail-word' },
          h('span', { class: 'dw-en', text: entry.en }),
          entry.ipa ? h('span', { class: 'dw-ipa', text: entry.ipa }) : null,
          entry.pos ? h('span', { class: 'dw-pos', text: entry.pos }) : null,
          speakBtn(entry.en, '朗读单词')),
        h('div', { class: 'detail-zh', text: entry.zh })),

      entry.ex
        ? h('div', { class: 'detail-ex' },
          h('div', { class: 'ex-en' },
            h('span', { text: entry.ex }),
            speakBtn(entry.ex, '朗读例句', 'speak-btn sm')),
          entry.exZh ? h('div', { class: 'ex-zh', text: entry.exZh }) : null)
        : null,

      h('div', { class: 'detail-foot' },
        h('span', { class: 'tag ok-tag' }, icon('i-check'), '答对了'),
        h('span', { class: 'tag' },
          h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: level.color, display: 'inline-block' } }),
          level.name),
        h('span', { class: 'detail-review', text: reviewText }),
        h('button', {
          class: 'btn primary sm',
          type: 'button',
          onclick: () => next(),
        }, '继续')));
  }

  function buildFeedback(ok, q, isRetry) {
    // 答对 + 开关打开 → 用详细词条卡（其余情况走下面的精简反馈条）
    if (ok && store.get().settings.showDetail) return buildDetailCard(q);

    const entry = q.entry;
    const level = bank.levelMeta(entry.level);
    const isEn = q.direction === 'en2zh';

    const detail = isEn
      ? `${entry.en} ${entry.ipa} · ${entry.pos}`.trim()
      : `${entry.zh} · ${entry.pos} · ${entry.ipa}`.trim();

    const title = ok
      ? (isRetry ? '这次记住了！' : '答对了！')
      : `答错了，正确答案是「${isEn ? entry.zh : entry.en}」`;

    return h('div', { class: `feedback ${ok ? 'ok' : 'no'}` },
      h('div', { class: 'fb-ico' }, icon(ok ? 'i-check' : 'i-close')),
      h('div', { class: 'fb-body' },
        h('div', { class: 'fb-title', text: title }),
        h('div', { class: 'fb-detail' }, detail, ` 　·　${level.name}`),
        !ok ? h('div', { class: 'fb-detail', text: '已加入队尾，稍后会再考你一次' }) : null),
      h('button', {
        class: 'speak-btn',
        type: 'button',
        title: '朗读',
        onclick: (e) => {
          e.stopPropagation();
          sound.speak(entry.en);
        },
      }, icon('i-speaker')),
      h('button', {
        class: 'btn primary sm',
        type: 'button',
        onclick: () => next(),
      }, '继续'));
  }

  function scheduleNext(ms) {
    clearTimer();
    nextTimer = setTimeout(() => {
      nextTimer = null;
      if (session && session.answered) next();
    }, Math.max(200, ms));
  }

  /* ------------------------------- 结算页 ------------------------------- */

  function finish() {
    clearTimer();
    const state = store.get();
    const s = session;
    const elapsed = Math.round((Date.now() - s.startedAt) / 1000);
    bank.addStudySeconds(state, elapsed);
    store.flush();

    const answered = s.correct + s.wrong;
    const rate = answered ? Math.round((s.correct / answered) * 100) : 0;
    const perfect = s.wrong === 0 && answered > 0;

    if (perfect) sound.perfect();
    else sound.finish();

    const tomorrow = WM.util.addDays(bank.today(), 1);
    const tomorrowDue = Object.values(state.words).filter((w) => !w.mastered && w.nextReview === tomorrow).length;

    const view = document.getElementById('view');
    const stats = h('div', { class: 'grid c4' },
      statBlock('i-check', '答对', String(s.correct), 'good'),
      statBlock('i-close', '答错', String(s.wrong), s.wrong ? 'warn' : ''),
      statBlock('i-target', '正确率', `${rate}%`, 'accent'),
      statBlock('i-bolt', '用时', WM.util.formatDuration(elapsed), ''));

    const errCard = s.firstWrong.length
      ? h('div', { class: 'card' },
        h('div', { class: 'card-title' }, icon('i-review'), `需要再巩固的单词 · ${s.firstWrong.length} 个`),
        h('div', { class: 'err-list' }, s.firstWrong.map((entry) => h('div', { class: 'err-item' },
          h('span', { class: 'w', text: entry.en }),
          h('span', { class: 'm', text: entry.zh }),
          h('span', { class: 'lv', text: `${entry.pos} ${bank.levelMeta(entry.level).name}` }),
          h('button', {
            class: 'mini-btn',
            type: 'button',
            title: '朗读',
            onclick: () => sound.speak(entry.en),
          }, icon('i-speaker'))))))
      : null;

    const summary = h('div', { class: 'summary' },
      h('div', { class: 'summary-hero' },
        h('div', { class: 'badge' }, icon(perfect ? 'i-star' : 'i-check')),
        h('h2', { text: perfect ? '全对，太强了！' : '本组完成！' }),
        h('p', { text: `共 ${answered} 题 · 正确率 ${rate}% · 用时 ${WM.util.formatDuration(elapsed)}` })),
      stats,
      errCard,
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, icon('i-review'), '接下来的复习安排'),
        h('div', { class: 'kv' },
          kvItem('今天已完成', `新词 ${bank.historyOf(state).newCount} · 复习 ${bank.historyOf(state).reviewCount}`),
          kvItem('明天需要复习', `${tomorrowDue} 个单词`),
          kvItem('累计已学', `${bank.learnedCount(state)} 个单词`),
          kvItem('已掌握', `${bank.masteredCount(state)} 个单词`))),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn primary lg',
          type: 'button',
          onclick: () => {
            destroy();
            WM.app.resume();
          },
        }, icon('i-play'), '再来一组'),
        h('button', {
          class: 'btn lg',
          type: 'button',
          onclick: () => {
            destroy();
            WM.app.go('home');
          },
        }, icon('i-home'), '返回首页')));

    session = null;
    detachKeys();
    mount(view, summary);
    WM.app.refreshChrome();
  }

  function statBlock(iconName, label, value, tone) {
    return h('div', { class: `stat ${tone || ''}` },
      h('div', { class: 'stat-label' }, icon(iconName), label),
      h('div', { class: 'stat-value', text: value }));
  }

  function kvItem(key, value) {
    return h('div', { class: 'kv-item' }, h('span', { class: 'k', text: key }), h('span', { class: 'v', text: value }));
  }

  /* ------------------------------- 退出 ------------------------------- */

  async function requestExit() {
    if (!session || session.finished) {
      destroy();
      WM.app.go('home');
      return;
    }
    const answered = session.correct + session.wrong;
    const ok = await confirmDialog({
      title: '退出本次学习？',
      message: answered ? `本次已作答 ${answered} 题，成绩已经保存，复习计划也已更新。` : '还没有开始答题，退出不会影响任何记录。',
      okText: '退出学习',
      cancelText: '继续学习',
      danger: true,
    });
    if (ok) {
      bank.addStudySeconds(store.get(), (Date.now() - session.startedAt) / 1000);
      store.flush();
      destroy();
      WM.app.go('home');
    }
  }

  function destroy() {
    clearTimer();
    detachKeys();
    sound.stopSpeak();
    session = null;
    viewEl = null;
    topEl = null;
    cardEl = null;
    barFill = null;
    metaLeft = null;
    metaRight = null;
    tallyGood = null;
    tallyBad = null;
  }

  /* ------------------------------- 键盘 ------------------------------- */

  function attachKeys() {
    detachKeys();
    keyHandler = (event) => {
      if (!session) return;
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      const key = event.key;

      if (key === 'Escape') {
        event.preventDefault();
        requestExit();
        return;
      }

      if (key === 'Enter' || key === ' ') {
        if (session.answered) {
          event.preventDefault();
          next();
        } else {
          event.preventDefault();
        }
        return;
      }

      if (key === 's' || key === 'S') {
        event.preventDefault();
        speakCurrent();
        return;
      }

      if (session.answered) return;

      const num = '1234'.indexOf(key);
      if (num >= 0) {
        event.preventDefault();
        if (num < session.current.options.length) answer(num);
        return;
      }
      const letter = 'abcd'.indexOf(key.toLowerCase());
      if (letter >= 0) {
        event.preventDefault();
        if (letter < session.current.options.length) answer(letter);
      }
    };
    document.addEventListener('keydown', keyHandler, true);
  }

  function detachKeys() {
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler, true);
      keyHandler = null;
    }
  }

  /* ------------------------------- 对外接口 ------------------------------- */

  function renderInto() {
    renderShell();
    if (session) {
      renderQuestion();
      syncTop();
    }
  }

  WM.study = {
    start,
    destroy,
    isActive,
    renderInto,
    get session() { return session; },
  };
})(window.WM);
