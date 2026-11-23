'use strict';
const Catalog = (() => {
  const rows = [
    [
      'give',
      '给予物品',
      'give @p minecraft:diamond_sword[minecraft:custom_name={text:"晨曦之刃"},minecraft:enchantments={sharpness:3}] 1',
      'give @p diamond_sword 1 0 {"minecraft:keep_on_death":{}}',
    ],
    ['scoreboard', '管理计分板', 'scoreboard objectives add points dummy'],
    ['title', '显示屏幕标题', 'title @a title {text:"冒险开始",color:"gold"}', 'title @a title 冒险开始'],
    ['execute', '按条件执行', 'execute as @a at @s if entity @s run say 准备好了'],
    ['summon', '召唤实体', 'summon zombie ~2 ~ ~'],
    ['setblock', '放置世界方块', 'setblock ~ ~1 ~ gold_block'],
    ['titleraw', '显示 JSON 标题', 'titleraw @a title {"rawtext":[{"text":"冒险开始"}]}'],
    [
      'tellraw',
      '发送富文本',
      'tellraw @a {text:"出发！",color:"green"}',
      'tellraw @a {"rawtext":[{"text":"出发！"}]}',
    ],
    ['clear', '清除或检测背包物品', 'clear @p diamond_sword 0', 'clear @p diamond_sword -1 0'],
    ['enchant', '修改主手附魔', 'enchant @p sharpness 3'],
    ['item', '替换实体装备', 'item replace entity @p weapon.mainhand with diamond_sword'],
    ['replaceitem', '替换实体装备', 'replaceitem entity @p slot.weapon.mainhand 0 diamond_sword'],
    ['say', '广播消息', 'say 欢迎 @p'],
    ['me', '发送动作消息', 'me 准备出发'],
    ['tell', '私聊玩家', 'tell Steve 你好'],
    ['list', '列出在线玩家', 'list'],
    ['tag', '管理实体标签', 'tag @a add ready'],
    ['testfor', '检测匹配实体', 'testfor @a[tag=ready]'],
    ['teleport', '传送实体', 'teleport @p 8 64 8'],
    ['kill', '移除实体', 'kill @e[type=zombie]'],
    ['damage', '改变目标生命值', 'damage @p 2'],
    ['gamemode', '设置玩家模式', 'gamemode creative @p'],
    ['defaultgamemode', '设置默认模式', 'defaultgamemode survival'],
    ['difficulty', '查询或设置难度', 'difficulty normal'],
    ['effect', '给予或清除效果', 'effect give @p speed 30 1', 'effect @p speed 30 1'],
    ['experience', '设置或查询经验', 'experience add @p 3 levels'],
    ['xp', '修改经验', 'xp add @p 3 levels', 'xp 3L @p'],
    ['spawnpoint', '设置玩家重生点', 'spawnpoint @p 0 64 0'],
    ['setworldspawn', '设置世界出生点', 'setworldspawn 0 64 0'],
    ['clearspawnpoint', '重置玩家重生点', 'clearspawnpoint @a'],
    ['time', '查询或调整时间', 'time set noon'],
    ['weather', '改变预览天气', 'weather rain'],
    ['toggledownfall', '切换降雨', 'toggledownfall'],
    ['daylock', '锁定日照', 'daylock true'],
    ['gamerule', '读取或写入规则', 'gamerule doDaylightCycle false', 'gamerule dodaylightcycle false'],
    ['fill', '填充虚拟世界区域', 'fill ~ ~1 ~ ~3 ~1 ~3 stone'],
    ['clone', '复制虚拟世界区域', 'clone 0 64 0 2 64 0 0 66 0'],
    ['testforblock', '检查指定方块', 'testforblock ~ ~ ~ command_block'],
    ['testforblocks', '比较两个区域', 'testforblocks 0 65 0 1 65 0 0 66 0 all'],
    [
      'playsound',
      '记录播放事件',
      'playsound minecraft:block.note_block.pling master @a',
      'playsound note.pling @a',
    ],
    ['stopsound', '清除声音事件', 'stopsound @a'],
    [
      'particle',
      '预览粒子事件',
      'particle minecraft:flame ~ ~1 ~',
      'particle minecraft:basic_flame_particle ~ ~1 ~',
    ],
    ['recipe', '记录玩家配方', 'recipe give @p *'],
    ['ride', '关联骑乘目标', 'ride @p mount @e[type=pig,limit=1]', 'ride @p start_riding @e[type=pig,c=1]'],
    ['spreadplayers', '在平面分散目标', 'spreadplayers 0 0 3 20 false @a', 'spreadplayers 0 0 3 20 @a'],
    ['help', '查看支持指令', 'help'],
    ['team', '管理队伍', 'team add green'],
    ['teammsg', '发送队内消息', 'execute as @p run teammsg 集合'],
    ['bossbar', '管理玩家 Boss 栏', 'bossbar add demo:boss {text:"首领"}'],
    ['attribute', '读写实体基础属性', 'attribute @p minecraft:max_health base set 40'],
    ['data', '读取或修改 NBT', 'data merge storage demo:state {stage:1}'],
    ['random', '生成区间随机数', 'random value 1..6'],
    ['return', '返回数值或指令结果', 'return 1'],
    ['rotate', '设置实体朝向', 'rotate @p 90 0'],
    ['spectate', '设置旁观目标', 'spectate Alex Steve'],
    ['worldborder', '设置虚拟世界边界', 'worldborder set 1000'],
    ['seed', '查询模拟世界种子', 'seed'],
    ['forceload', '记录常加载区块', 'forceload add 0 0'],
    ['trigger', '触发获准的计分项', 'execute as @p run trigger task add 1'],
    ['hud', '调整玩家 HUD', 'hud @p hide crosshair'],
    ['inputpermission', '记录输入权限', 'inputpermission set @p movement disabled'],
    ['camera', '记录摄像机预设', 'camera @p set minecraft:free'],
    ['camerashake', '预览镜头震动', 'camerashake add @p 0.4 2 positional'],
    ['mobevent', '读写生物事件开关', 'mobevent minecraft:wandering_trader_event false'],
    ['tickingarea', '管理常加载区域', 'tickingarea add 0 64 0 16 64 16 lab'],
    ['structure', '保存或载入方块区域', 'structure save demo 0 64 0 2 64 1'],
    ['music', '记录音乐队列', 'music play music.game'],
  ];
  const info = new Map(rows.map((r) => [r[0], r]));
  const aliases = { tp: 'teleport', msg: 'tell', w: 'tell', tm: 'teammsg' };
  function get(name, ed) {
    const canon = aliases[name] || (ed === 'BE' ? MC_DATA.BEaliases[name] : null) || name,
      r = info.get(canon);
    if (!r) return { name, done: false, label: '此版本未模拟', example: '' };
    const sample = (ed === 'BE' ? r[3] : null) || r[2];
    return {
      name,
      done: true,
      label: r[1],
      example:
        sample.startsWith(canon + ' ') || sample === canon ? name + sample.slice(canon.length) : sample,
    };
  }
  function list(ed) {
    return [...new Set([...MC_DATA[ed].commands, ...(ed === 'BE' ? Object.keys(MC_DATA.BEaliases) : [])])]
      .map((n) => get(n, ed))
      .sort((a, b) => Number(b.done) - Number(a.done) || a.name.localeCompare(b.name));
  }
  return { get, list };
})();
