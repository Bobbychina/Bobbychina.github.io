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
      phaseName: ''
    };
    return boss.ai;
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
    list.push({
      x: boss.x + Math.cos(ang) * (boss.radius * 0.6),
      y: boss.y + Math.sin(ang) * (boss.radius * 0.6),
      vx: Math.cos(ang) * (speed || s.speed),
      vy: Math.sin(ang) * (speed || s.speed),
      r: s.r, dmg: dmg || s.dmg, life: s.life, age: 0, tone: m.tone
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

    if (ai.state === 'idle') {
      /* 追人（速度按档位加成） */
      var dx = p.x - boss.x, dy = p.y - boss.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      boss.x += (dx / d) * boss.speed * ph.speedMul * dt;
      boss.y += (dy / d) * boss.speed * ph.speedMul * dt;

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
      ai.cd = cfg().MOVES[ai.move].cd * ph.cdMul;
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

  /** 送给探针/调试用：一眼看清现在什么状态、什么招式、几发弹幕 */
  function debug(boss, game) {
    var ai = boss && boss.ai;
    return {
      state: ai ? ai.state : 'none', move: ai ? ai.move : '',
      phase: ai ? ai.phaseName : '', shots: shotsOf(game).length,
      minions: game.enemies.list.filter(function (e) { return !e.dead && !e.boss; }).length
    };
  }

  var BossKit = { step: step, updateShots: updateShots, debug: debug, phaseIndex: phaseIndex, init: init };

  VS.register('BossKit', BossKit);

})(window.VS = window.VS || {});
