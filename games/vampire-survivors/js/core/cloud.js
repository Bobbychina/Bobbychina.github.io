/* ===========================================================
   云存档桥：复用站点既有的「账号 + 私有 Gist」那套（/games/account.js → window.DSHAccount）
   —— 不在游戏里另造一套同步：令牌、gist 文件命名（<game>__<slot>.json）、账号与云盘
   选择、上传加密全在那边；这里只做两件事：
     1) 把本游戏的存档对象搬进账号库的槽位（savePut / saveGet）
     2) 让账号库去和 Gist 对账（cloudPush / cloudPull / syncNow），再把结果并回本机
   合并口径：纪录类字段**取两边最大值**（下载不会把本机成绩冲掉），静音是本机偏好。
   没登录 / 没绑定云盘时全部安全降级：按钮置灰，游戏照常玩。
   =========================================================== */
(function (VS) {
  'use strict';

  var GAME = 'vampire-survivors';              // gist 里就是 vampire-survivors__main.json
  var SLOT = 'main';
  var LAST_KEY = 'vampire_survivors_cloud_v1'; // 只记「上次同步时间」，纯粹给界面显示
  var RECORDS = ['bestTime', 'bestKills', 'bestLevel', 'runs', 'totalKills'];

  var listeners = [];
  function emit(type, extra) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](type, extra || {}); } catch (e) { /* 界面出错不能影响同步 */ }
    }
  }

  function lib() { return window.DSHAccount || null; }
  function logged() { try { var a = lib(); return !!(a && a.currentUid && a.currentUid()); } catch (e) { return false; } }
  function who() { try { var u = lib().current(); return u ? (u.login || u.name || '') : ''; } catch (e) { return ''; } }
  function backend() { try { return logged() && lib().backend ? (lib().backend() || '') : ''; } catch (e) { return ''; } }
  function cloudInfo() { try { return logged() ? lib().saveInfo(GAME, SLOT) : null; } catch (e) { return null; } }

  function lastSync() { try { return window.localStorage.getItem(LAST_KEY) || ''; } catch (e) { return ''; } }
  function markSync() {
    var t = new Date().toISOString();
    try { window.localStorage.setItem(LAST_KEY, t); } catch (e) { /* 无痕模式：不记也行 */ }
    return t;
  }

  /** 纪录取长；静音跟本机 */
  function merge(local, remote) {
    var out = {}, k;
    for (k in local) if (Object.prototype.hasOwnProperty.call(local, k)) out[k] = local[k];
    for (k in remote) if (Object.prototype.hasOwnProperty.call(remote, k)) out[k] = remote[k];
    for (var i = 0; i < RECORDS.length; i++) {
      k = RECORDS[i];
      out[k] = Math.max(Number((local || {})[k]) || 0, Number((remote || {})[k]) || 0);
    }
    out.muted = !!(local && local.muted);
    if (VS.Scores) out.top = VS.Scores.union((local || {}).top, (remote || {}).top);
    return out;
  }

  /** 把并好的结果写回本机存档（原地改，保持 game.data 引用） */
  function applyToLocal(merged) {
    var data = VS.Save.load();
    for (var k in merged) if (Object.prototype.hasOwnProperty.call(merged, k)) data[k] = merged[k];
    VS.Save.persist(data);
    if (VS.Game && VS.Game.current) VS.Game.current.data = data;
    return data;
  }

  function needLogin() { return { ok: false, err: '还没登录（先绑定 GitHub）', needLogin: true }; }

  var Cloud = {

    GAME: GAME,
    SLOT: SLOT,

    /** account.js 是否装上了（没装=纯本地游戏，界面会隐藏云存档那一行） */
    available: function () { return !!lib(); },
    logged: logged,
    who: who,
    backend: backend,
    cloudInfo: cloudInfo,
    lastSync: lastSync,
    merge: merge,
    on: function (fn) { if (typeof fn === 'function') listeners.push(fn); },

    /** 一句话状态，给界面直接用 */
    status: function () {
      if (!Cloud.available()) return { state: 'nolib', text: '这台设备没有账号库（纯本地存档）' };
      if (!logged()) return { state: 'guest', text: '未登录 · 存档只在这台设备上' };
      var b = backend();
      if (!b) return { state: 'nocloud', text: '已登录 ' + (who() || '') + ' · 云存档没接上（云后端连不上时就这样）' };
      var info = cloudInfo();
      var t = '已连接 ' + (who() || b) + (b === 'github' ? '（私有 Gist）' : b === 'server' ? '（云账号）' : ('（' + b + '）'));
      if (info && info.updatedAt) t += ' · 上次存档 ' + String(info.updatedAt).replace('T', ' ').slice(0, 16);
      return { state: 'ok', text: t, backend: b, name: who(), updatedAt: (info && info.updatedAt) || '' };
    },

    /** 本机 → 云端（gist / 云账号） */
    push: async function (quiet) {
      if (!logged()) return needLogin();
      var a = lib();
      var w = a.savePut(GAME, SLOT, VS.Save.load());
      if (!w || !w.ok) return { ok: false, err: (w && w.err) || '写本地槽位失败' };
      try {
        var r = await a.cloudPush(GAME);
        if (r && r.ok) { markSync(); emit('push', r); return { ok: true, updatedAt: markSync() }; }
        if (!quiet) emit('error', r);
        return r || { ok: false, err: '上传失败' };
      } catch (e) { return { ok: false, err: '上传失败：' + e.message }; }
    },

    /** 云端 → 本机（合并取长） */
    pull: async function (quiet) {
      if (!logged()) return needLogin();
      var a = lib();
      try {
        var r = await a.cloudPull(GAME);
        if (r && r.ok === false) { if (!quiet) emit('error', r); return r; }
        var remote = a.saveGet(GAME, SLOT);
        if (!remote) return { ok: false, err: '云端还没有这份存档' };
        var merged = merge(VS.Save.load(), remote);
        applyToLocal(merged);
        markSync();
        emit('pull', { merged: merged, pulled: (r && r.pulled) || [] });
        return { ok: true, merged: merged };
      } catch (e) { return { ok: false, err: '下载失败：' + e.message }; }
    },

    /** 双向对账：先把手上的存档放进槽位，让账号库比时间戳（谁新用谁），再并回本机 */
    sync: async function (quiet) {
      if (!logged()) return needLogin();
      var a = lib();
      if (!backend()) return { ok: false, err: '还没绑定 GitHub，云存档用不了' };
      var w = a.savePut(GAME, SLOT, VS.Save.load());
      if (!w || !w.ok) return { ok: false, err: (w && w.err) || '写本地槽位失败' };
      try {
        var r = await a.syncNow(GAME);
        if (r && r.ok === false) { if (!quiet) emit('error', r); return r; }
        var after = a.saveGet(GAME, SLOT);
        if (after) { applyToLocal(merge(VS.Save.load(), after)); }
        markSync();
        emit('sync', r || {});
        return { ok: true, result: r || {} };
      } catch (e) { return { ok: false, err: '同步失败：' + e.message }; }
    },

    /** 云账号登录（要服务端会话才能在「全站榜」上榜；GitHub 登录是另一条路，走不到服务端） */
    loginCloud: async function (name, password) {
      if (!lib()) return { ok: false, err: '账号库没装' };
      var r = await lib().login({ name: String(name || '').trim(), password: String(password || '') });
      if (r && r.ok) {
        /* 解锁时把本游戏的 id 传进去：账号库会拿**这个游戏**的云端存档试解一次，
           验证这把钥匙真能开（以前它硬编码探 zombie-survival，等于探了个无关的档） */
        if (lib().unlock) { try { await lib().unlock(String(password || ''), GAME); } catch (e) { /* 解不开存档也不挡登录 */ } }
        emit('login', r);
        return r;
      }
      return { ok: false, err: (r && r.err) || '登录失败' };
    },

    /** 粘贴 GitHub 令牌绑定（与游戏厅同一个入口，令牌只存在本机） */
    bindToken: async function (token) {
      if (!lib()) return { ok: false, err: '账号库没装' };
      var r = await lib().bindGitHubToken(String(token || '').trim());
      if (r && r.ok) emit('login', r);
      return r;
    },

    /** GitHub 设备码登录（不用手抄令牌；校园网里若 relay 不可达会报错，那就回退粘贴令牌） */
    bindDevice: async function (onCode) {
      if (!lib()) return { ok: false, err: '账号库没装' };
      var r = await lib().bindGitHubDevice(function (info) { if (onCode) onCode(info); });
      if (r && r.ok) emit('login', r);
      return r;
    },

    /** 打开令牌创建页（权限已勾好 gist） */
    tokenUrl: 'https://github.com/settings/tokens/new?scopes=gist&description=bobbychina.github.io%2Fgames'
  };

  VS.register('Cloud', Cloud);

})(window.VS = window.VS || {});
