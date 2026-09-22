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

  async function req(path, opts, needAuth) {
    var b = base();
    if (!b) return { ok: false, err: '这台设备没配云后端（auth-config.js 里的 api 是空的）' };
    var h = { 'content-type': 'application/json' };
    if (needAuth) {
      var t = token();
      if (!t) return { ok: false, err: '没登录云账号（用 GitHub 登录的存档是本机 + Gist，上不了全站榜）', needLogin: true };
      h.authorization = 'Bearer ' + t;
    }
    try {
      var r = await fetch(b + path, Object.assign({ headers: h, mode: 'cors' }, opts || {}));
      var d = null;
      try { d = await r.json(); } catch (e) { d = null; }
      if (!r.ok) return { ok: false, status: r.status, err: (d && (d.message || d.error)) || ('HTTP ' + r.status), data: d };
      return { ok: true, data: d };
    } catch (e) {
      return { ok: false, err: '连不上云后端（离线或网络被挡）：' + e.message };
    }
  }

  var Leaderboard = {

    GAME: GAME,
    available: function () { return !!base() && !!lib(); },
    canSubmit: function () { return !!base() && !!token(); },
    who: who,

    /** 读榜（不用登录） */
    top: function () { return req('/api/score?game=' + encodeURIComponent(GAME), { method: 'GET' }, false); },

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
