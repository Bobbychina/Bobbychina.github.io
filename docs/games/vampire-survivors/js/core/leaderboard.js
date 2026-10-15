/* ===========================================================
   全站榜（全球排行榜）：走站点的云后端（Cloudflare Worker 的 /api/score）
   ---------------------------------------------------------------------------
   口径（跟共创伙伴在留言板里定的）：
     · **看榜不用登录**（GET 是公开只读），**上榜要云账号登录** —— 服务端只认自己的会话，
       所以名字伪造不了；GitHub-Gist 模式的账号不经过服务端，上不了榜（界面会明说）。
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
  function who() { try { var u = lib().current(); return u ? (u.login || u.name || '') : ''; } catch (e) { return ''; } }
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
      if (!t) return { ok: false, err: '没登录云账号（用 GitHub 登录的存档是本机 + Gist，上不了全站榜）', needLogin: true, fatal: true };
      h.authorization = 'Bearer ' + t;
    }
    var r = await fetch(b + path, Object.assign({ headers: h, mode: 'cors' }, opts || {}));
    var d = null;
    try { d = await r.json(); } catch (e) { d = null; }
    if (!r.ok) return { ok: false, status: r.status, err: (d && (d.message || d.error)) || ('HTTP ' + r.status), data: d, fatal: true };
    return { ok: true, data: d };
  }

  async function req(path, opts, needAuth) {
    var list = bases();
    if (!list.length) return { ok: false, err: '这台设备没配云后端（auth-config.js 里的 api 是空的）' };
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
    return lastErr || { ok: false, err: '连不上云后端' };
  }

  var Leaderboard = {

    GAME: GAME,
    available: function () { return !!base() && !!lib(); },
    canSubmit: function () { return !!base() && !!token(); },
    who: who,

    /** 读榜（不用登录） */
    top: function () { return req('/api/score?game=' + encodeURIComponent(GAME), { method: 'GET' }, false); },

    /** 给探针用：忘掉「上次成功的地址」缓存，好把候选链完整重跑一遍 */
    resetBase: function () { goodBase = ''; },

    /** 提交一局（要云账号会话） */
    submit: function (run) {
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
