/* ============================================================================
   util.js — 基础工具：DOM 构建、图标、日期、随机数、提示条、模态框
   说明：所有模块挂在唯一全局命名空间 WM 下（渲染进程不用打包器，走经典脚本）。
   ========================================================================== */
'use strict';

window.WM = window.WM || {};

(function (WM) {
  const SVGNS = 'http://www.w3.org/2000/svg';

  /* ------------------------------- DOM 构建 ------------------------------- */

  function append(parent, kids) {
    for (const kid of kids) {
      if (kid === null || kid === undefined || kid === false || kid === true) continue;
      if (Array.isArray(kid)) append(parent, kid);
      else if (kid instanceof Node) parent.appendChild(kid);
      else parent.appendChild(document.createTextNode(String(kid)));
    }
  }

  /**
   * 极简 hyperscript。
   * h('div', { class: 'a', onclick: fn, dataset: { x: 1 } }, '文本', h('span'))
   */
  function h(tag, props, ...kids) {
    const node = document.createElement(tag);
    if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
      for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key === 'dataset' && typeof value === 'object') Object.assign(node.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'ref' && typeof value === 'function') value(node);
        else node.setAttribute(key, value === true ? '' : String(value));
      }
    } else if (props !== undefined && props !== null) {
      kids.unshift(props);
    }
    append(node, kids);
    return node;
  }

  /** 生成 <svg><use href="#name"/></svg> 图标 */
  function icon(name, cls = 'ico') {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVGNS, 'use');
    use.setAttribute('href', '#' + name);
    svg.appendChild(use);
    return svg;
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** 用新节点替换容器全部内容 */
  function mount(container, ...kids) {
    container.replaceChildren();
    append(container, kids);
    return container;
  }

  /* --------------------------------- 日期 --------------------------------- */

  function dayStr(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseDay(str) {
    const [y, m, d] = String(str).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function addDays(str, n) {
    const d = parseDay(str);
    d.setDate(d.getDate() + n);
    return dayStr(d);
  }

  function diffDays(from, to) {
    return Math.round((parseDay(to) - parseDay(from)) / 86400000);
  }

  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function weekdayOf(str) {
    return WEEKDAYS[parseDay(str).getDay()];
  }

  function prettyDay(str) {
    const d = parseDay(str);
    const today = dayStr();
    if (str === today) return '今天';
    if (str === addDays(today, -1)) return '昨天';
    if (str === addDays(today, 1)) return '明天';
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  /* -------------------------------- 随机数 -------------------------------- */

  /** mulberry32 —— 可复现的伪随机数生成器 */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 由字符串派生 32 位种子（FNV-1a） */
  function seedFrom(str) {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function shuffle(list, random = Math.random) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function pick(list, random = Math.random) {
    return list[Math.floor(random() * list.length)];
  }

  /* --------------------------------- 杂项 --------------------------------- */

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function pct(part, whole) {
    if (!whole) return 0;
    return Math.round((part / whole) * 100);
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const m = Math.floor(s / 60);
    const rest = s % 60;
    if (m <= 0) return `${rest} 秒`;
    return `${m} 分 ${rest} 秒`;
  }

  /** 归一化用于查重：去空白、去大小写 */
  function norm(text) {
    return String(text).toLowerCase().replace(/[\s\u3000·、，,。.；;（）()]/g, '');
  }

  /* ------------------------------- 提示条 ------------------------------- */

  function toast(message, type = 'info', ms = 2400) {
    const host = document.getElementById('toast-host');
    if (!host) return;
    const name = type === 'ok' ? 'i-check' : type === 'err' ? 'i-close' : type === 'warn' ? 'i-bolt' : 'i-bolt';
    const node = h('div', { class: `toast ${type}` }, icon(name), h('span', { text: message }));
    host.appendChild(node);
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 260);
    }, ms);
  }

  /* ------------------------------- 模态框 ------------------------------- */

  let modalOpen = false;

  /**
   * 通用确认框。返回 Promise<boolean>。
   * 支持 Esc 取消、Enter 确认。
   */
  function confirmDialog({
    title = '确认操作',
    message = '',
    okText = '确定',
    cancelText = '取消',
    danger = false,
  } = {}) {
    return new Promise((resolve) => {
      const host = document.getElementById('modal-host');
      if (!host || modalOpen) {
        resolve(false);
        return;
      }
      modalOpen = true;

      const finish = (value) => {
        modalOpen = false;
        host.hidden = true;
        mount(host);
        document.removeEventListener('keydown', onKey, true);
        resolve(value);
      };

      const okBtn = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => finish(true) },
        danger ? icon('i-trash') : icon('i-check'), okText);
      const cancelBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => finish(false) }, cancelText);

      function onKey(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          finish(true);
        }
      }
      document.addEventListener('keydown', onKey, true);

      const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        h('h3', { text: title }),
        message ? h('p', { text: message }) : null,
        h('div', { class: 'modal-actions' }, cancelBtn, okBtn));

      mount(host, h('div', { onclick: (e) => { if (e.target === e.currentTarget) finish(false); } }, box));
      host.hidden = false;
      okBtn.focus();
    });
  }

  /* ------------------------------- 导出 ------------------------------- */

  WM.util = {
    h, icon, $, $$, mount, append, SVGNS,
    dayStr, parseDay, addDays, diffDays, weekdayOf, prettyDay,
    rng, seedFrom, shuffle, pick,
    clamp, pct, formatDuration, norm,
    toast, confirmDialog,
  };
})(window.WM);
