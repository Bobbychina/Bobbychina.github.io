/* 商店的装备箱和无尽锻炉。沿用同一余额和暂停状态。 */
(function (VS) {
  'use strict';

  var root, tabs, stock, inventory, forge, hint, refresh, role;

  function familyBonuses(family, count) {
    return [2, 3].map(function (n) {
      return '<li class="' + (count >= n ? 'active' : '') + '"><b>' + n + ' 件</b> ' + family.bonuses[n] + '</li>';
    }).join('');
  }

  function guide() {
    var gear = VS.Gear;
    return Object.values(gear.families).map(function (family) {
      var contents = Object.values(gear.items).filter(function (item) { return item.family === family.id; })
        .map(function (item) { return '<p><b>' + item.name + '</b> · ' + item.desc + '</p>'; }).join('');
      return '<details class="set-guide" style="--family:' + family.color + '"><summary>' + family.icon + ' ' + family.name +
        '</summary><ul>' + familyBonuses(family, 0) + '</ul>' + contents + '</details>';
    }).join('');
  }

  function equipment(game) {
    var p = game.player, gear = VS.Gear, worn = gear.equipped(p), owned = gear.owned(p);
    var sets = Object.values(gear.families).filter(function (f) { return gear.count(p, f.id) > 0; })
      .map(function (f) {
        var count = gear.count(p, f.id);
        return '<div class="set-guide" style="--family:' + f.color + '"><b>' + f.name + ' · ' + count +
          '/3</b><ul>' + familyBonuses(f, count) + '</ul></div>';
      });
    function row(id, equipped) {
      var item = gear.items[id], family = gear.families[item.family];
      return '<article class="gear-row" style="--family:' + family.color + '"><div><small>' + family.name +
        '</small><h4>' + item.icon + ' ' + item.name + '</h4><p>' + item.desc + '</p></div><button type="button" ' +
        'data-gear="' + id + '" data-worn="' + equipped + '"' + (!equipped && worn.length >= gear.capacity ? ' disabled' : '') +
        '>' + (equipped ? '收回箱中' : '装备') + '</button></article>';
    }
    var stored = owned.filter(function (id) { return worn.indexOf(id) < 0; });
    return '<h3>已装备 <small>' + worn.length + ' / ' + gear.capacity + '</small></h3>' +
      (worn.map(function (id) { return row(id, true); }).join('') || '<p>在货架购买第一件装备后会自动穿戴。</p>') +
      sets.join('') + '<h3>箱中装备 <small>' + stored.length + '</small></h3>' +
      (stored.length ? (worn.length >= gear.capacity ? '<p>先收回一件已装备物品，即可换装。</p>' : '') +
        stored.map(function (id) { return row(id, false); }).join('') : '<p>装备位已满时，新买的装备会存入箱中。</p>');
  }

  function smithy(game, choices) {
    return '<p class="forge-task">' + VS.EndlessForge.summary(game) + '</p><div class="shop-grid">' +
      choices.map(function (c) {
        var cost = VS.EndlessForge.price(game, c.id), short = cost - game.shop.coins;
        var five = VS.EndlessForge.price(game, c.id, 5);
        return '<article class="shop-offer" style="--offer-accent:' + c.color + '"><div class="shop-item-name"><span>' +
          c.icon + '</span><h3>' + c.name + '</h3></div><p class="shop-tag">' + c.tag + '</p><p class="shop-desc">' +
          c.desc + '</p><div class="forge-actions"><button type="button" class="shop-buy" data-seal="' + c.id + '" data-count="1" data-cost="' + cost + '"' +
          (short > 0 ? ' disabled' : '') + '>升 1 层 · ' + VS.Utils.group(cost) + ' 金</button>' +
          '<button type="button" data-seal="' + c.id + '" data-count="5" data-cost="' + five + '"' +
          (game.shop.coins < five ? ' disabled' : '') + '>升 5 层 · ' + VS.Utils.group(five) + ' 金</button>' +
          '<button type="button" data-seal="' + c.id + '" data-core="1"' + (game.forge.cores < 1 ? ' disabled' : '') +
          '>升 1 层 · 1 炉芯</button></div></article>';
      }).join('') + '</div>';
  }

  function render(game) {
    var view = game.shop.view, seals = VS.EndlessForge.choices(game, false);
    tabs.querySelector('[data-view="forge"]').hidden = !seals.length;
    tabs.querySelector('[data-view="gear"]').textContent = '装备箱 · ' + VS.Gear.equipped(game.player).length + '/' + VS.Gear.capacity;
    tabs.querySelectorAll('[data-view]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    });
    role.textContent = VS.Config.HUNTERS[game.hunter].name;
    stock.hidden = view !== 'stock';
    refresh.hidden = view !== 'stock';
    inventory.hidden = view !== 'gear';
    forge.hidden = view !== 'forge';
    hint.textContent = view === 'stock' ? '1–4 购买 · R 刷新' : view === 'gear' ? '换装免费，收回的装备保留到本局结束。' : '每份委托奖励 1 枚炉芯，可用于任意一层。';
    if (view === 'gear') inventory.innerHTML = equipment(game);
    if (view === 'forge') forge.innerHTML = smithy(game, seals);
  }

  function init() {
    var el = function (id) { return document.getElementById(id); };
    root = el('panel-shop'); tabs = el('shopViews'); stock = el('shopCards'); hint = el('shopKeys');
    role = el('shopHunter'); inventory = el('shopGear'); forge = el('shopForge'); refresh = el('shopRefreshBtn');
    el('gearGuide').innerHTML = guide();
    root.addEventListener('click', function (e) {
      var b = e.target.closest('button'), game = VS.Game.current;
      if (!b || b.disabled || !game || game.state !== 'shop') return;
      var data = b.dataset, message;
      if (data.view) {
        game.shop.view = data.view;
      } else if (data.gear) {
        var remove = data.worn === 'true';
        if (!(remove ? VS.Gear.remove : VS.Gear.equip)(game, data.gear)) return;
        message = VS.Gear.items[data.gear].name + (remove ? '已收回装备箱' : '已装备');
        VS.Shop.sync(game);
      } else if (data.seal) {
        var ok = data.core ? VS.Shop.useCore(game, data.seal) :
          VS.Shop.forge(game, data.seal, Number(data.cost), Number(data.count));
        if (!ok) return;
        message = VS.EndlessForge.seals.find(function (s) { return s.id === data.seal; }).name +
          '已升至 ' + game.forge.ranks[data.seal] + ' 层';
      } else return;
      VS.Panels.showShop(game, message);
      if (data.seal || data.gear) {
        var selector = data.seal ? '[data-seal="' + data.seal + '"]' +
          (data.core ? '[data-core]' : '[data-count="' + data.count + '"]') : '[data-gear="' + data.gear + '"]';
        var replacement = root.querySelector(selector);
        if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
      }
    });
  }

  VS.register('Workshop', { init: init, render: render });
})(window.VS = window.VS || {});
