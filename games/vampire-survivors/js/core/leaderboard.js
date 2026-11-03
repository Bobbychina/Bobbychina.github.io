/* ===========================================================
   全站榜（全球排行榜）：走站点的云后端（Cloudflare Worker 的 /api/score）
   ---------------------------------------------------------------------------
   口径（跟共创伙伴在留言板里定的）：
     · 公开读榜；提交使用统一站点账号连接的既有排行榜会话。
     · 上传的只有 存活时间 / 击杀 / 等级 / 波次，不带身份信息（uid、邮箱、IP 都不出浏览器）。
     · 每人 60 秒只能提交一次（服务端冷却），只记个人最好的一局。
   =========================================================== */
(function (VS) {
  'use strict';

  var GAME = 'vampire-survivors';

  function lib() { return window.DSHAccount || null; }
  function base() {
    try { return String((window.DSH_AUTH_CONFIG && window.DSH_AUTH_CONFIG.api) || '').replace(/\/+$/, ''); }
    catch (e) { return ''; }
  }
  function who() { try { var s = VS.SiteAccount.snapshot(), u = s.user;
    return s.signedIn && u ? (u.name || u.username || '') : ''; } catch (e) { return ''; } }
  function token() { try { return lib().sessionToken ? lib().sessionToken() : ''; } catch (e) { return ''; } }

  /** 榜单后端候选地址，按顺序试：
   *   ① pages.dev 中继（有些网络把 *.workers.dev 整段 DNS 黑洞，直连必然超时；中继那一跳在 Cloudflare 内网）
   *   ② 直连 Worker（中继没部署 / 本地调试时的兜底）
   *  记一下上次成功的那个，后续不再重复走一遍失败的路。 */
  var goodBase = '';
  function bases() {
    if (goodBase) return [goodBase];
    var out = [];
    try {
      var relay = String((window.DSH_AUTH_CONFIG && window.DSH_AUTH_CONFIG.github && window.DSH_AUTH_CONFIG.github.relay) || '').replace(/\/+$/, '');
      if (relay) out.push(relay);
    } catch (e) { /* 没配就跳过 */ }
    var a = base();
    if (a && out.indexOf(a) < 0) out.push(a);
    return out;
  }

  async function once(b, path, opts, needAuth) {
    var h = { 'content-type': 'application/json' };
    if (needAuth) {
      var t = token();
      if (!Leaderboard.canSubmit() || !t) return { ok: false, err: '请先使用站点账号连接排行榜', needLogin: true, fatal: true };
      h.authorization = 'Bearer ' + t;
    }
    var abort = new AbortController();
    var timeout = window.setTimeout(function () { abort.abort(); }, 12000);
    var r;
    try { r = await fetch(b + path, Object.assign({ headers: h, mode: 'cors', signal: abort.signal }, opts || {})); }
    finally { window.clearTimeout(timeout); }
    var d = null;
    try { d = await r.json(); } catch (e) { d = null; }
    if (!r.ok) {
      if (needAuth && r.status === 401 && VS.SiteAccount) VS.SiteAccount.invalidate();
      return { ok: false, status: r.status, err: (d && (d.message || d.error)) || ('HTTP ' + r.status), data: d, fatal: true };
    }
    return { ok: true, data: d };
  }

  async function req(path, opts, needAuth) {
    var list = bases();
    if (!list.length) return { ok: false, err: '排行榜服务暂不可用，本机纪录仍会保存' };
    var lastErr = null;
    for (var i = 0; i < list.length; i++) {
      try {
        var r = await once(list[i], path, opts, needAuth);
        if (r.ok) { goodBase = list[i]; return r; }
        if (r.fatal) return r;                       // 4xx/5xx 是服务端明确回答，别再换地址重试
        lastErr = r;
      } catch (e) {
        lastErr = { ok: false, err: '连不上 ' + list[i].replace(/^https?:\/\//, '').split('/')[0] + '：' + e.message };
      }
    }
    return lastErr || { ok: false, err: '暂时连不上排行榜服务' };
  }

  var Leaderboard = {

    GAME: GAME,
    available: function () { return !!base(); },
    canSubmit: function () { return !!base() && !!VS.SiteAccount && VS.SiteAccount.isLinked(); },
    who: who,

    /** 读榜（不用登录） */
    top: function () { return req('/api/score?game=' + encodeURIComponent(GAME), { method: 'GET' }, false); },

    /** 给探针用：忘掉「上次成功的地址」缓存，好把候选链完整重跑一遍 */
    resetBase: function () { goodBase = ''; },

    /** 提交战役成绩（要与当前站点身份一致的排行榜会话） */
    submit: function (run) {
      if (run.mode === 'endless') return Promise.resolve({ ok: false, err: '无尽模式使用本机独立纪录' });
      return req('/api/score', {
        method: 'POST',
        body: JSON.stringify({
          game: GAME,
          time: Math.max(1, Math.round(run.time || 0)),
          kills: Math.max(0, Math.round(run.kills || 0)),
          level: Math.max(1, Math.round(run.level || 1)),
          wave: Math.max(1, Math.round(run.wave || 1))
        })
      }, true);
    },

    /** 一行文案（界面直接用） */
    line: function (r, i) {
      var t = VS.Utils && VS.Utils.formatTime ? VS.Utils.formatTime(r.time) : (r.time + 's');
      return '#' + (i + 1) + '  ' + (r.name || '?') + '  ·  ' + t + '  ·  击杀 ' + (r.kills || 0);
    }
  };

  VS.register('Leaderboard', Leaderboard);

})(window.VS = window.VS || {});
