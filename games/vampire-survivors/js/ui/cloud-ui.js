/* ===========================================================
   云存档界面：开始面板里的一行「☁ 云存档」
   —— 登录态、上传/下载/同步按钮、粘贴令牌的兜底入口；
   所有动作都交给 VS.Cloud（它再转给站点账号库 /games/account.js）。
   没有账号库时不生成这一行，游戏完全不受影响。
   =========================================================== */
(function (VS) {
  'use strict';

  var dom = null;
  var autoDone = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function note(text, kind) {
    if (!dom || !dom.msg) return;
    dom.msg.textContent = text || '';
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
  }

  function busy(on, what) {
    if (!dom) return;
    dom.up.disabled = on || dom.up.disabled;
    if (on) note(what || '正在和云端说话…');
  }

  async function run(fn, okText, quiet) {
    if (!dom) return;
    dom.root.classList.add('working');
    note('正在和云端说话…');
    var r = await fn();
    dom.root.classList.remove('working');
    if (r && r.ok) {
      note(okText || '完成' + (VS.Cloud.lastSync() ? '（' + VS.Cloud.lastSync().replace('T', ' ').slice(0, 16) + '）' : ''), 'ok');
    } else if (r && r.needLogin) {
      note('先在上面登录 GitHub，再点这个按钮', 'warn');
    } else {
      note((r && r.err) || '失败了', 'bad');
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
    var up = el('button', 'cbtn', '⬆ 上传存档');
    var down = el('button', 'cbtn', '⬇ 下载存档');
    var sync = el('button', 'cbtn', '⇅ 双向同步');
    var login = el('button', 'cbtn primary', '用 GitHub 登录');
    var tokenToggle = el('button', 'cbtn ghost', '粘贴令牌');
    var cloudLogin = el('button', 'cbtn ghost', '云账号登录');
    [up, down, sync, login, tokenToggle, cloudLogin].forEach(function (b) { b.type = 'button'; btns.appendChild(b); });

    var form = el('div', 'cloud-form');
    form.hidden = true;
    var input = document.createElement('input');
    input.type = 'password';
    input.id = 'cloudToken';
    input.placeholder = '粘贴 GitHub 令牌（gist 权限）';
    var ok = el('button', 'cbtn primary', '绑定');
    ok.type = 'button';
    var link = el('a', 'cloud-link', '去创建令牌');
    link.href = VS.Cloud.tokenUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    form.appendChild(input);
    form.appendChild(ok);
    form.appendChild(link);

    var msg = el('p', 'cloud-msg', '');
    var hint = el('p', 'cloud-hint', '云端存的是你自己的私有 Gist（vampire-survivors__main.json）：换设备登录同一个 GitHub 就能接着玩。纪录取两边最高，下载不会冲掉本机成绩。想上「全站榜」要另外用云账号登录（GitHub 登录的存档不经过服务端）。');
    /* 云账号只能注册，不能在这里注册（注册要设恢复码，走游戏厅那套 UI）—— 直接把入口摆出来 */
    var hubLink = el('a', 'cloud-link', '去游戏厅注册 / 登录云账号 →');
    hubLink.href = '/games/';
    hubLink.target = '_blank';
    hubLink.rel = 'noopener';
    hint.appendChild(document.createTextNode(' '));
    hint.appendChild(hubLink);

    /* 云账号登录（名 + 口令）：拿到服务端会话才能在全站榜上榜 */
    var cform = el('div', 'cloud-form');
    cform.hidden = true;
    var cuser = document.createElement('input');
    cuser.type = 'text';
    cuser.id = 'cloudUser';
    cuser.placeholder = '云账号名';
    var cpass = document.createElement('input');
    cpass.type = 'password';
    cpass.id = 'cloudPass';
    cpass.placeholder = '口令';
    var cok = el('button', 'cbtn primary', '登录');
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

    dom = { root: root, ico: ico, status: status, up: up, down: down, sync: sync, login: login, tokenToggle: tokenToggle, form: form, input: input, msg: msg, cform: cform, cuser: cuser, cpass: cpass };

    up.onclick = function () { run(function () { return VS.Cloud.push(); }, '已上传到云端'); };
    down.onclick = function () { run(function () { return VS.Cloud.pull(); }, '已从云端合并回来'); };
    sync.onclick = function () { run(function () { return VS.Cloud.sync(); }, '双向同步完成'); };
    tokenToggle.onclick = function () { dom.form.hidden = !dom.form.hidden; if (!dom.form.hidden) dom.input.focus(); };
    cloudLogin.onclick = function () { dom.cform.hidden = !dom.cform.hidden; if (!dom.cform.hidden) dom.cuser.focus(); };
    cok.onclick = async function () {
      var n = String(dom.cuser.value || '').trim(), p = String(dom.cpass.value || '');
      if (!n || !p) { note('云账号名与口令都要填', 'warn'); return; }
      note('正在登录云账号…');
      var r = await VS.Cloud.loginCloud(n, p);
      if (r && r.ok) {
        dom.cpass.value = '';
        dom.cform.hidden = true;
        note('云账号已登录：' + (VS.Cloud.who() || n) + '（现在能在全站榜上榜了）', 'ok');
        if (VS.LeaderboardUI) VS.LeaderboardUI.refresh(true);
        if (VS.Cloud.backend && VS.Cloud.backend() === 'server') { run(function () { return VS.Cloud.sync(); }, '已和云端对齐'); return; }
      } else {
        note((r && r.err) || '登录失败', 'bad');
      }
      refresh();
    };

    login.onclick = async function () {
      note('正在向 GitHub 申请设备码…');
      var r = await VS.Cloud.bindDevice(function (info) {
        note('在 GitHub 输入设备码 ' + (info && info.user_code ? info.user_code : '') + '（已帮你打开页面）', 'ok');
        try { window.open(info.verification_uri || 'https://github.com/login/device', '_blank'); } catch (e) { /* 弹窗被挡就自己开 */ }
      });
      if (r && r.ok) { note('登录成功：' + (VS.Cloud.who() || ''), 'ok'); await run(function () { return VS.Cloud.sync(); }, '已和云端对齐'); }
      else if (r) { note((r.err || '登录失败') + '（也可以走「粘贴令牌」那条路）', 'bad'); }
      refresh();
    };

    ok.onclick = async function () {
      var t = String(dom.input.value || '').trim();
      if (!t) { note('把令牌粘进来再点绑定', 'warn'); return; }
      note('正在校验令牌…');
      var r = await VS.Cloud.bindToken(t);
      if (r && r.ok) { dom.input.value = ''; dom.form.hidden = true; await run(function () { return VS.Cloud.sync(); }, '已登录并和云端对齐'); }
      else note((r && r.err) || '绑定失败', 'bad');
      refresh();
    };

    VS.Cloud.on(function (type, extra) {
      if (type === 'push') note('本机进度已推到云端', 'ok');
      else if (type === 'pull') note('已从云端合并回来', 'ok');
      else if (type === 'error') note((extra && (extra.err || extra.message)) || '云端操作失败', 'bad');
      refresh();
    });

    refresh();

    /* 已登录且绑定了云盘：开局先把两边对齐一次（安静做，失败也不弹） */
    if (!autoDone && VS.Cloud.logged() && VS.Cloud.backend()) {
      autoDone = true;
      VS.Cloud.sync(true).then(function (r) {
        if (r && r.ok) note('已和云端对齐（纪录取两边最高）', 'ok');
        refresh();
      });
    }
  }

  var CloudUI = { boot: boot, refresh: refresh, note: note };

  VS.register('CloudUI', CloudUI);

  /* 面板是 DOM 就绪后由 main.js 建的，这里等一个 tick 再挂 */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window.VS = window.VS || {});
