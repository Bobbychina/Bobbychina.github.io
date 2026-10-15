/* ===========================================================
   「尸潮之王」招式引擎（M-VS 站长报障：原来只会走过来撞人）
   ---------------------------------------------------------------------------
   招式表与三档血量都在 C.BOSS（config.js）里，这里只做状态机与结算：

        idle（追人 + 倒计时）──cd 到──▶ telegraph（前摇：站住、亮光环）
              ▲                              │ 前摇结束
              │                              ▼
              └──cd = 招式冷却 × 档位倍率── busy（施放：弹幕 / 召唤 / 冲撞）

   三条硬规则：
     ① **前摇必须看得见**：telegraph 期间 Boss 不动、渲染层画一圈该招式的颜色光环 ——
        没有前摇的弹幕在像素风里等于"随机掉血"，玩家学不会躲。
     ② **弹幕有上限**（C.BOSS.SHOT_MAX）：到顶就不再发射，宁可少打两发也不让帧率掉下去。
     ③ **小弟有上限**（C.BOSS.MINION_MAX）：召唤按"场上还差几只"补，不叠加、不无限堆。

   弹幕对象：{ x, y, vx, vy, r, dmg, life, age, tone } —— 更新/碰撞/回收全在这里，
   渲染只读数组（renderer.js 用预渲染好的小球贴图，别在绘制里新建渐变）。
   =========================================================== */
(function (VS) {
  'use strict';

  function cfg() { return VS.Config.BOSS; }
  function shotsOf(game) { if (!game.bossShots) game.bossShots = []; return game.bossShots; }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* ---------------- 档位 ---------------- */

  function phaseIndex(boss) {
    var frac = boss.maxHp > 0 ? (boss.hp / boss.maxHp) : 0;
    var list = cfg().PHASES;
    /* 从最凶的一档往回找：命中「血量已跌破该档阈值」的最严重那一档。
       （正着写会因为第一档 at=1.00 永远命中，等于永远停在 压制 —— 探针⑦逮住过这个 bug） */
    for (var i = list.length - 1; i >= 0; i--) if (frac <= list[i].at) return i;
    return 0;
  }

  function init(boss) {
    if (boss.ai) return boss.ai;
    boss.ai = {
      phaseIdx: -1, phase: null, state: 'idle',
      t: 0,             // 当前状态剩余时间
      cd: 1.8,          // 距离下一次出手
      move: 'ring',     // 上一招（避免连着放同一招）
      dirX: 0, dirY: 0, // 冲撞方向
      emit: 0,          // 螺旋弹幕的发射节拍
      spin: 0,          // 环形弹幕的旋转相位
      shots: 0,         // 本次施放已经打了多少发
      phaseName: '',

      /* 护盾阶段（M-VS 加强）：血量跌破阈值 → 无敌 + 召唤一波，清完才破盾 */
      shieldAt: (VS.Config.BOSS.SHIELD && VS.Config.BOSS.SHIELD.AT ? VS.Config.BOSS.SHIELD.AT.slice() : []),
      shield: null,     // { need: 这一波还有几只没死 }
      invuln: 0,        // > 0 时 Boss 免疫伤害
      vulnBonus: 1,     // 虚弱期受伤倍率
      laser: null,      // { ang, t, dir } 激光横扫状态
      meteors: [],      // [{ x, y, t, dmg, radius }]
      meteorTick: 0,
      enraged: false
    };
    return boss.ai;
  }

  /* ---------------- 护盾 / 弱化窗口 ---------------- */

  function checkShield(boss, ai, game) {
    var cfgS = cfg().SHIELD;
    if (!cfgS || !ai.shieldAt.length) return;
    var frac = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
    if (frac > ai.shieldAt[0]) return;

    var idx = (cfgS.AT.length - ai.shieldAt.length);           // 第几档
    ai.shieldAt.shift();
    var wave = cfgS.WAVE[idx] || cfgS.WAVE[0];
    ai.shield = { need: wave };
    ai.invuln = 999;                                           // 破盾前一直免疫
    ai.vulnBonus = 1;
    ai.state = 'idle';
    ai.cd = 0.6;
    VS.Enemies.summonMinions(game.enemies, wave, game, boss.x, boss.y);
    VS.Effects.burst(game.fx, boss.x, boss.y, '#9fd6ff', 40, { speed: 260, life: 0.8, size: 3.6 });
    game.shake = Math.max(game.shake || 0, 10);
    VS.Audio.play('over');
  }

  function updateShield(boss, ai, game) {
    if (!ai.shield) return;
    var alive = 0;
    var list = game.enemies.list;
    for (var i = 0; i < list.length; i++) { var e = list[i]; if (!e.dead && !e.boss) alive++; }
    if (alive > 0) return;
    /* 破盾：给一段虚弱期（受伤加成），这是玩家的输出窗口 */
    var s = cfg().SHIELD;
    ai.shield = null;
    ai.invuln = 0;
    ai.vulnBonus = s.VULN_BONUS || 1.3;
    ai.weakT = s.IFRAME || 2.5;
    ai.state = 'idle';
    ai.cd = 0;
    VS.Effects.explosion(game.fx, boss.x, boss.y, 2.6);
    VS.Effects.burst(game.fx, boss.x, boss.y, '#ffd166', 34, { speed: 300, life: 0.9, size: 4 });
    game.shake = Math.max(game.shake || 0, 12);
  }

  function updateEnrage(boss, ai, game) {
    var e = cfg().ENRAGE;
    if (!e || ai.enraged) return;
    if (boss.maxHp > 0 && boss.hp / boss.maxHp <= e.AT) {
      ai.enraged = true;
      ai.cd = 0.4;
      VS.Effects.burst(game.fx, boss.x, boss.y, '#ff5d5d', 46, { speed: 320, life: 1.0, size: 4.2 });
      VS.Effects.explosion(game.fx, boss.x, boss.y, 3.0);
      game.shake = Math.max(game.shake || 0, 16);
      VS.Audio.play('over');
    }
  }

  function pickMove(ai, phase) {
    var pool = phase.pool;
    var pick = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && pick === ai.move) {           // 尽量避免"同一招连着放"
      var other = pool.filter(function (id) { return id !== ai.move; });
      if (Math.random() < 0.75) pick = other[Math.floor(Math.random() * other.length)];
    }
    return pick;
  }

  /* ---------------- 弹幕 ---------------- */

  function shot(game, boss, m, ang, speed, dmg) {
    var list = shotsOf(game);
    if (list.length >= cfg().SHOT_MAX) return false;
    var s = m.shots;
    var mul = (boss.ai && boss.ai.enraged && cfg().ENRAGE) ? cfg().ENRAGE.SHOT_DMG_MUL : 1;
    list.push({
      x: boss.x + Math.cos(ang) * (boss.radius * 0.6),
      y: boss.y + Math.sin(ang) * (boss.radius * 0.6),
      vx: Math.cos(ang) * (speed || s.speed),
      vy: Math.sin(ang) * (speed || s.speed),
      r: s.r, dmg: (dmg || s.dmg) * mul, life: s.life, age: 0, tone: m.tone
    });
    return true;
  }

  function execMove(boss, ai, game, move) {
    var m = cfg().MOVES[move];
    var p = game.player;

    if (move === 'ring') {
      var n = m.shots.n;
      for (var i = 0; i < n; i++) {
        shot(game, boss, m, ai.spin + (i / n) * Math.PI * 2);
      }
      ai.spin += m.shots.spin;                            // 每轮错开一点，别总打同一条线
      VS.Audio.play('hit');
      return;
    }

    if (move === 'spread') {
      var base = Math.atan2(p.y - boss.y, p.x - boss.x);   // 前摇结束那一刻才锁定方向（能躲）
      var n2 = m.shots.n, arc = m.shots.arc;
      for (var k = 0; k < n2; k++) {
        shot(game, boss, m, base + (k - (n2 - 1) / 2) * (arc / Math.max(1, n2 - 1)));
      }
      VS.Audio.play('hit');
      return;
    }

    if (move === 'summon') {
      var state = game.enemies;
      var want = Math.min(m.minions, cfg().MINION_MAX);
      var live = 0;
      for (var j = 0; j < state.list.length; j++) if (!state.list[j].dead && !state.list[j].boss) live++;
      var add = Math.max(0, Math.min(want, cfg().MINION_MAX - live));
      if (VS.Enemies.summonMinions && add > 0) {
        VS.Enemies.summonMinions(state, add, game, boss.x, boss.y);
        VS.Effects.burst(game.fx, boss.x, boss.y, m.tone, 26, { speed: 200, life: 0.7, size: 3.4 });
        VS.Audio.play('over');
      }
      return;
    }

    if (move === 'charge') {
      var a = Math.atan2(p.y - boss.y, p.x - boss.x);
      ai.dirX = Math.cos(a); ai.dirY = Math.sin(a);
      VS.Audio.play('over');
      return;
    }

    if (move === 'laser') {
      /* 起始角度指向玩家，然后横扫 —— 玩家要判断扫向哪边再横向闪开 */
      var la = Math.atan2(p.y - boss.y, p.x - boss.x);
      ai.laser = { ang: la - (m.laser.sweep * (m.busy || 1)) / 2, t: m.busy || 1.3, dir: 1, tick: 0 };
      VS.Audio.play('over');
      return;
    }

    if (move === 'meteor') {
      ai.meteorTick = 0;
      ai.meteorLeft = m.meteor.count;
      VS.Audio.play('hit');
      return;
    }
  }

  /* 激光横扫：一条从 Boss 出发的长射线，边扫边判定；宽度 26px，逼玩家横向走位 */
  function updateLaser(boss, ai, game, dt) {
    var l = ai.laser;
    if (!l) return;
    var m = cfg().MOVES.laser;
    l.t -= dt;
    l.ang += (m.laser.sweep || 2) * dt * l.dir;
    l.tick -= dt;

    var p = game.player;
    if (p.alive && l.tick <= 0) {
      var ux = Math.cos(l.ang), uy = Math.sin(l.ang);
      var dx = p.x - boss.x, dy = p.y - boss.y;
      var proj = dx * ux + dy * uy;
      if (proj > 0 && proj < (m.laser.len || 520)) {
        var cx = boss.x + ux * proj, cy = boss.y + uy * proj;
        var dist = Math.hypot(p.x - cx, p.y - cy);
        if (dist <= (m.laser.width || 26) / 2 + p.radius) {
          l.tick = 0.25;                                   // 同一条激光里的连续伤害节流
          VS.Player.takeDamage(p, (m.laser.dmg || 30) * (ai.enraged ? cfg().ENRAGE.SHOT_DMG_MUL : 1), game, cx, cy);
        }
      }
    }

    if (l.t <= 0) ai.laser = null;
  }

  /* 落石：按节拍在玩家当前位置留标记，延迟后炸开 —— 站桩输出就会被连着炸 */
  function updateMeteors(boss, ai, game, dt) {
    var m = cfg().MOVES.meteor;
    if (ai.meteorLeft > 0) {
      ai.meteorTick -= dt;
      if (ai.meteorTick <= 0) {
        ai.meteorTick = m.meteor.every;
        ai.meteorLeft--;
        var p = game.player;
        /* 稍微预判一点（按玩家当前速度向前 0.35 秒），逼玩家变向 */
        var lead = 0.35;
        var tx = p.x + (p.facing.x * p.speed * (p.moving ? lead : 0));
        var ty = p.y + (p.facing.y * p.speed * (p.moving ? lead : 0));
        ai.meteors.push({ x: tx, y: ty, t: m.meteor.delay, radius: m.meteor.radius, dmg: m.meteor.dmg });
      }
    }
    for (var i = ai.meteors.length - 1; i >= 0; i--) {
      var mt = ai.meteors[i];
      mt.t -= dt;
      if (mt.t > 0) continue;
      var pl = game.player;
      if (pl.alive && Math.hypot(pl.x - mt.x, pl.y - mt.y) <= mt.radius) {
        VS.Player.takeDamage(pl, mt.dmg, game, mt.x, mt.y);
      }
      VS.Effects.burst(game.fx, mt.x, mt.y, m.tone, 18, { speed: 220, life: 0.5, size: 3.4 });
      game.shake = Math.max(game.shake || 0, 4);
      ai.meteors.splice(i, 1);
    }
  }

  function fireSpiral(boss, ai, game, m, dt) {
    ai.emit -= dt;
    if (ai.emit > 0) return;
    ai.emit = m.shots.every;
    ai.spin += m.shots.turn * m.shots.every;             // 每发转一点 → 螺旋
    shot(game, boss, m, ai.spin);
    shot(game, boss, m, ai.spin + Math.PI);              // 对称两股，更好看也更好躲
  }

  /* ---------------- 每帧：状态机 + 移动（enemies.js 把 Boss 的移动交给这里） ---------------- */

  function step(boss, dt, game) {
    var ai = init(boss);
    var p = game.player;
    var B = cfg();

    /* 加强版 Boss 的三件事每帧都要看：狂暴 / 护盾触发 / 护盾是否被打破 */
    updateEnrage(boss, ai, game);
    checkShield(boss, ai, game);
    updateShield(boss, ai, game);
    if (ai.weakT > 0) { ai.weakT -= dt; if (ai.weakT <= 0) ai.vulnBonus = 1; }
    if (ai.laser) updateLaser(boss, ai, game, dt);
    updateMeteors(boss, ai, game, dt);

    var idx = phaseIndex(boss);
    if (idx !== ai.phaseIdx) {
      ai.phaseIdx = idx;
      ai.phase = cfg().PHASES[idx];
      ai.phaseName = ai.phase.name;
      ai.cd = Math.min(ai.cd, 0.9);                       // 换档时立刻给一次出手机会
      /* 换档提示：一圈冲击 + 抖动，玩家能感到"它变凶了" */
      VS.Effects.burst(game.fx, boss.x, boss.y, '#ff9a6c', 22, { speed: 240, life: 0.6, size: 3.2 });
      game.shake = Math.max(game.shake || 0, 6);
    }
    var ph = ai.phase;
    var enr = ai.enraged ? (B.ENRAGE || { CD_MUL: 1, SPEED_MUL: 1 }) : { CD_MUL: 1, SPEED_MUL: 1 };

    /* 护盾期：不放招，只慢慢追过来（玩家该去清小怪，而不是站在原地挨打） */
    if (ai.shield) {
      var sx = p.x - boss.x, sy = p.y - boss.y;
      var sd = Math.sqrt(sx * sx + sy * sy) || 1;
      boss.x += (sx / sd) * boss.speed * 0.7 * dt;
      boss.y += (sy / sd) * boss.speed * 0.7 * dt;
      return;
    }

    if (ai.state === 'idle') {
      /* 追人（速度按档位 × 狂暴加成） */
      var dx = p.x - boss.x, dy = p.y - boss.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var sp = boss.speed * ph.speedMul * enr.SPEED_MUL;
      boss.x += (dx / d) * sp * dt;
      boss.y += (dy / d) * sp * dt;

      ai.cd -= dt;
      if (ai.cd <= 0) {
        ai.move = pickMove(ai, ph);
        ai.state = 'telegraph';
        ai.t = cfg().MOVES[ai.move].telegraph;
        ai.shots = 0;
        ai.emit = 0;
      }
      return;
    }

    if (ai.state === 'telegraph') {
      ai.t -= dt;
      if (ai.t <= 0) {
        execMove(boss, ai, game, ai.move);
        ai.state = 'busy';
        ai.t = cfg().MOVES[ai.move].busy;
      }
      return;
    }

    /* busy：施放中 */
    ai.t -= dt;
    if (ai.move === 'charge') {
      boss.x += ai.dirX * cfg().MOVES.charge.speed * dt;
      boss.y += ai.dirY * cfg().MOVES.charge.speed * dt;
      VS.Effects.burst(game.fx, boss.x, boss.y, '#ff6b6b', 2, { speed: 60, life: 0.28, size: 2.4 });
    } else if (ai.move === 'spiral') {
      fireSpiral(boss, ai, game, cfg().MOVES.spiral, dt);
    }
    if (ai.t <= 0) {
      ai.state = 'idle';
      ai.cd = cfg().MOVES[ai.move].cd * ph.cdMul * enr.CD_MUL;
    }
  }

  /* ---------------- 弹幕更新（伤害与回收都在这儿） ---------------- */

  function updateShots(game, dt) {
    var list = shotsOf(game);
    if (!list.length) return;
    var p = game.player, world = game.world;
    var pad = world.pad, maxX = world.w - pad, maxY = world.h - pad;

    for (var i = list.length - 1; i >= 0; i--) {
      var s = list[i];
      s.age += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      if (s.age >= s.life || s.x < pad - 40 || s.x > maxX + 40 || s.y < pad - 40 || s.y > maxY + 40) {
        list[i] = list[list.length - 1]; list.pop();
        continue;
      }

      if (!p.alive) continue;
      var rr = p.radius + s.r;
      var dx = p.x - s.x, dy = p.y - s.y;
      if (dx * dx + dy * dy <= rr * rr) {
        var dealt = VS.Player.takeDamage(p, s.dmg, game, s.x, s.y);
        if (dealt > 0) {                                   // 无敌帧里穿过，不白吃也不白消
          list[i] = list[list.length - 1]; list.pop();
        }
      }
    }
  }

  /** 送给探针/调试用：一眼看清现在什么状态、什么招式、几发弹幕、护盾/狂暴 */
  function debug(boss, game) {
    var ai = boss && boss.ai;
    return {
      state: ai ? ai.state : 'none', move: ai ? ai.move : '',
      phase: ai ? ai.phaseName : '', shots: shotsOf(game).length,
      minions: game.enemies.list.filter(function (e) { return !e.dead && !e.boss; }).length,
      shield: !!(ai && ai.shield), invuln: ai ? ai.invuln : 0, vulnBonus: ai ? ai.vulnBonus : 1,
      enraged: !!(ai && ai.enraged), laser: !!(ai && ai.laser), meteors: ai ? ai.meteors.length : 0,
      hpFrac: boss && boss.maxHp ? +(boss.hp / boss.maxHp).toFixed(3) : 0
    };
  }

  var BossKit = { step: step, updateShots: updateShots, debug: debug, phaseIndex: phaseIndex, init: init };

  VS.register('BossKit', BossKit);

})(window.VS = window.VS || {});
