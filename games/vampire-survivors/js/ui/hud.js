/* ===========================================================
   HUD：血条 / 经验条 / 存活计时 / 波次 / 击杀 / 等级 / 武器栏
   只读 game 状态，不修改它。DOM 查询一次性缓存，避免每帧重查。
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;
  var U = VS.Utils;

  var dom = null;
  var lastWeaponSig = '';

  function el(id) { return document.getElementById(id); }

  /** 把内嵌精灵图设成元素的背景图（拿不到就静默跳过） */
  function setSpriteIcon(node, spriteName) {
    if (!node) return;
    try {
      var def = VS.SpriteData && VS.SpriteData[spriteName];
      if (def && def.uri) {
        node.style.backgroundImage = 'url(' + def.uri + ')';
      }
    } catch (e) {}
  }

  var Hud = {

    init: function (opts) {
      opts = opts || {};
      dom = {
        root: el('hud'),
        hpFill: el('hpFill'),
        hpText: el('hpText'),
        hpBar: el('hpFill') ? el('hpFill').parentNode : null,
        hpIcon: el('hpIcon'),
        xpFill: el('xpFill'),
        xpText: el('xpText'),
        xpIcon: el('xpIcon'),
        timer: el('timer'),
        wave: el('wave'),
        stage: el('stage'),
        phase: el('phase'),
        kills: el('kills'),
        level: el('level'),
        weaponStrip: el('weaponStrip'),
        muteBtn: el('muteBtn'),
        pauseBtn: el('pauseBtn'),

        bossBar: el('bossBar'),
        bossName: el('bossName'),
        bossHpText: el('bossHpText'),
        bossFill: el('bossFill')
      };

      /* 血条/经验条前的图标直接用内嵌的像素精灵，不额外引入图片 */
      setSpriteIcon(dom.hpIcon, 'heart');
      setSpriteIcon(dom.xpIcon, 'gem_0');

      if (dom.muteBtn && opts.onMute) {
        dom.muteBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          opts.onMute();
        });
      }
      if (dom.pauseBtn && opts.onPause) {
        dom.pauseBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          opts.onPause();
        });
      }

      lastWeaponSig = '';
      return Hud;   // 返回模块本身（而不是内部 dom 缓存），调用方需要的是接口
    },

    show: function () {
      if (dom && dom.root) dom.root.classList.remove('hidden');
    },

    hide: function () {
      if (dom && dom.root) dom.root.classList.add('hidden');
      if (dom && dom.bossBar) dom.bossBar.hidden = true;
    },

    setMuted: function (muted) {
      if (!dom || !dom.muteBtn) return;
      dom.muteBtn.textContent = muted ? '✕' : '♪';
      if (muted) dom.muteBtn.classList.add('off');
      else dom.muteBtn.classList.remove('off');
      dom.muteBtn.title = muted ? '取消静音 (M)' : '静音 (M)';
    },

    /** 每帧刷新 */
    update: function (game) {
      if (!dom || !dom.root) return;

      var p = game.player;

      /* --- 血条 --- */
      var hpPct = VS.Player.hpProgress(p) * 100;
      if (dom.hpFill) dom.hpFill.style.width = hpPct.toFixed(1) + '%';
      if (dom.hpText) {
        dom.hpText.textContent = Math.ceil(p.hp) + ' / ' + Math.round(p.maxHp);
      }
      if (dom.hpBar) {
        if (hpPct < 30) dom.hpBar.classList.add('low');
        else dom.hpBar.classList.remove('low');
      }

      /* --- 经验条 --- */
      var xpPct = VS.Player.xpProgress(p) * 100;
      if (dom.xpFill) dom.xpFill.style.width = xpPct.toFixed(1) + '%';
      if (dom.xpText) {
        dom.xpText.textContent = 'Lv.' + p.level + (isFinite(p.xpNeeded)
          ? '　' + Math.floor(p.xp) + ' / ' + p.xpNeeded
          : '　MAX');
      }

      /* --- 数值 --- */
      if (dom.timer) dom.timer.textContent = U.formatTime(game.time);
      if (dom.wave) dom.wave.textContent = String(VS.Enemies.waveFor(game.time));
      if (dom.kills) dom.kills.textContent = U.group(p.kills);
      if (dom.level) dom.level.textContent = String(p.level);

      /* --- 当前关卡（存活计时是按"本关"走的，所以要把关卡摆在旁边） --- */
      if (dom.stage) {
        dom.stage.textContent = String(game.level + 1);
        dom.stage.setAttribute('data-stage', String(game.level + 1));
        if (VS.Levels) {
          var ld = VS.Levels.def(game.level);
          dom.stage.title = VS.Levels.label(game.level) +
            ' · 本关 ' + U.formatTime(ld.duration) + ' 过关';
        }
      }

      /* --- 当前阶段 --- */
      if (dom.phase) {
        var ph = VS.Phases.at(game.time);
        dom.phase.textContent = ph.short || ph.name;
        dom.phase.className = 'v ph-' + ph.id;
      }

      /* --- Boss 实时血条 --- */
      if (dom.bossBar) {
        var boss = game.enemies.boss;

        if (boss && !boss.dead) {
          dom.bossBar.hidden = false;

          var pct = U.clamp(boss.hp / boss.maxHp, 0, 1) * 100;
          if (dom.bossFill) dom.bossFill.style.width = pct.toFixed(2) + '%';
          if (dom.bossHpText) {
            // 用 round 而不是 ceil：血量和上限都是浮点，ceil 会让 7840 显示成 7841
            var cur = Math.min(Math.round(boss.hp), Math.round(boss.maxHp));
            dom.bossHpText.textContent = U.group(cur) + ' / ' + U.group(Math.round(boss.maxHp));
          }
          if (dom.bossName) dom.bossName.textContent = boss.name || '尸潮之王';
        } else {
          dom.bossBar.hidden = true;
        }
      }

      /* --- 武器栏（内容变了才重建 DOM） --- */
      var list = VS.Weapons.listForUI(p);
      var sig = '';
      for (var i = 0; i < list.length; i++) sig += list[i].id + list[i].level + '|';

      /* 宠物那一格也跟着走：猪神的复活次数会变，所以一起进签名 */
      var pet = game.pets;
      var petText = (VS.Pets && VS.Pets.statusText) ? VS.Pets.statusText(pet) : '';
      var petDef = (petText && VS.Pets.def) ? VS.Pets.def(pet.id) : null;
      sig += '#' + petText;

      if (sig !== lastWeaponSig && dom.weaponStrip) {
        lastWeaponSig = sig;

        var html = '';
        for (var j = 0; j < list.length; j++) {
          var w = list[j];
          html += '<span class="wslot">' +
                    '<span style="color:' + w.color + '">' + w.icon + '</span>' +
                    '<span class="nm">' + w.name + '</span>' +
                    '<span class="lv">Lv' + w.level + '</span>' +
                  '</span>';
        }

        if (petDef) {
          html += '<span class="wslot pet" style="--pet-accent:' + (petDef.color || '#ffd166') + '">' +
                    '<span class="ico">' + petDef.icon + '</span>' +
                    '<span class="nm">' + petText + '</span>' +
                  '</span>';
        }

        dom.weaponStrip.innerHTML = html;
      }
    }
  };

  VS.register('Hud', Hud);

})(window.VS = window.VS || {});
