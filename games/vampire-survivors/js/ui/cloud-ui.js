/* ===========================================================
   云存档界面：开始面板里的一行「☁ 云存档」
   —— 登录态、上传/下载/同步按钮、粘贴令牌的兜底入口；
   所有动作都交给 VS.Cloud（它再转给站点账号库 /games/account.js）。
   没有账号库时不生成这一行，游戏完全不受影响。
   =========================================================== */
(function (VS) {
  'use strict';
  function siteText(key, fallback, vars) { return window.I18N ? I18N.t(key,vars) : fallback.replace(/\{(\w+)\}/g,function(m,k){return vars && vars[k] != null ? vars[k] : m;}); }


  var dom = null;
  var autoDone = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) { if(window.I18N) I18N.bind(n,'textContent',function(){return I18N.resolve(text);}); else n.textContent=text; }
    return n;
  }

  function note(text, kind) {
    if (!dom || !dom.msg) return;
    if(window.I18N) I18N.bind(dom.msg,'textContent',function(){return I18N.resolve(typeof text === 'function' ? text() : (text || ''));});
    else dom.msg.textContent = typeof text === 'function' ? text() : (text || '');
    dom.msg.className = 'cloud-msg' + (kind ? ' ' + kind : '');
  }

  function refresh() {
    if (!dom) return;
    var st = VS.Cloud.status();
    dom.status.textContent = st.text;
    dom.status.className = 'cloud-status s-' + st.state;
    dom.ico.textContent = st.state === 'ok' ? '☁' : st.state === 'guest' ? '☁' : '⚠';

    var ok = st.state === 'ok';
    dom.up.disabled = !ok;
    dom.down.disabled = !ok;
    dom.sync.disabled = !ok;
    dom.login.hidden = ok;
    dom.tokenToggle.hidden = ok || st.state === 'nolib';
    if (!ok) dom.form.hidden = true;
    /* 说明跟着"现在这条存档路"走（云账号 / GitHub / 未登录三套说法） */
    if (dom.refreshHint) dom.refreshHint();
  }

  function busy(on, what) {
    if (!dom) return;
    dom.up.disabled = on || dom.up.disabled;
    if (on) note(what || siteText("cloud.copy.095198cad4ef","正在和云端说话…"));
  }

  async function run(fn, okText, quiet) {
    if (!dom) return;
    dom.root.classList.add('working');
    note(siteText("cloud.copy.095198cad4ef","正在和云端说话…"));
    var r = await fn();
    dom.root.classList.remove('working');
    if (r && r.ok) {
      note(okText || siteText("cloud.copy.c0b3fbff51cc","完成") + (VS.Cloud.lastSync() ? '（' + VS.Cloud.lastSync().replace('T', ' ').slice(0, 16) + '）' : ''), 'ok');
    } else if (r && r.needLogin) {
      note(siteText("cloud.copy.c656a07ac5c3","先在上面登录 GitHub，再点这个按钮"), 'warn');
    } else {
      note((r && r.err) || siteText("cloud.copy.48a2ef40fc08","失败了"), 'bad');
    }
    refresh();
    return r;
  }

  function boot() {
    if (dom || !VS.Cloud || !VS.Cloud.available()) return;
    var panel = document.getElementById('panel-start');
    if (!panel) return;

    var root = el('div', 'cloud');
    var head = el('div', 'cloud-head');
    var ico = el('span', 'cloud-ico', '☁');
    var status = el('span', 'cloud-status', '');
    head.appendChild(ico);
    head.appendChild(status);

    var btns = el('div', 'cloud-btns');
    var up = el('button', 'cbtn', siteText("cloud.copy.c1f0e9cc2bdd","⬆ 上传存档"));
    var down = el('button', 'cbtn', siteText("cloud.copy.f9d2661f5f5a","⬇ 下载存档"));
    var sync = el('button', 'cbtn', siteText("cloud.copy.e7107aff26e4","⇅ 双向同步"));
    var login = el('button', 'cbtn primary', siteText("cloud.copy.c9c8e6340a95","用 GitHub 登录"));
    var tokenToggle = el('button', 'cbtn ghost', siteText("cloud.copy.6637bc0cdbba","粘贴令牌"));
    var cloudLogin = el('button', 'cbtn ghost', siteText("cloud.copy.eaa4cd7c8beb","云账号登录"));
    [up, down, sync, login, tokenToggle, cloudLogin].forEach(function (b) { b.type = 'button'; btns.appendChild(b); });

    var form = el('div', 'cloud-form');
    form.hidden = true;
    var input = document.createElement('input');
    input.type = 'password';
    input.id = 'cloudToken';
    (window.I18N ? I18N.bind(input,"placeholder",function(){return siteText("cloud.copy.f631f3c518b9","粘贴 GitHub 令牌（gist 权限）");}) : input.placeholder = siteText("cloud.copy.f631f3c518b9","粘贴 GitHub 令牌（gist 权限）"));
    var ok = el('button', 'cbtn primary', siteText("games.token.bind","绑定"));
    ok.type = 'button';
    var link = el('a', 'cloud-link', siteText("cloud.copy.c40a3459fed3","去创建令牌"));
    link.href = VS.Cloud.tokenUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    form.appendChild(input);
    form.appendChild(ok);
    form.appendChild(link);

    var msg = el('p', 'cloud-msg', '');
    /* 说明要跟着账号模式走：云账号的存档在本站云端，GitHub 登录才走你自己的 Gist。
       以前一刀切写"存在你自己的私有 Gist"，云账号的玩家会以为笔记里的地址不对。 */
    var hint = el('p', 'cloud-hint', '');
    function hintText() {
      var b = VS.Cloud.backend && VS.Cloud.backend();
      if (b === 'server') return siteText("cloud.copy.7aefbf51475b","云账号：存档上传到本站云端（Cloudflare KV，密文），换设备登录同一个账号就能接着玩。纪录取两边最高，下载不会冲掉本机成绩。想上「全站榜」就用这个登录状态（每局结束自动上榜）。");
      if (b === 'github') return siteText("cloud.copy.1cff21a2af5b","GitHub 登录：存档放进你自己的私有 Gist（vampire-survivors__main.json），不经过本站服务器。想上「全站榜」要另外用云账号登录（这条路服务端认不出人）。");
      return siteText("cloud.copy.318e1d96bd4f","云端存的是你自己的私有 Gist（登录 GitHub）或本站云端（云账号）：换设备登录同一个账号就能接着玩。纪录取两边最高，下载不会冲掉本机成绩。想上「全站榜」需要云账号。");
    }
    hint.textContent = hintText();
    /* 云账号只能注册，不能在这里注册（注册要设恢复码，走游戏厅那套 UI）—— 直接把入口摆出来 */
    var hubLink = el('a', 'cloud-link', siteText("cloud.copy.d5f327672fc0","去游戏厅注册 / 登录云账号 →"));
    hubLink.href = '/games/';
    hubLink.target = '_blank';
    hubLink.rel = 'noopener';
    hint.appendChild(document.createTextNode(' '));
    hint.appendChild(hubLink);
    /* 登录/解绑之后后端会变，说明文字要跟着重画（refresh 里调） */
    function refreshHint() { hint.firstChild.nodeValue = hintText() + ' '; }

    /* 云账号登录（名 + 口令）：拿到服务端会话才能在全站榜上榜 */
    var cform = el('div', 'cloud-form');
    cform.hidden = true;
    var cuser = document.createElement('input');
    cuser.type = 'text';
    cuser.id = 'cloudUser';
    (window.I18N ? I18N.bind(cuser,"placeholder",function(){return siteText("cloud.copy.8e748fcece4a","云账号名");}) : cuser.placeholder = siteText("cloud.copy.8e748fcece4a","云账号名"));
    var cpass = document.createElement('input');
    cpass.type = 'password';
    cpass.id = 'cloudPass';
    (window.I18N ? I18N.bind(cpass,"placeholder",function(){return siteText("site.copy.f265a7b34089","口令");}) : cpass.placeholder = siteText("site.copy.f265a7b34089","口令"));
    var cok = el('button', 'cbtn primary', siteText("games.login.do","登录"));
    cok.type = 'button';
    cform.appendChild(cuser);
    cform.appendChild(cpass);
    cform.appendChild(cok);

    root.appendChild(head);
    root.appendChild(btns);
    root.appendChild(form);
    root.appendChild(cform);
    root.appendChild(msg);
    root.appendChild(hint);
    panel.appendChild(root);

    dom = { root: root, ico: ico, status: status, up: up, down: down, sync: sync, login: login, tokenToggle: tokenToggle, form: form, input: input, msg: msg, cform: cform, cuser: cuser, cpass: cpass, hint: hint, refreshHint: refreshHint };

    up.onclick = function () { run(function () { return VS.Cloud.push(); }, siteText("cloud.copy.a72c673c3479","已上传到云端")); };
    down.onclick = function () { run(function () { return VS.Cloud.pull(); }, siteText("cloud.copy.39743eda282a","已从云端合并回来")); };
    sync.onclick = function () { run(function () { return VS.Cloud.sync(); }, siteText("cloud.copy.a838bad72215","双向同步完成")); };
    tokenToggle.onclick = function () { dom.form.hidden = !dom.form.hidden; if (!dom.form.hidden) dom.input.focus(); };
    cloudLogin.onclick = function () { dom.cform.hidden = !dom.cform.hidden; if (!dom.cform.hidden) dom.cuser.focus(); };
    cok.onclick = async function () {
      var n = String(dom.cuser.value || '').trim(), p = String(dom.cpass.value || '');
      if (!n || !p) { note(siteText("cloud.copy.4bd56ef6449c","云账号名与口令都要填"), 'warn'); return; }
      note(siteText("cloud.copy.37020555224e","正在登录云账号…"));
      var r = await VS.Cloud.loginCloud(n, p);
      if (r && r.ok) {
        dom.cpass.value = '';
        dom.cform.hidden = true;
        note(siteText("cloud.copy.1bac83c309d6","云账号已登录：") + (VS.Cloud.who() || n) + siteText("cloud.copy.23d58c376508","（现在能在全站榜上榜了）"), 'ok');
        if (VS.LeaderboardUI) VS.LeaderboardUI.refresh(true);
        if (VS.Cloud.backend && VS.Cloud.backend() === 'server') { run(function () { return VS.Cloud.sync(); }, siteText("cloud.copy.5f814da6354c","已和云端对齐")); return; }
      } else {
        note((r && r.err) || siteText("cloud.copy.e4343921c928","登录失败"), 'bad');
      }
      refresh();
    };

    login.onclick = async function () {
      note(siteText("cloud.copy.1fac8cd2f534","正在向 GitHub 申请设备码…"));
      var r = await VS.Cloud.bindDevice(function (info) {
        note(siteText("cloud.copy.460a2f3ae835","在 GitHub 输入设备码 ") + (info && info.user_code ? info.user_code : '') + siteText("cloud.copy.e4e9a8afd529","（已帮你打开页面）"), 'ok');
        try { window.open(info.verification_uri || 'https://github.com/login/device', '_blank'); } catch (e) { /* 弹窗被挡就自己开 */ }
      });
      if (r && r.ok) { note(siteText("cloud.copy.c3d243c1c0db","登录成功：") + (VS.Cloud.who() || ''), 'ok'); await run(function () { return VS.Cloud.sync(); }, siteText("cloud.copy.5f814da6354c","已和云端对齐")); }
      else if (r) { note((r.err || siteText("cloud.copy.e4343921c928","登录失败")) + siteText("cloud.copy.a066d3c93113","（也可以走「粘贴令牌」那条路）"), 'bad'); }
      refresh();
    };

    ok.onclick = async function () {
      var t = String(dom.input.value || '').trim();
      if (!t) { note(siteText("cloud.copy.cbfa0f2958f2","把令牌粘进来再点绑定"), 'warn'); return; }
      note(siteText("cloud.copy.007d176e78b2","正在校验令牌…"));
      var r = await VS.Cloud.bindToken(t);
      if (r && r.ok) { dom.input.value = ''; dom.form.hidden = true; await run(function () { return VS.Cloud.sync(); }, siteText("cloud.copy.611a89152db0","已登录并和云端对齐")); }
      else note((r && r.err) || siteText("cloud.copy.cdc8411c0d72","绑定失败"), 'bad');
      refresh();
    };

    VS.Cloud.on(function (type, extra) {
      if (type === 'push') note(siteText("cloud.copy.e22622d5d8bb","本机进度已推到云端"), 'ok');
      else if (type === 'pull') note(siteText("cloud.copy.39743eda282a","已从云端合并回来"), 'ok');
      else if (type === 'error') note((extra && (extra.err || extra.message)) || siteText("cloud.copy.4c35be2686df","云端操作失败"), 'bad');
      refresh();
    });

    refresh();

    /* 已登录且绑定了云盘：开局先把两边对齐一次（安静做，失败也不弹） */
    if (!autoDone && VS.Cloud.logged() && VS.Cloud.backend()) {
      autoDone = true;
      VS.Cloud.sync(true).then(function (r) {
        if (r && r.ok) note(siteText("cloud.copy.300d837defdb","已和云端对齐（纪录取两边最高）"), 'ok');
        refresh();
      });
    }
  }

  if(window.I18N) I18N.onChange(refresh);
  var CloudUI = { boot: boot, refresh: refresh, note: note };

  VS.register('CloudUI', CloudUI);

  /* 面板是 DOM 就绪后由 main.js 建的，这里等一个 tick 再挂 */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window.VS = window.VS || {});
