/* 本机练习用控制台入口。长数字按字符串比较，避免 Number 精度损失。 */
(function (VS, global) {
  'use strict';
  var CODE = '314159265358979367679178';

  function level99(code) {
    if (code !== CODE) return { ok: false, message: '作弊码不正确，请使用完整的字符串暗号。' };
    var game = VS.Game.current, S = VS.Game.STATE;
    if (!game || [S.PLAYING, S.PAUSED, S.SHOP, S.PETSELECT, S.RELICSELECT].indexOf(game.state) < 0) {
      return { ok: false, message: '请先开始一局游戏，再输入作弊码。' };
    }
    var count = Math.max(0, 99 - game.player.level);
    if (!count) return { ok: true, level: game.player.level, granted: 0, message: '当前已达到或超过 99 级，不重复发放金币。' };

    var before = game.shop.coins;
    VS.Game.grantLevels(game, count);
    game.cheated = true;
    var coins = game.shop.coins - before;
    if (game.state === S.SHOP && game.deps.panels) game.deps.panels.showShop(game);
    if (game.deps.hud) game.deps.hud.update(game);
    return { ok: true, level: game.player.level, granted: count, coins: coins,
      message: '已升至 99 级，并补发 ' + coins + ' 金币。按 B 打开商店购买强化。本局仅保存本机成绩，不提交全站排行榜。' };

  }

  VS.register('Cheats', { level99: level99 });
  global.bobbychina32747 = level99;
})(window.VS = window.VS || {}, window);
