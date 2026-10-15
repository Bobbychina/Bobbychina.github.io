/* ===========================================================
   音效：全部用 WebAudio 实时合成，不依赖任何音频素材文件
   （外链音频在 file:// 下会被 CORS 拦截，且需要额外资源）
   所有调用都做了节流与 try/catch —— 音频永远不能影响游戏逻辑
   =========================================================== */
(function (VS) {
  'use strict';

  var ac = null;              // AudioContext
  var master = null;          // 总音量
  var noiseBuf = null;        // 复用的白噪声缓冲
  var supported = true;       // 环境是否支持 WebAudio
  var muted = false;
  var lastPlay = {};          // 同名音效上次播放的音频时间（节流用）
  var started = false;

  /* 同类音效的最小间隔（秒），避免一帧打死 50 只怪时爆音 */
  var MIN_GAP = {
    shoot: 0.045,
    hit: 0.030,
    die: 0.030,
    pickup: 0.030,
    heal: 0.080,
    hurt: 0.150,
    nova: 0.080,
    level: 0.200,
    over: 0.500,
    click: 0.040
  };

  function ensure() {
    if (ac) return true;
    if (!supported) return false;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { supported = false; return false; }

      ac = new AC();

      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.32;
      master.connect(ac.destination);

      // 预生成 0.5 秒白噪声，供打击/爆炸类音效复用
      var len = Math.floor(ac.sampleRate * 0.5);
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      return true;
    } catch (e) {
      supported = false;
      ac = null;
      return false;
    }
  }

  /* 一个带指数衰减包络的增益节点 */
  function env(t, attack, decay, peak) {
    var g = ac.createGain();
    var p = Math.max(0.0002, peak);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(p, t + Math.max(0.001, attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(master);
    return g;
  }

  /* 频率滑动的单音 */
  function blip(t, type, f0, f1, dur, vol) {
    var osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    osc.connect(env(t, 0.008, dur, vol));
    osc.start(t);
    osc.stop(t + dur + 0.06);
  }

  /* 带通滤波的噪声脉冲 */
  function noise(t, dur, vol, freq) {
    var src = ac.createBufferSource();
    src.buffer = noiseBuf;
    var filt = ac.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = freq || 1200;
    filt.Q.value = 0.9;
    src.connect(filt);
    filt.connect(env(t, 0.005, dur, vol));
    src.start(t);
    src.stop(t + dur + 0.06);
  }

  /* 琶音和弦 */
  function chord(t, freqs, dur, type, vol) {
    for (var i = 0; i < freqs.length; i++) {
      var at = t + i * 0.055;
      var osc = ac.createOscillator();
      osc.type = type || 'triangle';
      osc.frequency.value = freqs[i];
      var g = ac.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(at);
      osc.stop(at + dur + 0.06);
    }
  }

  var SFX = {
    shoot: function (t) { blip(t, 'square', 720, 430, 0.07, 0.045); },
    hit: function (t) { noise(t, 0.05, 0.045, 1900); },
    die: function (t) { blip(t, 'triangle', 330, 82, 0.16, 0.065); noise(t, 0.09, 0.03, 700); },
    pickup: function (t) { blip(t, 'sine', 880, 1520, 0.08, 0.050); },
    heal: function (t) { blip(t, 'sine', 520, 1000, 0.22, 0.075); },
    hurt: function (t) { blip(t, 'sawtooth', 210, 62, 0.22, 0.090); },
    nova: function (t) { noise(t, 0.28, 0.075, 420); blip(t, 'sine', 190, 58, 0.30, 0.055); },
    level: function (t) { chord(t, [523.25, 659.25, 783.99, 1046.5], 0.42, 'triangle', 0.085); },
    over: function (t) { chord(t, [392.00, 329.63, 261.63, 196.00], 0.72, 'sawtooth', 0.075); },
    click: function (t) { blip(t, 'square', 560, 780, 0.045, 0.045); }
  };

  var Audio = {

    /** 是否支持音频（不支持时所有接口静默降级） */
    isSupported: function () { return supported; },

    /**
     * 必须在一次真实用户手势里调用，否则浏览器会挂起 AudioContext。
     * 返回是否成功解锁。
     */
    unlock: function () {
      if (!ensure()) return false;
      try {
        if (ac.state === 'suspended' && ac.resume) ac.resume();
        // 用一个 0 增益的极短音把管线"暖"起来
        if (!started) {
          started = true;
          var t = ac.currentTime;
          var g = ac.createGain();
          g.gain.value = 0;
          g.connect(master);
          var osc = ac.createOscillator();
          osc.connect(g);
          osc.start(t);
          osc.stop(t + 0.02);
        }
        return true;
      } catch (e) {
        return false;
      }
    },

    /** 播放一个音效；名字不存在或环境不支持时静默忽略 */
    play: function (name) {
      if (muted) return;
      if (!ensure()) return;
      try {
        if (ac.state === 'suspended' && ac.resume) ac.resume();

        var fn = SFX[name];
        if (!fn) return;

        var t = ac.currentTime;
        var gap = MIN_GAP[name] !== undefined ? MIN_GAP[name] : 0.02;
        if (lastPlay[name] !== undefined && (t - lastPlay[name]) < gap) return;
        lastPlay[name] = t;

        fn(t + 0.001);
      } catch (e) {
        /* 音频异常一律吞掉 */
      }
    },

    setMuted: function (v) {
      muted = !!v;
      if (master) {
        try { master.gain.value = muted ? 0 : 0.32; } catch (e) {}
      }
      return muted;
    },

    isMuted: function () { return muted; },

    toggleMute: function () { return Audio.setMuted(!muted); }
  };

  VS.register('Audio', Audio);

})(window.VS = window.VS || {});
