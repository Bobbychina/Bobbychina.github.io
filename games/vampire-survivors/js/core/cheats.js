/* 本机练习用控制台入口。长数字按字符串比较，避免 Number 精度损失。 */
(function (VS, global) {
  'use strict';
  var CODE = '314159265358979367679178';

  function level99(code) {
    if (code !== CODE) return { ok: false, message: '作弊码不正确，请使用完整的字符串暗号。' };
    var game = VS.Game.current, S = VS.Game.STATE;
    if (!game || [S.PLAYING, S.PAUSED, S.LEVELUP, S.PETSELECT].indexOf(game.state) < 0) {
      return { ok: false, message: '请先开始一局游戏，再输入作弊码。' };
    }
    var count = Math.max(0, 99 - game.player.level);
    if (!count) return { ok: true, level: game.player.level, granted: 0, message: '当前已达到或超过 99 级，不重复发放升级。' };

    VS.Game.grantDraftCards(game, count);
    game.cheated = true;
    if (game.state === S.PLAYING || game.state === S.PAUSED) {
      VS.Game.openLevelUp(game);
    } else if (game.state === S.LEVELUP && game.deps.panels) {
      // 保留正在展示的卡，追加次数不产生免费重选。
      game.deps.panels.showLevelUp(game.choices, game.player.level, game);
    }
    if (game.deps.hud) game.deps.hud.update(game);
    return { ok: true, level: game.player.level, granted: count, pendingChoices: game.pendingLevels,
      message: '已升至 99 级，升级选卡已补齐。本局仅保存本机成绩，不提交全站排行榜。' };
  }

  VS.register('Cheats', { level99: level99 });
  global.bobbychina32747 = level99;
})(window.VS = window.VS || {}, window);
