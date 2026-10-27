/* bobbycn.cc 公共脚本：主题切换 + 登录态（2026-09-28）
 * 依赖 /assets/site.css。页面里放：
 *   <button class="iconbtn" id="btnTheme">☾ 深色</button>
 *   <span class="me" id="meBox" hidden><b id="meName"></b><button class="iconbtn" id="btnOut">退出</button></span>
 *   <a class="iconbtn" id="btnIn" href="/login/">登录</a>
 * 会话是域级 Cookie（Domain=.bobbycn.cc），所以所有子域共享同一份登录态。
 */
(function () {
    var KEY = 'site-theme';
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    var theme = (saved === 'light' || saved === 'dark') ? saved : 'dark';   // 深色默认
    function apply(t) {
        document.documentElement.setAttribute('data-theme', t);
        var b = document.getElementById('btnTheme');
        if (b) I18N.bind(b, "textContent", function(){return t === 'dark' ? I18N.t("site.copy.e2ff2b4b22e4") : I18N.t("site.copy.71bca47baab4");});
    }
    apply(theme);
    if (window.I18N) I18N.onChange(function () { apply(theme); });
    var btn = document.getElementById('btnTheme');
    if (btn) btn.addEventListener('click', function () {
        theme = theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(KEY, theme); } catch (e) {}
        apply(theme);
    });

    function syncTheme() {
        var next;
        try { next = localStorage.getItem(KEY); } catch (e) { return; }
        theme = next === 'light' || next === 'dark' ? next : 'dark';
        apply(theme);
    }
    window.addEventListener('storage', function (event) { if (event.key === KEY || event.key === null) syncTheme(); });
    window.addEventListener('pageshow', syncTheme);

    /** 顶栏私线入口：只在「站主 / 受邀账号」的登录态下出现，普通用户看不到 */
    function injectChatLink() {
        var actions = document.querySelector('.header-actions');
        if (!actions || document.getElementById('navChat')) return;
        var a = document.createElement('a');
        a.id = 'navChat';
        a.className = 'iconbtn';
        a.href = '/chat/';
        // 提示语可能还没进到当前页面的词典（词典按页缓存）：拿不到词条就退中文，别把 key 显示出来
        var label = function () {
            var key = 'chat.nav';
            var text = window.I18N && I18N.t ? I18N.t(key) : key;
            return text && text !== key ? text : '对话';
        };
        if (window.I18N && I18N.bind) I18N.bind(a, 'textContent', label);
        else a.textContent = label();
        var before = document.getElementById('btnIn') || null;
        if (before && before.parentNode === actions) actions.insertBefore(a, before);
        else actions.appendChild(a);
    }

    var box = document.getElementById('meBox');
    var nameEl = document.getElementById('meName');
    var btnIn = document.getElementById('btnIn');
    var btnReg = document.getElementById('btnReg');
    if (box || btnIn) {
        var sessionReady = fetch('/api/auth/identity/me', { credentials: 'same-origin', cache: 'no-store' })
            .then(function (r) { if (!r.ok) throw 0; return r.json(); })
            .then(function (d) {
                if (!d || !d.email) throw 0;
                if (nameEl) nameEl.textContent = d.username || String(d.email).split('@')[0];
                if (box) box.hidden = false;
                if (btnIn) btnIn.hidden = true;
                if (btnReg) btnReg.hidden = true;   // 已登录就别再摆"注册"了
                // 2026-10-27：站主与受邀账号（role=subadmin）在任意页面顶栏都能直接进私线
                if (d.isOwner || d.role === 'subadmin') injectChatLink();
                return d;
            })
            .catch(function () { return null; });
        window.SiteSession = { ready: sessionReady };
        var out = document.getElementById('btnOut');
        if (out) out.addEventListener('click', function () {
            if (typeof window.siteLogout === 'function') { window.siteLogout(); return; }
            fetch('/api/auth/identity/logout', { method: 'POST', credentials: 'same-origin' })
                .then(function () { location.reload(); });
        });
    }
})();
