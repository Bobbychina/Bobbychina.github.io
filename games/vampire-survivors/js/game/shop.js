/* ===========================================================
   商店：金币经济 + 货架生成 + 锁定 / 刷新 / 购买
   只维护 game.shop 的数据和规则，不碰 DOM，也不实现 UI。

   经济边界：
     · 金币一律为整数，余额上限 COIN_CAP；加钱只加实际能放进去的部分。
     · 商品价格随本局购买次数上涨；锁定商品保留生成时的 token 和价格，
       因此涨价不会影响已经锁住的货架。
     · 拒绝操作（钱不够、token 过期、商品已售/失效等）统一返回 false，
       并且不扣钱、不改货架；不抛异常伪造成功。

   货架约定：
     · 固定 4 个 slot，offers 中每项为
       { choice, price, token, locked, sold }；池不足时允许 null 空位。
     · 刷新只从 Game.upgradePool 取合法候选；购买时也重新取池，
       不信任 UI 传来的 choice / price，只使用 index + token 定位货架项。
     · 售出与失效的槽不会免费补货；刷新是唯一的补货入口。
   =========================================================== */
(function (VS) {
  'use strict';

  var SLOT_COUNT = 4;
  var COIN_CAP = 999999999;
  var FREE_REFRESH_SECONDS = 60;
  var PRICE_GROWTH = 0.035;

  /* ---------------- 基础状态与数值工具 ---------------- */

  function ensureShop(game) {
    if (!game) return null;
    if (!game.shop) game.shop = Shop.create();
    return game.shop;
  }

  function isInteger(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }

  function finiteOr(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  function runTime(game) {
    if (!game) return 0;

    if (VS.Game && typeof VS.Game._runTime === 'function') {
      var t = VS.Game._runTime(game);
      if (typeof t === 'number' && isFinite(t)) return t;
    }

    return finiteOr(game.totalTime, 0) + finiteOr(game.time, 0);
  }

  function choiceKey(choice) {
    if (!choice) return '';
    return choice.kind + ':' + choice.id + ':' + (choice.schoolId || '');
  }

  function isValidChoice(choice) {
    return !!(choice && typeof choice === 'object' &&
      choice.kind && choice.id !== undefined && choice.id !== null);
  }

  function poolFor(game) {
    if (!VS.Game || typeof VS.Game.upgradePool !== 'function') return [];

    var raw = VS.Game.upgradePool(game);
    if (!Array.isArray(raw)) return [];

    var out = [];
    for (var i = 0; i < raw.length; i++) {
      if (isValidChoice(raw[i])) out.push(raw[i]);
    }
    return out;
  }

  function keyMap(pool) {
    var map = {};
    for (var i = 0; i < pool.length; i++) map[choiceKey(pool[i])] = pool[i];
    return map;
  }

  function containsKey(pool, key) {
    for (var i = 0; i < pool.length; i++) {
      if (choiceKey(pool[i]) === key) return true;
    }
    return false;
  }

  function weaponLevel(game, id) {
    var p = game && game.player;
    if (!p || !p.weapons) return 0;

    for (var i = 0; i < p.weapons.length; i++) {
      if (p.weapons[i] && p.weapons[i].id === id) {
        return Math.max(0, finiteOr(p.weapons[i].level, 0));
      }
    }
    return 0;
  }

  function buffLevel(game, id) {
    var p = game && game.player;
    if (!p || !p.upgrades) return 0;
    return Math.max(0, finiteOr(p.upgrades[id], 0));
  }

  /** 流派层数通常记在武器对象的 schoolRank / schoolId 上 */
  function schoolRank(game, choice) {
    var p = game && game.player;
    var sid = choice.schoolId || choice.id;

    if (p && p.weapons) {
      for (var i = 0; i < p.weapons.length; i++) {
        var w = p.weapons[i];
        if (!w) continue;
        if (w.id === choice.id) {
          return choice.schoolId ? (w.schoolId === sid ? Math.max(0, finiteOr(w.schoolRank, 0)) : 0)
            : Math.max(0, finiteOr(w.school, 0));
        }
      }
    }

    return 0;
  }

  function basePrice(game, choice) {
    switch (choice && choice.kind) {
      case 'weapon-new': return 22;
      case 'weapon-up': return 12 + weaponLevel(game, choice.id) * 3;
      case 'buff': return 16 + buffLevel(game, choice.id) * 5;
      case 'school': return 20 + schoolRank(game, choice) * 7;
      case 'evolution': return 75;
      case 'supply': return 25;
      default: return 22;
    }
  }

  /* ---------------- 货架生成 ---------------- */

  function weightOf(choice) {
    var w = choice && choice.weight;
    return (typeof w === 'number' && isFinite(w) && w > 0) ? w : 1;
  }

  function weightedPick(list) {
    if (!list.length) return null;

    var total = 0, i;
    for (i = 0; i < list.length; i++) total += weightOf(list[i]);
    if (!(total > 0)) return list[0];

    var r = Math.random() * total;
    for (i = 0; i < list.length; i++) {
      r -= weightOf(list[i]);
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  function removeValue(list, value) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] === value) {
        list.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  function nextToken(shop) {
    var serial = finiteOr(shop.serial, 0);
    shop.serial = serial + 1;
    return String(shop.serial);
  }

  function makeOffer(game, shop, choice) {
    return {
      choice: choice,
      price: price(game, choice),
      token: nextToken(shop),
      locked: false,
      sold: false
    };
  }

  function isWeaponKind(kind) {
    return kind === 'weapon-new' || kind === 'weapon-up' || kind === 'evolution';
  }

  function hasWeaponCategory(slots) {
    for (var i = 0; i < slots.length; i++) {
      if (slots[i] && isWeaponKind(slots[i].choice.kind)) return true;
    }
    return false;
  }

  /**
   * 重铺非锁定货架。
   * @param {object} game
   * @param {boolean} paid true 表示玩家主动付费刷新
   * @returns {boolean} 是否真的刷新；失败时货架、金币、计数都不变
   */
  function refresh(game, paid) {
    var shop = ensureShop(game);
    if (!shop) return false;

    var existing = Array.isArray(shop.offers) ? shop.offers : [];
    var pool = poolFor(game);
    if (!pool.length) return false;

    var byKey = keyMap(pool);
    var slots = [null, null, null, null];
    var used = {};
    var lockedCount = 0;
    var i;

    /* 先原位保留仍然合法的锁定商品：token / price 都沿用生成时的值 */
    for (i = 0; i < SLOT_COUNT; i++) {
      var old = existing[i];
      if (!old || old.sold || !old.locked || old.unavailable) continue;

      var oldKey = choiceKey(old.choice);
      if (byKey[oldKey]) {
        slots[i] = old;
        used[oldKey] = true;
        lockedCount++;
      }
    }

    /* 四个槽全锁死时，付费刷新也不能动货架，更不能扣钱 */
    if (lockedCount === SLOT_COUNT) return false;

    /* 上一批未锁定的商品只用于“尽量避开”，不是硬性去重 */
    var previousKeys = {};
    for (i = 0; i < existing.length; i++) {
      if (existing[i] && !existing[i].locked && existing[i].choice) {
        previousKeys[choiceKey(existing[i].choice)] = true;
      }
    }

    var available = [];
    for (i = 0; i < pool.length; i++) {
      var key = choiceKey(pool[i]);
      if (!used[key]) available.push(pool[i]);
    }

    /* 没有可替换的商品（池里只剩已锁住的 key）时视为刷新失败 */
    if (!available.length) return false;

    var cost = refreshCost(game);
    if (paid && finiteOr(shop.coins, 0) < cost) return false;

    function takeChoice(pred, avoid) {
      var candidates = [];
      var k;

      for (k = 0; k < available.length; k++) {
        if (!pred || pred(available[k])) candidates.push(available[k]);
      }
      if (!candidates.length) return null;

      if (avoid) {
        var preferred = [];
        for (k = 0; k < candidates.length; k++) {
          if (!avoid[choiceKey(candidates[k])]) preferred.push(candidates[k]);
        }
        /* 避开上一批只是优先级；实在没有别的商品时仍允许重复出现 */
        if (preferred.length) candidates = preferred;
      }

      var chosen = weightedPick(candidates);
      removeValue(available, chosen);
      return chosen;
    }

    function place(choice) {
      if (!choice) return false;
      for (var k = 0; k < SLOT_COUNT; k++) {
        if (!slots[k]) {
          slots[k] = makeOffer(game, shop, choice);
          return true;
        }
      }
      return false;
    }

    /* 有可进化项时优先保证货架上有一个 */
    place(takeChoice(function (c) { return c.kind === 'evolution'; }));

    /* 货架上还没有任何武器类商品时，保证一个当前武器升级 */
    if (!hasWeaponCategory(slots)) {
      place(takeChoice(function (c) { return c.kind === 'weapon-up'; }));
    }

    /* 其余空位按权重抽取；优先避开上一批未锁定商品 */
    for (i = 0; i < SLOT_COUNT; i++) {
      if (slots[i]) continue;
      var next = takeChoice(null, previousKeys);
      if (!next) break;
      place(next);
    }

    /* 到这里刷新一定成立，才结算付费刷新 */
    if (paid) {
      shop.coins = finiteOr(shop.coins, 0) - cost;
      shop.spent = finiteOr(shop.spent, 0) + cost;
      shop.refreshes = Math.max(0, finiteOr(shop.refreshes, 0)) + 1;
    }

    shop.offers = slots;
    return true;
  }

  /* ---------------- 对外 API ---------------- */

  var Shop = {

    /** 新商店的初始状态；不在这里刷新货架 */
    create: function () {
      return {
        coins: 30,
        earned: 0,
        spent: 0,
        purchases: 0,
        refreshes: 0,
        offers: [],
        nextRefreshAt: 60,
        serial: 0
      };
    },

    /**
     * 加金币。只接受正有限值，向下取整，余额不超过上限。
     * @returns {number} 实际入账的金币数
     */
    earn: function (game, amount) {
      var shop = ensureShop(game);
      if (!shop) return 0;
      if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) return 0;

      var add = Math.floor(amount);
      if (add <= 0) return 0;

      var coins = Math.max(0, finiteOr(shop.coins, 0));
      var room = COIN_CAP - coins;
      if (room <= 0) return 0;

      add = Math.min(add, room);
      if (add <= 0) return 0;

      shop.coins = coins + add;
      shop.earned = Math.max(0, finiteOr(shop.earned, 0)) + add;
      return add;
    },

    /** 升级奖励：每级 12 金币；count 必须是非负整数 */
    levelReward: function (game, count) {
      if (!isInteger(count) || count < 0) return 0;
      return Shop.earn(game, count * 12);
    },

    /**
     * 经验球/拾取物掉钱。
     * 普通经验按 ceil(xp)；金色经验球本身是 100 倍经验，所以按 xp/100 折算，
     * 避免把经济也放大 100 倍；超级球固定 40 金币。
     */
    pickupValue: function (xp, kind) {
      if (typeof xp !== 'number' || !isFinite(xp) || xp < 0 || xp === 0 && kind !== 'super') return 0;
      if (kind === 'gold') return Math.ceil(xp / 100) * 3;
      if (kind === 'super') return 40;
      return Math.ceil(xp);
    },

    pickupReward: function (game, xp, kind) {
      return Shop.earn(game, Shop.pickupValue(xp, kind));
    },

    /** 按当前购买次数计算售价；已锁定商品不会重新走这个函数 */
    price: function (game, choice) {
      if (!isValidChoice(choice)) return 0;

      var shop = game && game.shop;
      var purchases = shop ? Math.max(0, Math.floor(finiteOr(shop.purchases, 0))) : 0;
      var base = basePrice(game, choice);
      return Math.ceil(base * (1 + PRICE_GROWTH * purchases));
    },

    refreshCost: function (game) {
      var shop = game && game.shop;
      var refreshes = shop ? Math.max(0, Math.floor(finiteOr(shop.refreshes, 0))) : 0;
      return Math.min(100, 5 + 2 * refreshes);
    },

    /**
     * 开局/过关进入商店：重铺非锁定货架，保留金币、购买次数和合法锁定项；
     * 付费刷新次数归零，下一次免费补货从当前 runTime 起 60 秒。
     */
    enter: function (game) {
      var shop = ensureShop(game);
      if (!shop) return false;

      refresh(game, false);

      shop.refreshes = 0;
      shop.nextRefreshAt = runTime(game) + FREE_REFRESH_SECONDS;
      sync(game);
      return true;
    },

    /**
     * 战斗计时检查：最多每 60 秒免费补货一次。
     * 大段时间跳跃也只补一次，不能把错过的分钟累计成多次刷新。
     */
    update: function (game) {
      var shop = game && game.shop;
      if (!shop) return false;

      /* 商店打开时时间不推进，不做免费补货 */
      if (game.state === 'shop') return false;

      var now = runTime(game);
      var due = shop.nextRefreshAt;

      if (typeof due !== 'number' || !isFinite(due)) {
        shop.nextRefreshAt = now + FREE_REFRESH_SECONDS;
        return false;
      }
      if (now < due) return false;

      refresh(game, false);
      shop.refreshes = 0;
      shop.nextRefreshAt = now + FREE_REFRESH_SECONDS;
      return true;
    },

    /**
     * 刷新货架。paid=true 时成功才扣 refreshCost 并增加付费刷新次数；
     * 失败（全锁/无候选/钱不够）返回 false 且不产生任何扣费。
     */
    refresh: function (game, paid) {
      return refresh(game, !!paid);
    },

    /**
     * 按当前合法池重新校验货架：失效项标记 unavailable 并解锁。
     * 不补货、不清空、不改变 token 和价格。
     */
    sync: function (game) {
      var shop = game && game.shop;
      if (!shop || !Array.isArray(shop.offers)) return false;

      var pool = poolFor(game);
      var byKey = keyMap(pool);

      for (var i = 0; i < shop.offers.length; i++) {
        var offer = shop.offers[i];
        if (!offer || !offer.choice) continue;
        if (!byKey[choiceKey(offer.choice)]) {
          offer.unavailable = true;
          offer.locked = false;
        }
      }
      return true;
    },

    /** 锁定/解锁；只在商店界面、token 有效且商品当前仍合法时生效 */
    toggleLock: function (game, index, token) {
      var shop = game && game.shop;
      if (!shop || game.state !== 'shop') return false;
      if (!Array.isArray(shop.offers)) return false;
      if (!isInteger(index) || index < 0 || index >= SLOT_COUNT) return false;

      var offer = shop.offers[index];
      if (!offer) return false;
      if (String(token) !== offer.token) return false;
      if (offer.sold || offer.unavailable) return false;

      var pool = poolFor(game);
      if (!containsKey(pool, choiceKey(offer.choice))) return false;

      offer.locked = !offer.locked;
      return true;
    },

    /**
     * 购买：用 fresh pool 中同 key 的商品调用 Game._applyChoice，
     * 成功后才按货架上原有的 price 扣钱。重复点击（sold）或旧 token 都会失败。
     */
    buy: function (game, index, token) {
      var shop = game && game.shop;
      if (!shop || game.state !== 'shop') return false;
      if (!Array.isArray(shop.offers)) return false;
      if (!isInteger(index) || index < 0 || index >= SLOT_COUNT) return false;

      var offer = shop.offers[index];
      if (!offer) return false;
      if (String(token) !== offer.token) return false;
      if (offer.sold || offer.unavailable) return false;

      var cost = offer.price;
      if (!isInteger(cost) || cost < 0) return false;
      if (finiteOr(shop.coins, 0) < cost) return false;
      if (!VS.Game || typeof VS.Game._applyChoice !== 'function') return false;

      var pool = poolFor(game);
      var key = choiceKey(offer.choice);
      var fresh = null;
      for (var i = 0; i < pool.length; i++) {
        if (choiceKey(pool[i]) === key) { fresh = pool[i]; break; }
      }
      if (!fresh) return false;

      /* 只认 fresh pool 的商品；UI 无法伪造 choice 或价格 */
      if (VS.Game._applyChoice(game, fresh) !== true) return false;

      shop.coins = finiteOr(shop.coins, 0) - cost;
      shop.spent = finiteOr(shop.spent, 0) + cost;
      shop.purchases = Math.max(0, finiteOr(shop.purchases, 0)) + 1;

      offer.sold = true;
      offer.locked = false;

      /* 购买可能让其他商品的 key 失效；只标记，不免费补货 */
      Shop.sync(game);
      return true;
    }
  };

  function sync(game) {
    return Shop.sync(game);
  }

  function price(game, choice) {
    return Shop.price(game, choice);
  }

  function refreshCost(game) {
    return Shop.refreshCost(game);
  }

  VS.register('Shop', Shop);

})(window.VS = window.VS || {});
