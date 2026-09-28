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
        if (b) b.textContent = t === 'dark' ? '☾ 深色' : '☀ 浅色';
    }
    apply(theme);
    var btn = document.getElementById('btnTheme');
    if (btn) btn.addEventListener('click', function () {
        theme = theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(KEY, theme); } catch (e) {}
        apply(theme);
    });

    var box = document.getElementById('meBox');
    var nameEl = document.getElementById('meName');
    var btnIn = document.getElementById('btnIn');
    if (box || btnIn) {
        fetch('/api/auth/identity/me', { credentials: 'same-origin' })
            .then(function (r) { if (!r.ok) throw 0; return r.json(); })
            .then(function (d) {
                if (!d || !d.email) throw 0;
                if (nameEl) nameEl.textContent = d.username || String(d.email).split('@')[0];
                if (box) box.hidden = false;
                if (btnIn) btnIn.hidden = true;
            })
            .catch(function () { /* 未登录：保留"登录"入口 */ });
        var out = document.getElementById('btnOut');
        if (out) out.addEventListener('click', function () {
            fetch('/api/auth/identity/logout', { method: 'POST', credentials: 'same-origin' })
                .then(function () { location.reload(); });
        });
    }
})();
