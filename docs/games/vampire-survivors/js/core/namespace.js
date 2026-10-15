/* ===========================================================
   命名空间
   本项目使用"经典 script + 全局命名空间"而不是 ES Module，
   因为浏览器会以 CORS 为由拦截 file:// 下的 import，
   那样双击 index.html 必然白屏。用普通 <script> 顺序加载，
   双击能跑，挂到 HTTP 服务器上也能跑。
   =========================================================== */
(function (global) {
  'use strict';

  var VS = global.VS || (global.VS = {});

  VS.VERSION = '1.0.0';

  /** 已注册的模块名，便于排查加载顺序问题 */
  VS.loaded = [];

  /** 注册一个模块；重复注册同名模块会直接返回已有实例 */
  VS.register = function (name, mod) {
    if (Object.prototype.hasOwnProperty.call(VS, name)) return VS[name];
    VS[name] = mod;
    VS.loaded.push(name);
    return mod;
  };

})(typeof window !== 'undefined' ? window : this);
