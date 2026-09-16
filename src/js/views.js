/* ============================================================================
   views.js — 各页面渲染：首页、生词本、数据统计、设置
   ========================================================================== */
'use strict';

window.WM = window.WM || {};

(function (WM) {
  const { h, icon, mount, toast, confirmDialog, clamp, pct, prettyDay, weekdayOf, formatDuration, dayStr, addDays } = WM.util;
  const store = WM.store;
  const bank = WM.bank;
  const sound = WM.sound;

  /* ======================================================================
     公共小组件
     ====================================================================== */

  function statBlock(iconName, label, value, unit, tone) {
    return h('div', { class: `stat ${tone || ''}` },
      h('div', { class: 'stat-label' }, icon(iconName), label),
      h('div', { class: 'stat-value' }, String(value), unit ? h('small', { text: unit }) : null));
  }

  function kvItem(key, value) {
    return h('div', { class: 'kv-item' }, h('span', { class: 'k', text: key }), h('span', { class: 'v', text: value }));
  }

  function progressRing(percent, big, small) {
    const r = 52;
    const c = 2 * Math.PI * r;
    const value = clamp(percent, 0, 100);
    const offset = c * (1 - value / 100);

    const NS = WM.util.SVGNS;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 116 116');
    svg.setAttribute('width', '116');
    svg.setAttribute('height', '116');

    const defs = document.createElementNS(NS, 'defs');
    const grad = document.createElementNS(NS, 'linearGradient');
    grad.setAttribute('id', 'ringGrad');
    grad.setAttribute('x1', '0');
    grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '1');
    grad.setAttribute('y2', '1');
    const stops = [
      { offset: '0%', color: 'var(--accent)' },
      { offset: '100%', color: 'var(--accent-2)' },
    ];
    for (const s of stops) {
      const stop = document.createElementNS(NS, 'stop');
      stop.setAttribute('offset', s.offset);
      stop.setAttribute('stop-color', s.color);
      grad.appendChild(stop);
    }
    defs.appendChild(grad);
    svg.appendChild(defs);

    const track = document.createElementNS(NS, 'circle');
    track.setAttribute('class', 'track');
    track.setAttribute('cx', '58');
    track.setAttribute('cy', '58');
    track.setAttribute('r', String(r));
    svg.appendChild(track);

    const fill = document.createElementNS(NS, 'circle');
    fill.setAttribute('class', 'fill');
    fill.setAttribute('cx', '58');
    fill.setAttribute('cy', '58');
    fill.setAttribute('r', String(r));
    fill.setAttribute('stroke-dasharray', String(c));
    fill.setAttribute('stroke-dashoffset', String(c));
    svg.appendChild(fill);
    requestAnimationFrame(() => {
      fill.setAttribute('stroke-dashoffset', String(offset));
    });

    return h('div', { class: 'ring' }, svg,
      h('div', { class: 'ring-label' }, h('b', { text: big }), h('span', { text: small })));
  }

  function emptyState(iconName, title, desc, action) {
    return h('div', { class: 'empty' }, icon(iconName), h('b', { text: title }), h('p', { text: desc }), action || null);
  }

  function pageHead(title, desc, right) {
    return h('div', { class: 'page-head' },
      h('div', {}, h('h1', { text: title }), desc ? h('p', { text: desc }) : null),
      right || null);
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 5) return '夜深了，别熬太晚';
    if (hour < 11) return '早上好，今天也要加油';
    if (hour < 14) return '中午好，来记几个单词吧';
    if (hour < 18) return '下午好，保持节奏';
    return '晚上好，睡前复习效果更好';
  }

  function todayLabel() {
    const d = new Date();
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekdayOf(dayStr(d))}`;
  }

  /* ======================================================================
     修改设置（统一入口）
     ====================================================================== */

  function applySettings(patch) {
    const state = store.get();
    const before = { ...state.settings };
    store.setSettings(patch);

    if ('levels' in patch || 'dailyCount' in patch || 'reviewLimit' in patch) {
      bank.ensurePlan(store.get(), { rebuild: true });
    }
    if ('theme' in patch) WM.app.setTheme(store.get().settings.theme);
    if ('sound' in patch) sound.setEnabled(store.get().settings.sound);
    if ('volume' in patch) sound.setVolume(store.get().settings.volume);

    store.save();
    WM.app.refreshChrome();

    // 范围变小导致今天没题可做时给出提示
    if (('levels' in patch || 'dailyCount' in patch) && before.levels.join() !== state.settings.levels.join()) {
      const prog = bank.planProgress(store.get());
      if (prog.totalLeft === 0) toast('已更新范围，但当前没有可学的单词', 'warn', 2600);
    }
  }

  /* ======================================================================
     首页
     ====================================================================== */

  function renderHome(view) {
    const state = store.get();
    const prog = bank.planProgress(state);
    const streak = state.streak || { current: 0, best: 0 };
    const todayHist = bank.historyOf(state);
    const doneToday = prog.newDone + prog.reviewDone;
    const plannedToday = prog.newTotal + prog.reviewTotal;
    const percent = plannedToday ? pct(doneToday, plannedToday) : 0;

    if (!bank.dataReady()) {
      mount(view, pageHead('首页', '词库数据缺失'), emptyState('i-bolt', '还没有加载词库', '请先运行 npm run build:data 生成词库，或检查 src/data 目录。'));
      return;
    }

    /* ---------- 主视觉 ---------- */
    const hero = h('div', { class: 'hero' },
      h('h1', { text: greeting() }),
      h('div', { class: 'sub' }, todayLabel(),
        h('span', { text: ' · ' }),
        streak.current > 0
          ? h('span', {}, '已连续打卡 ', h('b', { text: String(streak.current) }), ' 天')
          : h('span', { text: '今天开始你的第一个打卡日' })),

      h('div', { class: 'today-line' }, icon('i-target'),
        '今日计划：新词 ', h('b', { text: String(prog.newTotal) }), ' 个 · 复习 ', h('b', { text: String(prog.reviewTotal) }), ' 个'),

      h('div', { class: 'plan-cards' },
        planCard({
          kind: 'new',
          iconName: 'i-bolt',
          label: '今日新词',
          left: prog.newLeft,
          total: prog.newTotal,
          hint: prog.newLeft ? `还有 ${prog.newLeft} 个没学` : (prog.newTotal ? '今天的新词已完成' : '暂无新词'),
        }),
        planCard({
          kind: 'review',
          iconName: 'i-review',
          label: '今日复习',
          left: prog.reviewLeft,
          total: prog.reviewTotal,
          hint: prog.reviewLeft ? `还有 ${prog.reviewLeft} 个待复习` : (prog.reviewTotal ? '复习任务已清空' : '今天没有到期的单词'),
        })),

      h('div', { class: 'btn-row', style: { marginTop: '20px' } },
        h('button', {
          class: 'btn primary lg',
          type: 'button',
          disabled: prog.totalLeft === 0,
          onclick: () => WM.app.startStudy('mixed'),
        }, icon('i-play'), prog.totalLeft ? `开始今日学习（${prog.totalLeft} 题）` : '今日任务已完成'),
        h('button', {
          class: 'btn lg',
          type: 'button',
          disabled: prog.newLeft === 0,
          onclick: () => WM.app.startStudy('new'),
        }, icon('i-bolt'), '只学新词'),
        h('button', {
          class: 'btn lg',
          type: 'button',
          disabled: prog.reviewLeft === 0,
          onclick: () => WM.app.startStudy('review'),
        }, icon('i-review'), '只做复习')));

    /* ---------- 今日概览 ---------- */
    const overview = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('i-target'), '今日概览'),
      h('div', { class: 'ring-wrap' },
        progressRing(percent, `${percent}%`, '今日完成'),
        h('div', { class: 'kv', style: { flex: '1' } },
          kvItem('今日作答', `${todayHist.correct + todayHist.wrong} 题`),
          kvItem('正确 / 错误', `${todayHist.correct} / ${todayHist.wrong}`),
          kvItem('学习时长', formatDuration(todayHist.seconds)),
          kvItem('连续打卡', `${streak.current} 天`),
          kvItem('历史最佳', `${Math.max(streak.best, streak.current)} 天`))));

    /* ---------- 复习预告 ---------- */
    const tomorrow = addDays(dayStr(), 1);
    const tomorrowDue = Object.values(state.words).filter((w) => !w.mastered && w.nextReview === tomorrow).length;
    const overdue = bank.dueRecords(state).length;

    const upcomingCard = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('i-review'), '复习安排'),
      h('div', { class: 'kv' },
        kvItem('已到期未复习', `${overdue} 个`),
        kvItem('明天需要复习', `${tomorrowDue} 个`),
        kvItem('复习中', `${bank.learnedCount(state) - bank.masteredCount(state)} 个`),
        kvItem('已掌握', `${bank.masteredCount(state)} 个`)),
      h('p', { class: 'hint', style: { marginTop: '14px' }, text: '规则：今天学的新词明天必复习；复习答对间隔加倍（1→2→4→7→15→30 天），答错则退回明天重来。' }));

    /* ---------- 词库进度 ---------- */
    const levelLines = bank.levelProgress(state).map((lv) => h('div', { class: 'level-line' },
      h('div', { class: 'll-top' },
        h('span', { class: 'name' },
          h('span', { class: 'dot', style: { background: lv.color } }),
          lv.name,
          state.settings.levels.includes(lv.id) ? h('span', { class: 'chip on', text: '在范围内' }) : null),
        h('span', { class: 'num', text: `${lv.learned} / ${lv.total}` })),
      h('div', { class: 'bar thin' }, h('i', { style: { width: `${lv.percent}%` } }))));

    const scopeCard = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('i-book'), '词库进度'),
      h('div', { class: 'level-list' }, levelLines));

    mount(view,
      pageHead('首页', `词库共 ${bank.totalWords()} 个单词`),
      hero,
      h('div', { class: 'grid side' }, scopeCard, h('div', { class: 'grid', style: { gap: '16px' } }, overview, upcomingCard)));
  }

  function planCard({ kind, iconName, label, left, total, hint }) {
    const done = total > 0 && left === 0;
    return h('button', {
      class: `plan-card ${kind} ${done ? 'done' : ''}`,
      type: 'button',
      disabled: left === 0,
      onclick: () => WM.app.startStudy(kind),
    },
      h('div', { class: 'pc-top' }, icon(iconName), label,
        done ? h('span', { class: 'tag', style: { marginLeft: 'auto' } }, icon('i-check'), '已完成') : null),
      h('div', { class: 'pc-num' }, String(left), h('small', { text: ` / ${total} 待完成` })),
      h('div', { class: 'pc-foot', text: hint }));
  }

  /* ======================================================================
     生词本
     ====================================================================== */

  let wbFilter = 'all';
  let wbQuery = '';
  let wbLimit = 200;

  function renderWordbook(view) {
    const state = store.get();
    const records = Object.values(state.words);

    if (!records.length) {
      mount(view, pageHead('生词本', '这里会记录你学过的每一个单词'),
        emptyState('i-book', '还没有学过的单词', '先去首页开始今天的学习，学过的词会自动进入生词本，并按遗忘曲线提醒你复习。',
          h('button', { class: 'btn primary', type: 'button', onclick: () => WM.app.go('home') }, icon('i-play'), '去学习')));
      return;
    }

    const filters = [
      { id: 'all', name: '全部' },
      { id: 'due', name: '待复习' },
      { id: 'wrong', name: '易错' },
      { id: 'star', name: '已标记' },
      { id: 'mastered', name: '已掌握' },
    ];

    let rows = records.slice();
    if (wbFilter === 'due') rows = rows.filter((r) => bank.isDue(r));
    else if (wbFilter === 'wrong') rows = rows.filter((r) => r.wrong > 0).sort((a, b) => b.wrong - a.wrong);
    else if (wbFilter === 'star') rows = rows.filter((r) => r.starred);
    else if (wbFilter === 'mastered') rows = rows.filter((r) => r.mastered);
    if (wbFilter !== 'wrong') rows.sort((a, b) => (a.learnedAt < b.learnedAt ? 1 : a.learnedAt > b.learnedAt ? -1 : 0));

    const q = wbQuery.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.en.toLowerCase().includes(q) || r.zh.includes(wbQuery.trim()));

    const visible = rows.slice(0, wbLimit);

    const search = h('input', {
      class: 'input',
      type: 'search',
      placeholder: '搜索英文或中文释义…',
      value: wbQuery,
      oninput: (e) => {
        wbQuery = e.target.value;
        wbLimit = 200;
        renderWordbook(view);
      },
    });

    const segmented = h('div', { class: 'segmented' }, filters.map((f) => h('button', {
      class: wbFilter === f.id ? 'on' : '',
      type: 'button',
      onclick: () => {
        wbFilter = f.id;
        wbLimit = 200;
        renderWordbook(view);
      },
    }, f.name)));

    const toolbar = h('div', { class: 'wb-toolbar' },
      segmented,
      h('div', { class: 'search-wrap' }, icon('i-search'), search),
      h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '10px' } },
        h('span', { class: 'hint', style: { alignSelf: 'center' }, text: `共 ${rows.length} 个` }),
        h('button', {
          class: 'btn sm',
          type: 'button',
          onclick: () => WM.app.speakRandomWord(),
        }, icon('i-speaker'), '随机听写')));

    const table = h('div', { class: 'table' },
      h('div', { class: 'trow thead' },
        h('span', { text: '单词' }),
        h('span', { text: '释义' }),
        h('span', { class: 'cell-ipa', text: '音标' }),
        h('span', { text: '词库 / 掌握' }),
        h('span', { class: 'cell-box', text: '复习日期' }),
        h('span', { style: { textAlign: 'right' }, text: '操作' })),
      visible.map((rec) => letRow(rec, view)));

    const foot = rows.length > visible.length
      ? h('div', { class: 'wb-foot' },
        h('span', { text: `已显示 ${visible.length} / ${rows.length} 条` }),
        h('button', {
          class: 'btn sm',
          type: 'button',
          onclick: () => {
            wbLimit += 200;
            renderWordbook(view);
          },
        }, '显示更多'))
      : h('div', { class: 'wb-foot' }, h('span', { text: `共 ${rows.length} 条记录` }));

    mount(view, pageHead('生词本', '学过的单词都会在这里，可标记生词或移除'), toolbar, table, foot);
  }

  function letRow(rec, view) {
    const level = bank.levelMeta(rec.level);
    const mastery = rec.mastered ? '已掌握' : `第 ${(rec.box || 0) + 1} 级`;

    return h('div', { class: 'trow' },
      h('div', { class: 'cell-en' }, rec.en,
        h('button', { class: 'mini-btn', type: 'button', title: '朗读', onclick: () => sound.speak(rec.en) }, icon('i-speaker'))),
      h('div', { class: 'cell-zh', text: rec.zh }),
      h('div', { class: 'cell-ipa', text: rec.ipa }),
      h('div', {},
        h('span', { class: 'box-pill' },
          h('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: level.color, display: 'inline-block' } }),
          level.name),
        ' ',
        h('span', { class: `box-pill ${rec.mastered ? 'mastered' : ''}`, text: mastery })),
      h('div', { class: 'cell-box hint', text: `${rec.nextReview} · 对${rec.correct}/错${rec.wrong}` }),
      h('div', { class: 'cell-actions' },
        h('button', {
          class: `mini-btn ${rec.starred ? 'on' : ''}`,
          type: 'button',
          title: rec.starred ? '取消标记' : '标记为生词',
          onclick: () => {
            rec.starred = !rec.starred;
            store.save();
            renderWordbook(view);
          },
        }, icon('i-star')),
        h('button', {
          class: 'mini-btn',
          type: 'button',
          title: '重新开始记这个词（明天复习）',
          onclick: () => {
            rec.box = 0;
            rec.mastered = false;
            rec.nextReview = addDays(bank.today(), 1);
            store.save();
            toast(`「${rec.en}」已重新加入明天的复习`, 'ok');
            renderWordbook(view);
          },
        }, icon('i-review')),
        h('button', {
          class: 'mini-btn danger',
          type: 'button',
          title: '从生词本移除',
          onclick: async () => {
            const ok = await confirmDialog({
              title: '移除这个单词？',
              message: `「${rec.en} ${rec.zh}」将被移出生词本，学习记录一并清除。`,
              okText: '移除',
              danger: true,
            });
            if (!ok) return;
            delete store.get().words[rec.id];
            const plan = store.get().plan;
            if (plan) {
              delete plan.doneNew[rec.id];
              delete plan.doneReview[rec.id];
            }
            store.save();
            toast('已移除', 'ok');
            renderWordbook(view);
          },
        }, icon('i-trash'))));
  }

  /* ======================================================================
     数据统计
     ====================================================================== */

  function renderStats(view) {
    const state = store.get();
    const days = bank.recentDays(state, 7);
    const acc = bank.accuracy(state);
    const learned = bank.learnedCount(state);
    const mastered = bank.masteredCount(state);
    const dueNow = bank.dueRecords(state).length;

    const maxTotal = Math.max(1, ...days.map((d) => d.newCount + d.reviewCount));

    const chart = h('div', { class: 'chart' }, days.map((d) => {
      const total = d.newCount + d.reviewCount;
      const newH = total ? (d.newCount / maxTotal) * 110 : 0;
      const revH = total ? (d.reviewCount / maxTotal) * 110 : 0;
      return h('div', { class: `col ${d.isToday ? 'today' : ''}` },
        h('span', { class: 'cnum', text: total ? String(total) : '' }),
        h('div', { class: 'cbar' },
          h('div', { class: 'seg new', style: { height: `${newH}px` }, title: `新词 ${d.newCount}` }),
          h('div', { class: 'seg rev', style: { height: `${revH}px` }, title: `复习 ${d.reviewCount}` })),
        h('span', { class: 'clabel', text: d.isToday ? '今天' : weekdayOf(d.date).replace('周', '') }));
    }));

    const chartCard = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('i-chart'), '最近 7 天学习量'),
      chart,
      h('div', { class: 'legend' },
        h('span', { class: 'l-new' }, h('i'), '新学单词'),
        h('span', { class: 'l-rev' }, h('i'), '复习单词')));

    const accCard = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('i-target'), '总体正确率'),
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '12px' } },
        h('span', { style: { fontFamily: 'var(--font-en)', fontSize: '40px', fontWeight: '700', lineHeight: '1' }, text: `${acc.percent}%` }),
        h('span', { class: 'hint', text: `共作答 ${acc.total} 题` })),
      h('div', { class: 'bar good' }, h('i', { style: { width: `${acc.percent}%` } })),
      h('div', { class: 'kv', style: { marginTop: '16px' } },
        kvItem('答对', `${acc.correct} 次`),
        kvItem('答错', `${acc.wrong} 次`),
        kvItem('历史最佳连续', `${Math.max(state.streak.best || 0, state.streak.current || 0)} 天`)));

    const statsRow = h('div', { class: 'grid c4' },
      statBlock('i-book', '累计已学', learned, '个', 'accent'),
      statBlock('i-check', '已掌握', mastered, '个', 'good'),
      statBlock('i-review', '复习中', learned - mastered, '个', ''),
      statBlock('i-flame', '待复习', dueNow, '个', dueNow ? 'warn' : ''));

    const upcoming = bank.upcoming(state, 7);
    const upMax = Math.max(1, ...upcoming.map((u) => u.count));
    const upCard = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('i-review'), '未来 7 天复习压力'),
      h('div', { class: 'level-list' }, upcoming.map((u) => h('div', { class: 'level-line' },
        h('div', { class: 'll-top' },
          h('span', { class: 'name', text: prettyDay(u.date) }),
          h('span', { class: 'num', text: `${u.count} 个` })),
        h('div', { class: 'bar thin' }, h('i', { style: { width: `${(u.count / upMax) * 100}%` } }))))));

    const levelCard = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('i-book'), '各词库掌握情况'),
      h('div', { class: 'level-list' }, bank.levelProgress(state).map((lv) => h('div', { class: 'level-line' },
        h('div', { class: 'll-top' },
          h('span', { class: 'name' }, h('span', { class: 'dot', style: { background: lv.color } }), lv.name),
          h('span', { class: 'num', text: `${lv.learned} / ${lv.total}（${lv.percent}%）` })),
        h('div', { class: 'bar thin' }, h('i', { style: { width: `${lv.percent}%` } }))))));

    if (!learned) {
      mount(view, pageHead('数据统计', '学习数据会随使用自动积累'),
        emptyState('i-chart', '还没有学习数据', '学完第一组单词后，这里会显示学习曲线、正确率和复习压力预测。',
          h('button', { class: 'btn primary', type: 'button', onclick: () => WM.app.go('home') }, icon('i-play'), '去学习')));
      return;
    }

    mount(view,
      pageHead('数据统计', `累计学习 ${learned} 个单词`),
      statsRow,
      h('div', { class: 'grid side' }, chartCard, accCard),
      h('div', { class: 'grid c2' }, levelCard, upCard));
  }

  /* ======================================================================
     设置
     ====================================================================== */

  const DAILY_PRESETS = [10, 15, 20, 30, 50, 80];

  function renderSettings(view) {
    const state = store.get();
    const s = state.settings;
    const levels = bank.levels();

    /* ---------- 词库范围 ---------- */
    const levelGrid = h('div', { class: 'level-grid' }, levels.map((lv) => {
      const on = s.levels.includes(lv.id);
      return h('button', {
        class: `level-card ${on ? 'on' : ''}`,
        type: 'button',
        onclick: () => {
          const next = on ? s.levels.filter((id) => id !== lv.id) : [...s.levels, lv.id];
          if (!next.length) {
            toast('至少要保留一个词库范围', 'warn');
            return;
          }
          applySettings({ levels: next });
          renderSettings(view);
        },
      },
        h('span', { class: 'lc-check' }, icon('i-check')),
        h('span', { class: 'lc-top' },
          h('span', { class: 'dot', style: { width: '9px', height: '9px', borderRadius: '50%', background: lv.color, display: 'inline-block' } }),
          h('span', { class: 'lc-name', text: lv.name })),
        h('span', { class: 'lc-desc', text: lv.desc }),
        h('span', { class: 'lc-count', text: `${lv.total} 词` }));
    }));

    const scopeCard = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('i-book'), '词库范围（可多选）'),
      levelGrid,
      h('div', { class: 'btn-row', style: { marginTop: '14px' } },
        h('button', {
          class: 'btn sm',
          type: 'button',
          onclick: () => { applySettings({ levels: levels.map((l) => l.id) }); renderSettings(view); },
        }, '全选'),
        h('button', {
          class: 'btn sm',
          type: 'button',
          onclick: () => { applySettings({ levels: ['primary', 'junior', 'senior'] }); renderSettings(view); },
        }, '只选国内学段'),
        h('button', {
          class: 'btn sm',
          type: 'button',
          onclick: () => { applySettings({ levels: ['cet4', 'cet6', 'ielts', 'toefl'] }); renderSettings(view); },
        }, '只选留学考试'),
        h('span', { class: 'hint', style: { alignSelf: 'center' }, text: `当前范围共 ${bank.poolFor(s.levels).length} 个单词` })));

    /* ---------- 每日数量 ---------- */
    const countValue = h('span', { class: 'val', text: String(s.dailyCount) });
    const countSlider = h('input', {
      type: 'range',
      min: '5',
      max: '200',
      step: '5',
      value: String(s.dailyCount),
      oninput: (e) => { countValue.textContent = e.target.value; },
      onchange: (e) => { applySettings({ dailyCount: Number(e.target.value) }); renderSettings(view); },
    });

    const countCard = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('i-bolt'), '每天背诵的单词数量'),
      h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', text: '每日新词量' }),
          h('div', { class: 'row-desc', text: '每天计划学习多少个新单词，学完当天自动排入第二天的复习' })),
        h('div', { class: 'row-ctl' }, countValue)),
      h('div', { class: 'slider-row' }, countSlider),
      h('div', { class: 'number-pick', style: { marginTop: '14px' } }, DAILY_PRESETS.map((n) => h('button', {
        class: s.dailyCount === n ? 'on' : '',
        type: 'button',
        onclick: () => { applySettings({ dailyCount: n }); renderSettings(view); },
      }, String(n)))),

      h('div', { class: 'row', style: { marginTop: '6px' } },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', text: '每日复习上限' }),
          h('div', { class: 'row-desc', text: `当前每天最多复习 ${s.reviewLimit} 个；积压太多时可调高` })),
        h('div', { class: 'row-ctl', style: { width: '220px' } },
          h('input', {
            type: 'range',
            min: '10',
            max: '300',
            step: '10',
            value: String(s.reviewLimit),
            onchange: (e) => { applySettings({ reviewLimit: Number(e.target.value) }); renderSettings(view); },
          }))));

    /* ---------- 出题方向 ---------- */
    const dirs = [
      { id: 'en2zh', name: '英译中', desc: '看英文选中文' },
      { id: 'zh2en', name: '中译英', desc: '看中文选英文' },
      { id: 'mixed', name: '中英混合', desc: '两种方向随机出现' },
    ];
    const dirCard = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('i-target'), '出题方向'),
      h('div', { class: 'theme-picker' }, dirs.map((d) => h('button', {
        class: `theme-card ${s.direction === d.id ? 'on' : ''}`,
        type: 'button',
        onclick: () => { applySettings({ direction: d.id }); renderSettings(view); },
      },
        h('div', { class: 'tc-name' }, d.name, s.direction === d.id ? icon('i-check') : null),
        h('div', { class: 'hint', style: { marginTop: '4px' }, text: d.desc })))));

    /* ---------- 主题 ---------- */
    const themeCard = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('i-sun'), '界面主题'),
      h('div', { class: 'theme-picker' },
        themePreview('light', '白色主题', s.theme === 'light', view),
        themePreview('dark', '黑色主题', s.theme === 'dark', view)));

    /* ---------- 声音 ---------- */
    const soundCard = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('i-volume'), '音效与发音'),
      h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', text: '答题音效' }),
          h('div', { class: 'row-desc', text: '答对播放清脆上行音，答错播放低沉提示音' })),
        h('div', { class: 'row-ctl' },
          h('button', {
            class: 'btn sm',
            type: 'button',
            onclick: () => { sound.correct(); },
          }, icon('i-play'), '试听对'),
          h('button', {
            class: 'btn sm',
            type: 'button',
            onclick: () => { sound.wrong(); },
          }, icon('i-play'), '试听错'),
          h('button', {
            class: `switch ${s.sound ? 'on' : ''}`,
            type: 'button',
            'aria-label': '音效开关',
            onclick: () => { applySettings({ sound: !s.sound }); renderSettings(view); },
          }))),

      h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', text: '音量' }),
          h('div', { class: 'row-desc', text: `当前 ${Math.round(s.volume * 100)}%` })),
        h('div', { class: 'row-ctl', style: { width: '240px' } },
          h('input', {
            type: 'range',
            min: '0',
            max: '100',
            step: '5',
            value: String(Math.round(s.volume * 100)),
            oninput: (e) => sound.setVolume(Number(e.target.value) / 100),
            onchange: (e) => { applySettings({ volume: Number(e.target.value) / 100 }); renderSettings(view); },
          }))),

      h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', text: '英文自动朗读' }),
          h('div', { class: 'row-desc', text: '英文出现在题面时自动用系统语音朗读（中译英题目会在作答后朗读）' })),
        h('div', { class: 'row-ctl' },
          h('button', {
            class: 'switch ' + (s.autoPronounce ? 'on' : ''),
            type: 'button',
            'aria-label': '自动朗读开关',
            onclick: () => { applySettings({ autoPronounce: !s.autoPronounce }); renderSettings(view); },
          }))),

      h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', text: '答对后自动进入下一题' }),
          h('div', { class: 'row-desc', text: s.autoNext ? `答对后停留 ${(s.autoNextDelay / 1000).toFixed(1)} 秒再跳到下一题` : '关闭后每题都需要手动点击「继续」' })),
        h('div', { class: 'row-ctl' },
          s.autoNext
            ? h('input', {
              type: 'range',
              min: '400',
              max: '3000',
              step: '100',
              value: String(s.autoNextDelay),
              style: { width: '150px' },
              onchange: (e) => { applySettings({ autoNextDelay: Number(e.target.value) }); renderSettings(view); },
            })
            : null,
          h('button', {
            class: `switch ${s.autoNext ? 'on' : ''}`,
            type: 'button',
            'aria-label': '自动下一题开关',
            onclick: () => { applySettings({ autoNext: !s.autoNext }); renderSettings(view); },
          }))),

      h('div', { class: 'row row-showdetail' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', text: '答对后展开详细词条' }),
          h('div', {
            class: 'row-desc',
            text: s.showDetail
              ? '答对后显示单词的音标、词性、释义、例句与复习进度（此时自动跳题会延后到至少 3.2 秒）'
              : '答对后只显示一条精简反馈，节奏更快',
          })),
        h('div', { class: 'row-ctl' },
          h('button', {
            class: `switch ${s.showDetail ? 'on' : ''}`,
            type: 'button',
            'aria-label': '详细词条开关',
            onclick: () => { applySettings({ showDetail: !s.showDetail }); renderSettings(view); },
          }))));

    /* ---------- 数据管理 ---------- */
    const dataCard = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('i-download'), '数据管理'),
      h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title', text: `本地已保存 ${bank.learnedCount(state)} 个单词的记录` }),
          h('div', { class: 'row-desc', text: '数据保存在本机，可随时导出备份，换电脑时导入即可继续' })),
        h('div', { class: 'row-ctl' },
          h('button', { class: 'btn sm', type: 'button', onclick: () => WM.app.exportData() }, icon('i-download'), '导出备份'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => WM.app.importData() }, icon('i-upload'), '导入备份'),
          h('button', {
            class: 'btn sm danger',
            type: 'button',
            onclick: async () => {
              const ok = await confirmDialog({
                title: '清空所有学习数据？',
                message: '所有已学单词、复习计划和统计都会被删除，且无法恢复。建议先导出备份。',
                okText: '确认清空',
                danger: true,
              });
              if (!ok) return;
              store.reset();
              WM.app.setTheme(store.get().settings.theme);
              sound.setEnabled(store.get().settings.sound);
              sound.setVolume(store.get().settings.volume);
              WM.app.refreshChrome();
              renderSettings(view);
              toast('数据已清空', 'ok');
            },
          }, icon('i-trash'), '清空数据'))));

    /* ---------- 关于 ---------- */
    const aboutCard = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('i-bolt'), '关于'),
      h('div', { class: 'kv' },
        kvItem('应用版本', '1.0.0'),
        kvItem('内置词库', `${bank.totalWords()} 词 / ${levels.length} 个等级`),
        kvItem('运行环境', WM.app.info ? `${WM.app.info.electron ? 'Electron ' + WM.app.info.electron : '浏览器'} · Chromium ${WM.app.info.chrome || '-'}` : '-')),
      h('p', { class: 'hint', style: { marginTop: '14px' }, text: '背单词 WordMaster · 离线可用，所有数据只存在你自己的电脑上。' }));

    mount(view,
      pageHead('设置', '调整词库范围、每日数量、主题与音效'),
      scopeCard,
      h('div', { class: 'grid c2' }, countCard, dirCard),
      h('div', { class: 'grid c2' }, themeCard, soundCard),
      h('div', { class: 'grid c2' }, dataCard, aboutCard));
  }

  function themePreview(id, name, active, view) {
    const isDark = id === 'dark';
    const bg = isDark ? '#0e1016' : '#f2f5fb';
    const side = isDark ? '#161923' : '#ffffff';
    const line1 = isDark ? '#2b3244' : '#dfe5f1';
    const line2 = isDark ? '#39415a' : '#c9d3e6';
    return h('button', {
      class: `theme-card ${active ? 'on' : ''}`,
      type: 'button',
      onclick: () => { applySettings({ theme: id }); renderSettings(view); },
    },
      h('div', { class: 'theme-preview', style: { background: bg } },
        h('div', { class: 'tp-side', style: { background: side } }),
        h('div', { class: 'tp-body' },
          h('div', { class: 'tp-line', style: { background: isDark ? '#6d8bff' : '#4864f0', width: '62%' } }),
          h('div', { class: 'tp-line', style: { background: line1, width: '100%' } }),
          h('div', { class: 'tp-line', style: { background: line2, width: '78%' } }))),
      h('div', { class: 'tc-name' }, name, active ? icon('i-check') : null));
  }

  WM.views = {
    renderHome,
    renderWordbook,
    renderStats,
    renderSettings,
    applySettings,
    statBlock,
    kvItem,
    emptyState,
    pageHead,
  };
})(window.WM);
