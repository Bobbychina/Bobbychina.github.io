/* 统一站点身份；仅连接排行榜，不读取或上传游戏存档。 */
(function (VS) {
  'use strict';
  var GAME = 'vampire-survivors', SCOPE = 'openid profile arcade';
  var dom = null, busy = false, lastError = '', forceBridge = false;
  function snapshot() {
    try {
      var s = window.SiteAuth ? window.SiteAuth.status() : {};
      return { signedIn: !!s.signedIn && s.clientId === GAME, user: s.user || null, expired: !!s.expired };
    } catch (e) { return { signedIn: false, user: null }; }
  }
  function linked() {
    var s = snapshot(), account = window.DSHAccount;
    try { return !busy && !lastError && s.signedIn && !!s.user && !!s.user.sub && !!account &&
      String(account.siteIdentity()) === String(s.user.sub) && !!account.sessionToken(); }
    catch (e) { return false; }
  }
  function render() {
    if (!dom) return;
    var s = snapshot(), user = s.user;
    dom.name.textContent = s.signedIn && user ? (user.name || user.username || '站点玩家') : '站点账号';
    dom.status.textContent = lastError || (busy ? '正在连接账号…' : linked() ? '已登录 · 战役结束自动提交成绩' :
      s.signedIn ? '已登录站点 · 连接后可提交排行榜' : s.expired ? '登录已过期，请重新授权' : '游客 · 可直接开始游戏');
    dom.status.className = lastError ? 'account-error' : '';
    dom.login.textContent = s.signedIn ? '连接排行榜' : '站点账号登录';
    dom.login.hidden = linked(); dom.login.disabled = busy;
    dom.logout.hidden = !s.signedIn; dom.logout.disabled = busy;
    dom.page.hidden = !lastError; dom.page.disabled = busy;
  }
  async function connect() {
    var auth = window.SiteAuth, account = window.DSHAccount;
    if (!auth || !account) throw new Error('账号组件未加载，请刷新页面');
    var s = snapshot();
    if (!s.signedIn) await auth.signInPopup({ game: GAME, scope: SCOPE });
    var user = await auth.refreshProfile({ game: GAME });
    s = snapshot();
    if (!s.signedIn || !user || !user.sub) throw new Error('未完成站点账号授权，请重试');
    // 旧排行榜凭据来自站点 Cookie；必须与当前游戏授权身份一致。
    var session = await auth.siteSession();
    if (!session || String(session.id || session.sub || '') !== String(user.sub)) {
      throw new Error('站点登录状态已变化，请点「整页登录」重新授权');
    }
    if (account.current() && (forceBridge || String(account.siteIdentity()) !== String(user.sub) || !account.sessionToken())) await account.logout();
    var result = await account.signInSite();
    if (!result || !result.ok) throw new Error((result && (result.hint || result.err)) || '排行榜连接失败，请稍后重试');
    var current = snapshot();
    session = await auth.siteSession();
    if (!current.signedIn || !current.user || String(current.user.sub) !== String(user.sub) ||
        !session || String(session.id || session.sub || '') !== String(user.sub) ||
        String(account.siteIdentity()) !== String(user.sub) || !account.sessionToken()) {
      await account.logout();
      throw new Error('账号已变化或连接未完成，请重新登录');
    }
    forceBridge = false;
  }
  async function login() {
    if (busy) return;
    busy = true; lastError = ''; render();
    try { await connect(); }
    catch (e) { lastError = e.message || '登录失败，请重试'; }
    finally { busy = false; render(); }
    if (VS.LeaderboardUI) VS.LeaderboardUI.refresh(true);
  }
  async function logout() {
    if (busy || !window.SiteAuth) return;
    busy = true; lastError = ''; render();
    try { await window.SiteAuth.signOut({ game: GAME, global: false }); }
    catch (e) { lastError = e.message || '退出失败，请重试'; }
    finally { busy = false; render(); }
    if (VS.LeaderboardUI) VS.LeaderboardUI.refresh(true);
  }
  function build() {
    var root = document.getElementById('siteAccount');
    if (!root || dom) return;
    dom = { root: root, name: document.getElementById('accountName'), status: document.getElementById('accountStatus'),
      login: document.getElementById('accountLogin'), page: document.getElementById('accountPageLogin'), logout: document.getElementById('accountLogout') };
    dom.login.addEventListener('click', login); dom.logout.addEventListener('click', logout);
    dom.page.addEventListener('click', function () {
      if (busy || !window.SiteAuth) return;
      window.SiteAuth.signIn({ game: GAME, scope: SCOPE }).catch(function (e) { lastError = e.message; render(); });
    });
    if (window.SiteAuth) {
      window.SiteAuth.onChange(render);
      window.SiteAuth.ready().then(render).catch(function () { lastError = '暂时无法连接站点账号，仍可离线游玩'; render(); });
    }
    if (window.DSHAccount && window.DSHAccount.onChange) window.DSHAccount.onChange(render);
    window.addEventListener('storage', render);
    window.addEventListener('focus', render);
    render();
  }
  VS.register('SiteAccount', { build: build, login: login, logout: logout, isLinked: linked, snapshot: snapshot,
    invalidate: function () { forceBridge = true; lastError = '排行榜登录已过期，请重新连接'; render(); },
    focus: function () { if (dom) { dom.root.scrollIntoView({ block: 'center', behavior: 'smooth' }); dom.login.focus(); } } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})(window.VS = window.VS || {});
