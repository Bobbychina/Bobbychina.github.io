(function(root){
"use strict";
const {InkGame}=root.InkOnlineEngine;
const EDGE=["jump","dive","dash","attackPress","heavy","skill2","ultimate"];
const NAMES={nameless:"无名",panshan:"磐山",mingxiao:"鸣霄"};
const STEP=1/60;
"use strict";

function safeInput(_0x3cdaaf) {
  if (!_0x3cdaaf || "object" != typeof _0x3cdaaf || Array["isArray"](_0x3cdaaf)) return null;
  const _0x5b4ccb = {
    'move': [-0x1, 0x0, 0x1]["includes"](_0x3cdaaf["move"]) ? _0x3cdaaf["move"] : 0x0,
    'attack': !0x0 === _0x3cdaaf["attack"]
  };
  for (const _0x1d978c of EDGE) _0x5b4ccb[_0x1d978c] = !0x0 === _0x3cdaaf[_0x1d978c];
  return _0x5b4ccb;
}
function actorSnapshot(_0x540b77) {
  const _0x4314e2 = {};
  for (const [_0xc487ba, _0x185fff] of Object["entries"](_0x540b77)) "number" != typeof _0x185fff && "string" != typeof _0x185fff && "boolean" != typeof _0x185fff && null !== _0x185fff || (_0x4314e2[_0xc487ba] = _0x185fff);
  return _0x540b77["ultSwords"] && (_0x4314e2["ultSwords"] = _0x540b77["ultSwords"]['map'](_0x5526f5 => {
    const _0x20cee8 = {};
    for (const [_0x29a9b3, _0x1c0d79] of Object["entries"](_0x5526f5)) "object" != typeof _0x1c0d79 && (_0x20cee8[_0x29a9b3] = _0x1c0d79);
    return _0x20cee8;
  })), _0x4314e2;
}
function effectSnapshot(_0x137951) {
  const _0x460e4c = {};
  for (const [_0x31c132, _0x596a7f] of Object["entries"](_0x137951)) "owner" === _0x31c132 || "source" === _0x31c132 || "ghost" === _0x31c132 ? _0x460e4c[_0x31c132] = _0x596a7f ? actorSnapshot(_0x596a7f) : null : ('object' != typeof _0x596a7f || null === _0x596a7f || Array["isArray"](_0x596a7f)) && (_0x460e4c[_0x31c132] = _0x596a7f);
  return _0x460e4c;
}
class Duel {
  constructor(_0xcf7739, _0x5c14c8 = Math["random"]) {
    this["time"] = 0x0, this["tick"] = 0x0, this['over'] = !0x1, this["winner"] = null, this["reason"] = '', this["games"] = _0xcf7739["map"](_0x118a2a => new InkGame({
      'random': _0x5c14c8,
      'build': {
        'character': _0x118a2a,
        'heroLevel': 0x1
      }
    })), this['games']["forEach"]((_0x19b888, _0x1dd241) => {
      _0x19b888["world"] = {
        'width': 0x500,
        'height': 0x2d0,
        'groundY': 0x244,
        'ceiling': 0x1c2
      }, _0x19b888['platforms'] = [], _0x19b888['hazards'] = [], _0x19b888["gates"] = [], _0x19b888["checkpoints"] = [], _0x19b888['state'] = "playing", _0x19b888["energy"] = 0x64, _0x19b888['effects'] = [], _0x19b888['particles'] = [], _0x19b888["cameraX"] = 0x0;
      const _0x269494 = _0x19b888["player"];
      Object["assign"](_0x269494, {
        'x': _0x1dd241 ? 0x352 : 0x1ae,
        'facing': _0x1dd241 ? -0x1 : 0x1,
        'cfg': {
          'breakAt': 0x1 / 0x0
        },
        'held': !0x1,
        'name': NAMES[_0x269494["character"]],
        'plan': []
      });
      const _0x3231c2 = _0x19b888["hitEnemy"]["bind"](_0x19b888),
        _0x2a17d9 = _0x19b888["ultimate"]["bind"](_0x19b888);
      _0x19b888["defeatEnemy"] = _0x428e0c => {
        _0x428e0c['hp'] = 0x0, _0x428e0c["held"] = !0x1, _0x19b888["set"](_0x428e0c, "down");
      }, _0x19b888["hitEnemy"] = (_0xbdd1dd, _0x20c1c2, _0x52213b = {}) => {
        if (this['over'] || _0xbdd1dd['hp'] <= 0x0 || _0xbdd1dd["invulnerable"] > 0x0 || ["ult", "x_ult"]['includes'](_0xbdd1dd["action"])) return !0x1;
        const _0x187940 = this["games"][0x1 - _0x1dd241],
          _0x115228 = _0xbdd1dd["action"];
        if (!_0x3231c2(_0xbdd1dd, _0x20c1c2, _0x52213b)) return !0x1;
        if (_0x187940["chainWindow"] = 0x0, _0x187940['buffer'] = null, _0x187940["combo"] = 0x0, _0x187940["hitsTaken"]++, _0x187940["energy"] = Math['min'](0x64, _0x187940["energy"] + (_0x20c1c2["noEnergy"] || _0x52213b["light"] ? 0x0 : 0x4)), _0x52213b["keepHeld"] || (_0xbdd1dd["held"] = !0x1, _0xbdd1dd['hp'] > 0x0 && _0x19b888["set"](_0xbdd1dd, _0xbdd1dd['z'] > _0x19b888["groundHeight"](_0xbdd1dd) || _0x20c1c2["launch"] ? "hurtAir" : "hurt"), "hurt" === _0xbdd1dd["action"] && (_0xbdd1dd["actionTime"] = Math['max'](0x0, 0.3 - Math["min"](0.3, _0xbdd1dd["stun"] || _0x20c1c2['stun'] || 0.22)))), _0xbdd1dd["escapePending"] = !0x1, _0x20c1c2['interrupt'] && InkGame["MOVES"][_0x115228]) {
          if (_0x187940["effects"] = _0x187940["effects"]["filter"](_0x3a320c => _0x3a320c["source"] !== _0xbdd1dd), _0x19b888['fx']('interrupt', _0xbdd1dd['x'], 0x244 - _0xbdd1dd['z'] - 0x44 * _0xbdd1dd["visualScale"] / 0.6, 0.32), _0xbdd1dd["ultTargets"]) {
            for (const _0x24e7da of _0xbdd1dd["ultTargets"]) _0x24e7da["held"] = !0x1;
          }
          _0xbdd1dd["ultTargets"] = [];
        }
        return _0xbdd1dd['hp'] > 0x0 && !_0x20c1c2["ultimate"] && !_0x52213b["keepHeld"] && _0xbdd1dd["comboHits"] >= 0x6 && (_0xbdd1dd["comboHits"] = 0x0, _0xbdd1dd["invulnerable"] = Math["max"](_0xbdd1dd["invulnerable"], 0.28), _0x19b888["set"](_0xbdd1dd, _0x19b888["isGrounded"](_0xbdd1dd) ? "idle" : "air"), _0xbdd1dd['vx'] = 0x0, _0x187940['fx']("perfect", _0xbdd1dd['x'], 0x244 - _0xbdd1dd['z'] - 0x28, 0.4)), !0x0;
      }, _0x19b888["ultimate"] = () => {
        const _0x50a657 = _0x19b888["enemies"];
        _0x19b888["enemies"] = _0x50a657["filter"](_0x4e7736 => _0x4e7736["invulnerable"] <= 0x0 && !['ult', "x_ult"]['includes'](_0x4e7736['action']));
        try {
          return _0x2a17d9();
        } finally {
          _0x19b888["enemies"] = _0x50a657;
        }
      };
    }), this["games"]['forEach']((_0x246672, _0x3f4c91) => {
      _0x246672["enemies"] = [this["games"][0x1 - _0x3f4c91]["player"]];
    });
  }
  ['finish'](_0x2e919e, _0x36bef6) {
    if (!this['over']) {
      this["over"] = !0x0, this["winner"] = _0x2e919e, this["reason"] = _0x36bef6;
      for (const _0x2e5208 of this["games"]) _0x2e5208["buffer"] = null, _0x2e5208["player"]["held"] = !0x1, _0x2e5208["player"]['runV'] = 0x0;
    }
  }
  ["update"](_0x37682e = [{}, {}], _0x559bff = STEP) {
    if (this["over"]) return;
    const _0x1634ad = _0x37682e['map'](_0x5b0511 => safeInput(_0x5b0511) || {
      'move': 0x0
    });
    if (this["games"]["forEach"]((_0x3c4954, _0x4450f8) => {
      _0x3c4954["player"]["held"] ? _0x3c4954["buffer"] = null : (_0x3c4954["bufferInput"](_0x1634ad[_0x4450f8]), 'skill1' === _0x3c4954['buffer']?.["type"] && 'nameless' === _0x3c4954["player"]["character"] && _0x3c4954["heavyCooldown"] <= 0x0 && _0x3c4954["canAct"]('skill') && _0x3c4954["consumeBuffer"](_0x1634ad[_0x4450f8]));
    }), this["games"]["some"](_0x406fd6 => _0x406fd6["hitStop"] > 0x0)) {
      for (const _0x3c7bb7 of this["games"]) _0x3c7bb7["hitStop"] = Math["max"](0x0, _0x3c7bb7["hitStop"] - _0x559bff);
    } else {
      this['time'] += _0x559bff, this["tick"]++;
      for (const _0x2b73c7 of this["games"]) {
        _0x2b73c7["time"] = this["time"], _0x2b73c7["updateEffects"](_0x559bff);
        for (const _0xfa7f24 of ['dashCooldown', "heavyCooldown", "skill2Cooldown", "chainWindow", "comboTimer"]) _0x2b73c7[_0xfa7f24] = Math["max"](0x0, _0x2b73c7[_0xfa7f24] - _0x559bff);
        _0x2b73c7['comboTimer'] <= 0x0 && (_0x2b73c7["combo"] = 0x0);
      }
      for (const _0x4f3009 of this["tick"] % 0x2 ? [0x0, 0x1] : [0x1, 0x0]) {
        const _0xdf52fe = this["games"][_0x4f3009],
          _0x21d315 = _0xdf52fe["player"];
        if (_0x21d315["held"]) _0x21d315["invulnerable"] = Math["max"](0x0, _0x21d315['invulnerable'] - _0x559bff);else {
          if (_0xdf52fe["updatePlayer"](_0x559bff, _0x1634ad[_0x4f3009]), this["games"]['some'](_0x50397f => _0x50397f["player"]['hp'] <= 0x0)) {
            const _0x1dc4e6 = this['games']['map'](_0x16c8de => _0x16c8de['player']['hp'] <= 0x0);
            return void this["finish"](_0x1dc4e6[0x0] === _0x1dc4e6[0x1] ? null : _0x1dc4e6[0x0] ? 0x1 : 0x0, "击败对手");
          }
        }
      }
      if (this["time"] >= 0xb4) {
        const _0x5b46a6 = this["games"]["map"](_0x1df509 => _0x1df509["player"]['hp'] / _0x1df509["player"]['maxHp']);
        this["finish"](Math["abs"](_0x5b46a6[0x0] - _0x5b46a6[0x1]) < 0.0001 ? null : _0x5b46a6[0x0] > _0x5b46a6[0x1] ? 0x0 : 0x1, "时间到 · 按剩余生命比例判定");
      }
    }
  }
  ["snapshot"]() {
    return {
      'time': this["time"],
      'remaining': Math['max'](0x0, Math["ceil"](0xb4 - this["time"])),
      'over': this["over"],
      'winner': this['winner'],
      'reason': this["reason"],
      'players': this["games"]["map"](_0x3d3d7a => actorSnapshot(_0x3d3d7a["player"])),
      'gauges': this["games"]["map"](_0x28ff48 => ({
        'energy': _0x28ff48["energy"],
        'dash': _0x28ff48["dashCooldown"],
        'j': _0x28ff48["heavyCooldown"],
        'i': _0x28ff48["skill2Cooldown"]
      })),
      'effects': this["games"]["flatMap"](_0x9e4703 => _0x9e4703["effects"]["map"](effectSnapshot))["slice"](-0x64),
      'particles': this["games"]["flatMap"](_0x58581b => _0x58581b["particles"]["map"](_0x41f3a5 => ({
        ..._0x41f3a5
      })))["slice"](-0xb4),
      'hitStop': Math["max"](...this["games"]["map"](_0x5c9b0a => _0x5c9b0a['hitStop'])),
      'shake': Math["max"](...this['games']["map"](_0x107650 => _0x107650["shake"]))
    };
  }
}
root.InkOnlineCombat={Duel,safeInput};
root.InkData={MOVES:InkGame.MOVES,ENEMY_MOVES:InkGame.ENEMY_MOVES};
})(globalThis);
