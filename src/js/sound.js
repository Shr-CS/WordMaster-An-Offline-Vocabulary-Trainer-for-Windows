/* ============================================================================
   sound.js — 音效引擎
   用 Web Audio API 实时合成音色，不依赖任何外部音频文件，
   因此打包后绝不会出现「音频资源丢失」的问题。
   另含英文朗读（Web Speech API）能力。
   ========================================================================== */
'use strict';

window.WM = window.WM || {};

(function (WM) {
  let ctx = null;
  let master = null;
  let enabled = true;
  let volume = 0.7;
  let unlocked = false;

  /** 惰性创建 AudioContext（浏览器要求首次交互后才能出声） */
  function ensure() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      try {
        ctx = new AC();
      } catch {
        return null;
      }
      // 轻微压缩，避免多音符叠加时爆音
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 22;
      comp.ratio.value = 3.2;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;
      master = ctx.createGain();
      master.gain.value = enabled ? volume : 0;
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  /** 首次用户手势时解锁音频，并顺手预热一次无声播放 */
  function unlock() {
    if (unlocked) return;
    const c = ensure();
    if (!c) return;
    unlocked = true;
    try {
      const g = c.createGain();
      g.gain.value = 0;
      const o = c.createOscillator();
      o.connect(g);
      g.connect(c.destination);
      o.start();
      o.stop(c.currentTime + 0.01);
    } catch {
      /* 忽略 */
    }
  }

  /**
   * 播放一个带包络的音符。
   * @param {object} o
   * @param {number} o.freq   起始频率(Hz)
   * @param {number} [o.at]   相对当前时间的延迟(秒)
   * @param {number} [o.dur]  持续时间(秒)
   * @param {string} [o.type] 波形：sine/triangle/square/sawtooth
   * @param {number} [o.peak] 峰值音量
   * @param {number} [o.glide] 终止频率，做滑音
   * @param {object} [o.filter] 低通/高通扫频 { type, from, to, q }
   */
  function tone(o) {
    if (!enabled) return;
    const c = ensure();
    if (!c) return;
    const at = o.at || 0;
    const dur = o.dur || 0.16;
    const peak = Math.max(0.0002, o.peak == null ? 0.4 : o.peak);
    const attack = o.attack == null ? 0.006 : o.attack;
    const t0 = c.currentTime + at;

    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.glide), t0 + dur);

    let tail = osc;
    if (o.filter) {
      const bq = c.createBiquadFilter();
      bq.type = o.filter.type || 'lowpass';
      bq.Q.value = o.filter.q == null ? 1 : o.filter.q;
      bq.frequency.setValueAtTime(o.filter.from || 1200, t0);
      if (o.filter.to) bq.frequency.exponentialRampToValueAtTime(Math.max(40, o.filter.to), t0 + dur);
      osc.connect(bq);
      tail = bq;
    }

    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    tail.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.06);
  }

  /** 噪声爆破（用于「错误」音效的颗粒感） */
  function noise(o = {}) {
    if (!enabled) return;
    const c = ensure();
    if (!c) return;
    const dur = o.dur || 0.18;
    const t0 = c.currentTime + (o.at || 0);
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);

    const src = c.createBufferSource();
    src.buffer = buf;
    const bq = c.createBiquadFilter();
    bq.type = 'lowpass';
    bq.frequency.setValueAtTime(o.from || 900, t0);
    bq.frequency.exponentialRampToValueAtTime(o.to || 200, t0 + dur);
    const gain = c.createGain();
    gain.gain.value = o.peak == null ? 0.07 : o.peak;

    src.connect(bq);
    bq.connect(gain);
    gain.connect(master);
    src.start(t0);
    src.stop(t0 + dur);
  }

  /* ---------------------------- 具体音效设计 ---------------------------- */

  /** 答对：明亮的双音上行 + 高频闪光，听感「叮咚」 */
  function correct() {
    tone({ freq: 523.25, dur: 0.13, type: 'sine', peak: 0.2 });
    tone({ freq: 1046.5, at: 0.005, dur: 0.11, type: 'triangle', peak: 0.36 });
    tone({ freq: 1567.98, at: 0.075, dur: 0.24, type: 'triangle', peak: 0.32 });
    tone({ freq: 3135.96, at: 0.075, dur: 0.19, type: 'sine', peak: 0.09 });
    tone({ freq: 2093, at: 0.13, dur: 0.2, type: 'sine', peak: 0.07 });
  }

  /** 答错：低沉下行滑音 + 噪点，明确但不刺耳 */
  function wrong() {
    tone({ freq: 233.08, dur: 0.18, type: 'sawtooth', peak: 0.2, glide: 174.61, filter: { type: 'lowpass', from: 1500, to: 420, q: 3 } });
    tone({ freq: 155.56, at: 0.15, dur: 0.32, type: 'sawtooth', peak: 0.18, glide: 98, filter: { type: 'lowpass', from: 1100, to: 260, q: 3 } });
    tone({ freq: 116.54, at: 0.15, dur: 0.32, type: 'sine', peak: 0.14 });
    noise({ at: 0, dur: 0.16, peak: 0.05, from: 800, to: 160 });
  }

  /** 选项点击：极短的清脆点按声 */
  function click() {
    tone({ freq: 1320, dur: 0.035, type: 'sine', peak: 0.1 });
    tone({ freq: 660, dur: 0.03, type: 'triangle', peak: 0.05 });
  }

  /** 一组学完：C-E-G-C 上行琶音 + 尾音闪烁 */
  function finish() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      tone({ freq: f, at: i * 0.105, dur: 0.36, type: 'triangle', peak: 0.3 });
      tone({ freq: f * 2, at: i * 0.105, dur: 0.22, type: 'sine', peak: 0.06 });
    });
    tone({ freq: 1567.98, at: 0.43, dur: 0.55, type: 'sine', peak: 0.15 });
    tone({ freq: 2093, at: 0.5, dur: 0.5, type: 'sine', peak: 0.07 });
  }

  /** 全对：额外的小彩带音 */
  function perfect() {
    finish();
    [1046.5, 1318.51, 1567.98, 2093].forEach((f, i) => {
      tone({ freq: f, at: 0.72 + i * 0.07, dur: 0.3, type: 'triangle', peak: 0.16 });
    });
  }

  /** 界面切换：比 click 更轻 */
  function swish() {
    tone({ freq: 620, dur: 0.07, type: 'sine', peak: 0.05, glide: 980 });
  }

  /* ------------------------------- 对外接口 ------------------------------- */

  function setEnabled(value) {
    enabled = !!value;
    if (master) master.gain.value = enabled ? volume : 0;
  }

  function setVolume(value) {
    volume = Math.min(1, Math.max(0, Number(value) || 0));
    if (master) master.gain.value = enabled ? volume : 0;
  }

  function preview() {
    correct();
  }

  /* -------------------------------- 朗读 -------------------------------- */

  let cachedVoice = null;

  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    if (cachedVoice) return cachedVoice;
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    const score = (v) => {
      const lang = (v.lang || '').toLowerCase().replace('_', '-');
      let s = 0;
      if (lang.startsWith('en-us')) s += 10;
      else if (lang.startsWith('en-gb')) s += 8;
      else if (lang.startsWith('en')) s += 6;
      if (/google|natural|online|aria|jenny|guy|zira|david|samantha/i.test(v.name)) s += 3;
      if (v.localService) s += 1;
      return s;
    };
    const en = voices.filter((v) => (v.lang || '').toLowerCase().startsWith('en'));
    const list = en.length ? en : voices;
    cachedVoice = list.slice().sort((a, b) => score(b) - score(a))[0] || null;
    return cachedVoice;
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      cachedVoice = null;
      pickVoice();
    };
  }

  /**
   * 用系统 TTS 朗读英文单词。
   * @returns {boolean} 是否成功发起朗读
   */
  function speak(text, { rate = 0.92, pitch = 1, lang = 'en-US' } = {}) {
    if (!text || !('speechSynthesis' in window)) return false;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(String(text));
      utter.lang = lang;
      utter.rate = rate;
      utter.pitch = pitch;
      const voice = pickVoice();
      if (voice) utter.voice = voice;
      window.speechSynthesis.speak(utter);
      return true;
    } catch {
      return false;
    }
  }

  function stopSpeak() {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* 忽略 */
    }
  }

  // 首次交互解锁音频上下文
  const unlockOnce = () => {
    unlock();
    document.removeEventListener('pointerdown', unlockOnce);
    document.removeEventListener('keydown', unlockOnce);
  };
  document.addEventListener('pointerdown', unlockOnce);
  document.addEventListener('keydown', unlockOnce);

  WM.sound = {
    setEnabled, setVolume, preview, unlock,
    correct, wrong, click, finish, perfect, swish,
    speak, stopSpeak,
    get enabled() { return enabled; },
    get volume() { return volume; },
  };
})(window.WM);
