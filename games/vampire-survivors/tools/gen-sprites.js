/* ===========================================================
   像素美术生成器
   -----------------------------------------------------------
   职责：把"字符画 + 调色板"编译成真正的 PNG，再 base64 内嵌，
        输出到 js/render/sprites.js（运行时不再依赖任何外部文件）。

   为什么自己写 PNG 编码：项目要求资源全部内嵌且不联网，
   而 PNG 只需要 zlib deflate + CRC32，标准库就够，
   不需要引入任何第三方依赖。

   用法：node tools/gen-sprites.js
   产物：
     js/render/sprites.js        运行时用的 base64 图集
     tools/preview/*.png         供人工肉眼检查的放大预览图
   =========================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT_JS = path.join(ROOT, 'js', 'render', 'sprites.js');
const OUT_PREVIEW_DIR = path.join(__dirname, 'preview');

/* ===========================================================
   1. PNG 编码器
   =========================================================== */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

/** RGBA Buffer -> PNG Buffer */
function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;                       // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type: RGBA
  ihdr[10] = 0;   // compression
  ihdr[11] = 0;   // filter
  ihdr[12] = 0;   // interlace

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* ===========================================================
   2. 画布工具
   =========================================================== */

function createCanvas(w, h) {
  return { w, h, data: Buffer.alloc(w * h * 4) };
}

function setPixel(c, x, y, rgba) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  c.data[i] = rgba[0];
  c.data[i + 1] = rgba[1];
  c.data[i + 2] = rgba[2];
  c.data[i + 3] = rgba[3];
}

function getPixel(c, x, y) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return [0, 0, 0, 0];
  const i = (y * c.w + x) * 4;
  return [c.data[i], c.data[i + 1], c.data[i + 2], c.data[i + 3]];
}

function clamp255(v) {
  return v < 0 ? 0 : (v > 255 ? 255 : Math.round(v));
}

function hexToRgba(hex) {
  const s = hex.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
    s.length >= 8 ? parseInt(s.slice(6, 8), 16) : 255
  ];
}

/** 稳定的 2D 哈希噪声，范围 [0,1) */
function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/* ===========================================================
   3. 字符画 -> 画布
   =========================================================== */

const BASE_PAL = {
  '.': null
};

function buildSprite(name, rows, palette) {
  const h = rows.length;
  const w = rows[0].length;

  rows.forEach((r, i) => {
    if (r.length !== w) {
      throw new Error(`[${name}] 第 ${i} 行宽度 ${r.length}，应为 ${w}：${JSON.stringify(r)}`);
    }
  });

  const pal = Object.assign({}, BASE_PAL, palette);
  const c = createCanvas(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      const col = pal[ch];
      if (!col) throw new Error(`[${name}] 第 ${y} 行第 ${x} 列出现未定义字符 '${ch}'`);
      setPixel(c, x, y, hexToRgba(col));
    }
  }
  return c;
}

/** 把 body 的末两行换成另一组腿，做出第二帧 */
function withLegs(body, legs) {
  const out = body.slice();
  out[out.length - 2] = legs[0];
  out[out.length - 1] = legs[1];
  return out;
}

/* ===========================================================
   4. 调色板
   =========================================================== */

/* 主角的配色已经搬进 tools/player-art.js 的 SKINS 表（多皮肤），这里不再重复一份 */

const PAL_BAT = {
  'K': '#1a1024', 'W': '#b06bff', 'w': '#7a45c9',
  'P': '#8b4fd6', 'p': '#5f2f9e', 'E': '#ff4d6d'
};

const PAL_ZOMBIE = {
  'K': '#14200f', 'G': '#6fbf73', 'g': '#46833f',
  'E': '#ff3b3b', 'W': '#e8f5e0', 'B': '#2c3a26'
};

const PAL_SKELETON = {
  'K': '#231f18', 'W': '#e9e4d2', 'w': '#b3ab97', 'E': '#ff5a3c', 'B': '#4a4538'
};

const PAL_GHOST = {
  'K': '#0d2b3a', 'C': '#7fd8ff', 'c': '#3f9ccc', 'E': '#0a2230', 'B': '#2b5f78'
};

const PAL_WRAITH = {
  'K': '#120d22', 'D': '#6b5bb5', 'd': '#40356f', 'E': '#c9bcff', 'B': '#2a2247'
};

const PAL_BRUTE = {
  'K': '#1d0f0c', 'R': '#d1553f', 'r': '#95352a',
  'H': '#efe3d0', 'E': '#ffd23f', 'B': '#5a2318'
};

const PAL_ELITE = {
  'K': '#241a06', 'G': '#e0b53c', 'g': '#a8801f',
  'T': '#fff2b0', 'E': '#ff4d4d', 'W': '#f3e6c8', 'w': '#c9b48a', 'B': '#6b5320'
};

const PAL_BOLT = { 'K': '#0b2a3a', 'W': '#eafaff', 'C': '#7fd8ff' };

/* 经验石：三档品质共用同一形状，只换配色 */
const PAL_GEM = { 'K': '#0a1a24', 'W': '#dff8ff', 'C': '#4fc3f7' };
const PAL_GEM2 = { 'K': '#0a2414', 'W': '#e6ffe9', 'C': '#57c96a' };
const PAL_GEM3 = { 'K': '#241a05', 'W': '#fff4d0', 'C': '#ffc93c' };
const PAL_HEART = { 'K': '#2b0710', 'R': '#ff4d6d', 'r': '#c02040' };
const PAL_BLADE = { 'K': '#231f18', 'W': '#e9e4d2', 'w': '#b3ab97' };

const PAL_ROCK = { 'K': '#0e1218', 'g': '#3b4553', 'G': '#525f72' };
const PAL_BONE = { 'K': '#1a1712', 'W': '#ded8c4', 'w': '#a89f88' };
const PAL_GRASS = { 'K': '#12301a', 'g': '#2f6b3a', 'G': '#48a355' };
const PAL_MUSH = { 'K': '#231016', 'r': '#c0392b', 'W': '#f4e6d0', 'w': '#d8c4a8' };
const PAL_SKULL = { 'K': '#1a1712', 'W': '#ded8c4', 'w': '#a89f88' };
const PAL_GRAVE = { 'K': '#14171c', 'g': '#4a5260', 'G': '#5d6878' };
const PAL_STUMP = { 'K': '#1a1208', 'g': '#5a4326', 'G': '#7a5c34' };
const PAL_BUSH = { 'K': '#0f1c12', 'g': '#2c5c36', 'G': '#3d7a45' };

/* ===========================================================
   5. 怪物/角色美术
   =========================================================== */

/* 四种腿部姿态，做出行走感 */
const LEGS_A = ['....KBBKKBBK....', '.....KK..KK.....'];
const LEGS_B = ['....KBBKKBBK....', '....KKK..KK.....'];
const LEGS_C = ['....KBBKKBBK....', '.....KK..KKK....'];

/* --- 玩家 ---
   主角美术已经拆分到 tools/player-art.js（20×24、三方向 × 四帧 × 多皮肤）。
   这里不再保留内联的 PLAYER_DOWN/UP/SIDE —— 那是旧的 16×16 三帧版本，
   留着只会让人误改。要改主角请改 tools/player-art.js。 */

/* --- 怪物 --- */

/* 蝙蝠：两帧手绘翅膀（扇动幅度靠帧差表现） */
const BAT_0 = [
  '................',
  '..K..........K..',
  '.KWK........KWK.',
  '.KWWK......KWWK.',
  '..KWWK....KWWK..',
  '...KWWKKKKWWK...',
  '....KPPPPPPK....',
  '....KPEPPEPK....',
  '....KPPPPPPK....',
  '.....KPPPPK.....',
  '......KPPK......',
  '.......KK.......',
  '................',
  '................',
  '................',
  '................'
];

const BAT_1 = [
  '................',
  '................',
  '..K..........K..',
  '.KWK........KWK.',
  '.KWWK......KWWK.',
  '..KWWKKKKKKWWK..',
  '...KWWPPPPWWK...',
  '....KPEPPEPK....',
  '....KPPPPPPK....',
  '....KPPPPPPK....',
  '.....KPPPPK.....',
  '......KPPK......',
  '.......KK.......',
  '................',
  '................',
  '................'
];

const ZOMBIE_BODY = [
  '................',
  '.....KKKKKK.....',
  '....KGGGGGGK....',
  '....KGEGGEGK....',
  '....KGGGGGGK....',
  '.....KgGGgK.....',
  '...KKGGGGGGKK...',
  '..KGGGGGGGGGGK..',
  '..KGKgGGGGgKGK..',
  '..KGGKggggKGGK..',
  '...KKKGGGGKKK...',
  '.....KGGGGK.....',
  '.....KgGGgK.....',
  '.....KgGGgK.....',
  '....KKgKKgKK....',
  '....KKK..KKK....'
];

const SKELETON_BODY = [
  '................',
  '.....KKKKKK.....',
  '....KWWWWWWK....',
  '....KWEWWEWK....',
  '....KWWWWWWK....',
  '.....KwWWwK.....',
  '....KKWWWWKK....',
  '...KWWWWWWWWK...',
  '...KWwWWWWwWK...',
  '...KWKwWWwKWK...',
  '...KKWWWWWWKK...',
  '.....KWWWWK.....',
  '.....KwWWwK.....',
  '.....KwWWwK.....',
  '....KKwKKwKK....',
  '....KKK..KKK....'
];

const GHOST_BODY = [
  '................',
  '.....KKKKK......',
  '....KCCCCCK.....',
  '...KCCCCCCCK....',
  '...KCECCCECK....',
  '...KCCCCCCCK....',
  '...KCCCCCCCK....',
  '..KCCCCCCCCCK...',
  '..KCCCCCCCCCK...',
  '..KCCCCCCCCCK...',
  '..KcCccCccCcK...',
  '...KcKcKcKcK....',
  '....K.K.K.K.....',
  '................',
  '................',
  '................'
];

const GHOST_BODY_2 = [
  '................',
  '.....KKKKK......',
  '....KCCCCCK.....',
  '...KCCCCCCCK....',
  '...KCECCCECK....',
  '...KCCCCCCCK....',
  '...KCCCCCCCK....',
  '..KCCCCCCCCCK...',
  '..KCCCCCCCCCK...',
  '..KCCCCCCCCCK...',
  '..KCCcCccCcCK...',
  '...KcKcKcKcK....',
  '.....K.K.K......',
  '................',
  '................',
  '................'
];

const WRAITH_BODY = [
  '................',
  '.....KKKKKK.....',
  '....KDDDDDDK....',
  '...KDDDDDDDDK...',
  '...KDKDDDDKDK...',
  '...KDDDDDDDDK...',
  '...KDDDDDDDDK...',
  '....KDDDDDDK....',
  '...KKDDDDDDKK...',
  '..KDDDDDDDDDDK..',
  '..KDDdDDDDdDDK..',
  '..KDDDDDDDDDDK..',
  '...KDDDDDDDDK...',
  '....KDdDDdDK....',
  '.....KDDDDK.....',
  '......KKKK......'
];

const BRUTE_BODY = [
  '................',
  '..KK........KK..',
  '.KHHK......KHHK.',
  '..KHHKKKKKKHHK..',
  '...KRRRRRRRRK...',
  '..KRRRRRRRRRRK..',
  '..KRREERREERRK..',
  '..KRRRRRRRRRRK..',
  '..KRRKRRRRKRRK..',
  '..KRRKRRRRKRRK..',
  '...KKRRRRRRKK...',
  '....KRRRRRRK....',
  '....KRRRRRRK....',
  '....KrRRRRrK....',
  '...KKrKKKKrKK...',
  '...KKK....KKK...'
];

const ELITE_BODY = [
  '................',
  '....K.KKK.K.....',
  '...KTTKTTKTTK...',
  '...KKKKKKKKKK...',
  '..KGGGGGGGGGGK..',
  '..KGEEGGGGEEGK..',
  '..KGGGGGGGGGGK..',
  '..KGGKGGGGKGGK..',
  '..KGGGGGGGGGGK..',
  '...KGGGGGGGGK...',
  '...KGWWWWWWGK...',
  '...KGWGGGGWGK...',
  '...KGWGGGGWGK...',
  '...KGGGGGGGGK...',
  '..KKGGKKKKGGKK..',
  '..KKKK....KKKK..'
];

/* ===========================================================
   6. 场景装饰美术
   =========================================================== */

const DECO_ROCK = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.....KKKKK......',
  '...KKgggggKK....',
  '..KgGGGGGGGgK...',
  '..KgGGGGGGGgK...',
  '..KggggggggggK..',
  '..KKKKKKKKKKKK..',
  '................',
  '................',
  '................'
];

const DECO_BONES = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..KK........KK..',
  '.KWWK......KWWK.',
  '..KK.KWWWWK.KK..',
  '....KWWWWWWK....',
  '..KK.KWWWWK.KK..',
  '.KWWK......KWWK.',
  '..KK........KK..',
  '................',
  '................'
];

const DECO_GRASS = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '...K...K...K....',
  '...Kg..Kg..Kg...',
  '...Kg..Kg..Kg...',
  '...Kg..Kg..Kg...',
  '....g...g...g...',
  '................',
  '................',
  '................',
  '................'
];

const DECO_MUSH = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '......KKKK......',
  '....KKrrrrKK....',
  '...KrrWWWWrrK...',
  '...KrrrrrrrrK...',
  '....KKKKKKKK....',
  '......KWWK......',
  '......KWWK......',
  '......KKKK......',
  '................'
];

const DECO_SKULL = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '....KKKKKK......',
  '...KWWWWWWK.....',
  '...KWKKWKKWK....',
  '...KWWWWWWK.....',
  '....KWWWWK......',
  '....KWKKWK......',
  '.....KKKK.......',
  '................',
  '................'
];

const DECO_GRAVE = [
  '................',
  '................',
  '................',
  '................',
  '.....KKKKK......',
  '....KgggggK.....',
  '....KgKKKgK.....',
  '....KgKgKgK.....',
  '....KgKKKgK.....',
  '....KgggggK.....',
  '....KgggggK.....',
  '....KgggggK.....',
  '...KKgggggKK....',
  '..KKKKKKKKKKK...',
  '................',
  '................'
];

const DECO_STUMP = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '...KKKKKKKK.....',
  '..KgGGGGGGgK....',
  '..KgGGGGGGgK....',
  '..KgggggggggK...',
  '..KgGGGGGGgK....',
  '..KKKKKKKKKK....',
  '................',
  '................'
];

const DECO_BUSH = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '....KKKKKK......',
  '..KKggggggKK....',
  '.KgGGGGGGGGgK...',
  '.KgGGGGGGGGgK...',
  '.KggggggggggK...',
  '..KKKKKKKKKK....',
  '................',
  '................',
  '................'
];

/* ===========================================================
   6.5 拾取物与武器
   =========================================================== */

const GEM_SHAPE = [
  '...KK...',
  '..KWWK..',
  '.KWCCWK.',
  'KWCCCCWK',
  'KWCCCCWK',
  '.KWCCWK.',
  '..KWWK..',
  '...KK...'
];

const HEART_SHAPE = [
  '..........',
  '..KK..KK..',
  '.KRRKKRRK.',
  '.KRRRRRRK.',
  '.KRRRRRRK.',
  '..KRRRRK..',
  '...KRRK...',
  '....KK....',
  '..........',
  '..........'
];

const BLADE_SHAPE = [
  '.....KK.....',
  '....KWWK....',
  '....KWWK....',
  '....KWWK....',
  '....KWWK....',
  '...KKWWKK...',
  '..KWWWWWWK..',
  '...KKWWKK...',
  '....KWWK....',
  '....KWWK....',
  '....KWWK....',
  '.....KK.....'
];

/* ===========================================================
   6c. 主题点缀：按生物群落分的专属物件
   -----------------------------------------------------------
   美术源在 tools/deco-art.js 里（形状 + 调色板一起），
   和主角一样把"源"与"编译"分开 —— 改图形只改那个文件。
   第一关「血色荒野」：焦土 / 铁丝网 / 锈铁 / 骸骨
   第二关「柠檬深渊」：酸池 / 柠檬树 / 孢子囊 / 酸晶
   =========================================================== */

const decoArt = require('./deco-art.js');

/* 把 deco-art.js 里的组名映射成图集里的组名与精灵前缀 */
const DECO_THEME_MAP = [
  ['deco_l1', decoArt.deco_l1],
  ['deco_l1', decoArt.deco_l1_big],
  ['deco_l2', decoArt.deco_l2],
  ['deco_l2', decoArt.deco_l2_big]
];

/* ===========================================================
   7. 程序化贴图：地面 / 爆炸 / 火花
   =========================================================== */

/**
 * 周期性平滑值噪声。
 * cells = 纹理宽度方向上的晶格数（整数），晶格坐标取模后
 * 左右/上下边界自然衔接，平铺时不会出现接缝。
 */
function makePeriodicNoise(S, cells) {
  function lat(i, n) {
    return ((i % n) + n) % n;
  }
  return function (x, y) {
    const fx = (x / S) * cells;
    const fy = (y / S) * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);

    const xa = lat(x0, cells);
    const xb = lat(x0 + 1, cells);
    const ya = lat(y0, cells);
    const yb = lat(y0 + 1, cells);

    const n00 = hash2(xa, ya);
    const n10 = hash2(xb, ya);
    const n01 = hash2(xa, yb);
    const n11 = hash2(xb, yb);

    return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
  };
}

/**
 * 主题地表：按生物群落生成 128×128 可无缝平铺的地面贴图。
 * -----------------------------------------------------------
 * 为什么要换掉原来那张 64×64 的"底色 + 噪点"：
 *   1) 64px 周期在整屏重复时肉眼能看出网格感，128px 周期小一半重复频率
 *      （renderer 的贴图相位按 img.naturalWidth 取模，换大图零代码改动）；
 *   2) 纯噪点没有"可读的地貌特征"，看起来就是一张脏底 —— 现在按群落撒
 *      裂缝 / 碎石 / 灰烬 / 酸洼 / 苔斑这类小特征，才有"地图"的感觉。
 *
 * 无缝的做法：所有噪声都走 makePeriodicNoise；所有散点特征的坐标与笔画
 * 都按 S 取模回卷，跨边界时自动从另一边接上，所以平铺看不出接缝。
 */

const BIOMES = {
  /* 第一关 · 血色荒野：焦土、锈红、灰烬、碎骨 */
  waste: {
    base: [43, 30, 28],        // 底色（暗焦红棕）
    tintLo: [26, 16, 16],      // 低频起伏的暗端
    tintHi: [38, 14, 12],      // 低频起伏的暖端
    grainPale: [96, 78, 66],   // 碎石高光
    grainDark: [22, 13, 14],   // 凹坑
    rubble: [66, 52, 47],
    rubbleHi: [104, 84, 74],
    ash: [58, 46, 43],         // 灰烬斑
    crack: [20, 11, 12],       // 裂缝
    ember: [188, 96, 46],      // 余烬点
    boneCol: [166, 152, 124],
    features: { crack: 15, rubble: 34, ash: 26, ember: 22 }
  },
  /* 第二关 · 柠檬深渊：酸沼、柠檬黄绿、毒性苔斑 */
  abyss: {
    base: [44, 50, 22],
    tintLo: [26, 34, 12],
    tintHi: [40, 44, 14],
    grainPale: [104, 118, 44],
    grainDark: [22, 29, 11],
    rubble: [62, 74, 30],
    rubbleHi: [104, 122, 48],
    ash: [74, 86, 30],         // 苔斑
    crack: [20, 26, 9],
    ember: [196, 226, 74],     // 酸光点
    boneCol: [150, 156, 120],
    features: { crack: 8, rubble: 20, ash: 40, ember: 30 }
  }
};

/** 数论洗牌：让特征编号 -> 网格格的映射看起来是随机的 */
function shuffle(i, n) {
  return ((i * 2654435761) % n + n) % n;
}

function makeBiomeGroundTile(kind) {
  const S = 128;
  const B = BIOMES[kind];
  const c = createCanvas(S, S);

  const low = makePeriodicNoise(S, 3);    // 大尺度色块
  const mid = makePeriodicNoise(S, 7);    // 中尺度斑驳
  const fine = makePeriodicNoise(S, 19);  // 细颗粒

  const mix = (a, b, t) => a + (b - a) * t;

  /* --- 1. 底噪：三层周期噪声 + 逐像素颗粒 --- */
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = low(x, y);
      const b = mid(x, y);
      const f = fine(x, y);
      const grain = hash2(x * 12.9898 + 3.7, y * 78.233 + 1.3);

      /* 低频在两个端点色之间插值，决定这一块偏冷还是偏暖 */
      const lo = mix(B.base[0], B.tintLo[0], a);
      const lg = mix(B.base[1], B.tintLo[1], a);
      const lb = mix(B.base[2], B.tintLo[2], a);
      const hiT = a * (1 - b);

      let outR = mix(lo, B.tintHi[0], hiT) * 0.55 + lo * 0.45;
      let outG = mix(lg, B.tintHi[1], hiT) * 0.55 + lg * 0.45;
      let outB = mix(lb, B.tintHi[2], hiT) * 0.55 + lb * 0.45;

      /* 中尺度斑驳 + 细颗粒，幅度都压低，避免变成噪点地毯 */
      const mod = (b - 0.5) * 16 + (f - 0.5) * 7;
      outR += mod;
      outG += mod * 0.96;
      outB += mod * 0.86;

      if (grain > 0.972) { outR = mix(outR, B.grainPale[0], 0.85); outG = mix(outG, B.grainPale[1], 0.85); outB = mix(outB, B.grainPale[2], 0.85); }
      else if (grain > 0.93) { outR += 7; outG += 7; outB += 6; }
      else if (grain < 0.045) { outR = mix(outR, B.grainDark[0], 0.8); outG = mix(outG, B.grainDark[1], 0.8); outB = mix(outB, B.grainDark[2], 0.8); }

      setPixel(c, x, y, [clamp255(outR), clamp255(outG), clamp255(outB), 255]);
    }
  }

  /* --- 2. 裂缝：先画整条折线，再补一层更暗的核心，做出"缝"的厚度 --- */
  const drawCrack = (seed, len, thick, col, spread) => {
    let x = hash2(seed * 1.7, 3.1) * S;
    let y = hash2(5.3, seed * 2.9) * S;
    let ang = hash2(seed * 3.3, seed * 7.1) * Math.PI * 2;

    for (let i = 0; i < len; i++) {
      for (let t = 0; t < thick; t++) {
        const px = Math.round(x + Math.cos(ang + Math.PI / 2) * t);
        const py = Math.round(y + Math.sin(ang + Math.PI / 2) * t);
        setPixel(c, ((px % S) + S) % S, ((py % S) + S) % S, [col[0], col[1], col[2], 255]);
      }
      ang += (hash2(seed + i * 1.9, i * 3.7) - 0.5) * spread;
      x += Math.cos(ang);
      y += Math.sin(ang);
      x = ((x % S) + S) % S;
      y = ((y % S) + S) % S;
    }
  };

  /* --- 3. 碎石：带高光的团块，逐块大小不同 --- */
  const drawRubble = (seed) => {
    const cx = hash2(seed * 2.1, 11.3) * S;
    const cy = hash2(7.9, seed * 4.3) * S;
    const rad = 1.6 + hash2(seed * 5.1, seed * 1.3) * 2.6;

    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > rad) continue;
        const px = ((Math.round(cx + dx) % S) + S) % S;
        const py = ((Math.round(cy + dy) % S) + S) % S;
        const lit = (dy < -rad * 0.25) && d < rad * 0.8;   // 上缘受光
        const col = lit ? B.rubbleHi : B.rubble;
        setPixel(c, px, py, [col[0], col[1], col[2], 255]);
      }
    }
  };

  /* --- 4. 灰烬 / 苔斑：软边椭圆，边缘按 hash 抖动 --- */
  const drawBlotch = (seed) => {
    const cx = hash2(seed * 3.7, 13.1) * S;
    const cy = hash2(9.1, seed * 6.7) * S;
    const rx = 3.5 + hash2(seed * 1.1, seed * 8.3) * 5.5;
    const ry = rx * (0.55 + hash2(seed * 4.9, 2.3) * 0.5);

    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -9; dx <= 9; dx++) {
        const n = (dx / rx) * (dx / rx) + (dy / ry) * (dy / ry);
        if (n > 1) continue;
        /* 软边：越靠外越稀疏 */
        if (n > 0.55 && hash2(seed * 7.3 + dx, dy * 3.1) > 0.62) continue;
        const px = ((Math.round(cx + dx) % S) + S) % S;
        const py = ((Math.round(cy + dy) % S) + S) % S;
        const t = (1 - n) * 0.5;
        const cur = getPixel(c, px, py);
        setPixel(c, px, py, [
          clamp255(mix(cur[0], B.ash[0], t + 0.25)),
          clamp255(mix(cur[1], B.ash[1], t + 0.25)),
          clamp255(mix(cur[2], B.ash[2], t + 0.25)),
          255
        ]);
      }
    }
  };

  /* --- 5. 亮色小点：余烬 / 酸光，成对出现，给暗底一点"活气" --- */
  const drawSpeck = (seed, col) => {
    const cx = Math.round(hash2(seed * 6.1, 17.7) * S);
    const cy = Math.round(hash2(3.3, seed * 9.1) * S);
    for (let i = 0; i < 3; i++) {
      const dx = Math.round((hash2(seed * 2.7 + i, i * 5.1) - 0.5) * 5);
      const dy = Math.round((hash2(i * 7.3, seed * 4.1 + i) - 0.5) * 5);
      const px = ((cx + dx) % S + S) % S;
      const py = ((cy + dy) % S + S) % S;
      const cur = getPixel(c, px, py);
      const t = i === 0 ? 0.85 : 0.5;
      setPixel(c, px, py, [
        clamp255(mix(cur[0], col[0], t)),
        clamp255(mix(cur[1], col[1], t)),
        clamp255(mix(cur[2], col[2], t)),
        255
      ]);
    }
  };

  const F = B.features;

  /* 裂缝：长而细，跨边界靠坐标取模自动接上 */
  for (let i = 0; i < F.crack; i++) {
    drawCrack(i + 1, 26 + Math.floor(hash2(i * 1.3, 4.4) * 34), 1, B.crack, 0.55);
  }
  /* 碎石 */
  for (let i = 0; i < F.rubble; i++) drawRubble(shuffle(i, 97) + 1);
  /* 灰烬 / 苔斑 */
  for (let i = 0; i < F.ash; i++) drawBlotch(shuffle(i, 89) + 1);
  /* 亮点 */
  for (let i = 0; i < F.ember; i++) drawSpeck(shuffle(i, 83) + 1, B.ember);

  /* 碎骨点缀：第一关多些，第二关是被酸蚀过的 */
  const boneN = kind === 'waste' ? 7 : 4;
  for (let i = 0; i < boneN; i++) {
    const cx = Math.round(hash2(i * 8.7 + 2.1, 21.3) * S);
    const cy = Math.round(hash2(11.9, i * 5.3 + 1.7) * S);
    const len = 3 + Math.floor(hash2(i * 3.1, 6.9) * 4);
    const huge = i % 2 === 0;
    for (let t = 0; t < len; t++) {
      const px = ((cx + t) % S + S) % S;
      const py = ((cy + (huge ? 0 : 1)) % S + S) % S;
      setPixel(c, px, py, [B.boneCol[0], B.boneCol[1], B.boneCol[2], 255]);
      if (t === 0 || t === len - 1) {
        const qy = ((py + 1) % S + S) % S;
        setPixel(c, px, qy, [B.boneCol[0], B.boneCol[1], B.boneCol[2], 255]);
      }
    }
  }

  return c;
}

/**
 * 64x64 可无缝平铺的暗色地表（第一关旧版，保留给降级路径与对照）。
 */
function makeGroundTile() {
  const S = 64;
  const c = createCanvas(S, S);
  const low = makePeriodicNoise(S, 4);
  const mid = makePeriodicNoise(S, 11);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = low(x, y);
      const b = mid(x, y);
      const grain = hash2(x * 12.9898, y * 78.233);

      let v = 27 + a * 15 + b * 8;

      if (grain > 0.955) v += 26;        // 碎石高光
      else if (grain > 0.90) v += 10;
      else if (grain < 0.055) v -= 10;   // 凹坑

      setPixel(c, x, y, [
        clamp255(v * 0.84),
        clamp255(v * 0.90),
        clamp255(v * 1.20),
        255
      ]);
    }
  }
  return c;
}

/**
 * 32x32 六帧爆炸。
 * 边缘用多八度角向噪声打碎，避免变成"一个标准圆形"。
 */
function makeExplosionFrames() {
  const S = 32;
  const C = 15.5;
  const frames = [];

  for (let f = 0; f < 6; f++) {
    const c = createCanvas(S, S);
    const t = f / 5;
    const R = 4.5 + t * 12.5;
    const lifeA = 1 - t * 0.9;

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x - C;
        const dy = y - C;
        const d = Math.sqrt(dx * dx + dy * dy);
        const ang = Math.atan2(dy, dx);

        // 角向多八度扰动：让火球边缘参差不齐
        const wob = 0.70
          + 0.16 * Math.sin(ang * 5 + f * 1.7)
          + 0.10 * Math.sin(ang * 11 - f * 2.3)
          + 0.08 * Math.sin(ang * 19 + f * 0.9);
        const edge = R * wob;

        const n = hash2(x * 3.1 + f * 17.3, y * 2.7 + f * 9.1);
        if (d > edge * (0.80 + n * 0.40)) continue;

        const core = d < R * 0.36 * (0.9 + n * 0.3);
        let col;
        if (core) col = t < 0.4 ? [255, 250, 214] : [255, 205, 105];
        else if (d < R * 0.62) col = [250, 150, 52];
        else if (d < R * 0.84) col = [214, 88, 40];
        else col = [150, 44, 34];

        const falloff = 1 - Math.min(1, d / (edge + 0.001));
        const a = clamp255(255 * lifeA * (0.35 + falloff * 0.85));
        if (a < 12) continue;

        setPixel(c, x, y, [col[0], col[1], col[2], a]);
      }
    }
    frames.push(c);
  }
  return frames;
}

/** 8x8 四帧火花 */
function makeSparkFrames() {
  const S = 8;
  const frames = [];

  for (let f = 0; f < 4; f++) {
    const c = createCanvas(S, S);
    const R = 1.0 + f * 1.15;
    const a = clamp255(255 * (1 - f / 4.2));

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x - 3.5;
        const dy = y - 3.5;
        const d = Math.sqrt(dx * dx + dy * dy);

        // 十字星芒 + 中心亮核
        const onRay = (Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6) && d <= R * 1.45;
        if (d <= R * 0.7) setPixel(c, x, y, [255, 252, 226, a]);
        else if (onRay) setPixel(c, x, y, [255, 214, 130, clamp255(a * 0.8)]);
      }
    }
    frames.push(c);
  }
  return frames;
}

/* ===========================================================
   8. 组装全部图集
   =========================================================== */

const sprites = {};     // name -> canvas
const groups = {};      // name -> [spriteName, ...]

function addSprite(name, canvas) {
  if (sprites[name]) throw new Error('重复的精灵名: ' + name);
  sprites[name] = canvas;
}

function addGroup(name, frames) {
  groups[name] = frames;
}

/* 主角美术源：形状 + 皮肤表（tools/player-art.js）。
   放在模块级，buildAll 与 writeSpritesJs 都要用（后者把皮肤表写进图集给 UI 读）。 */
const playerArt = require('./player-art.js');

function buildAll() {
  /* --- 玩家：每皮肤 × 三方向 × 四帧 ---
     形状与配色分离在 tools/player-art.js 里：加皮肤只改那边的 SKINS 表。
     帧循环顺序 [0,1,2,3] 让左右脚交替。 */
  playerArt.SKINS.forEach(function (skin) {
    playerArt.DIRS.forEach(function (dir) {
      const names = [];
      playerArt.FRAMES.forEach(function (f) {
        const n = 'p_' + skin.id + '_' + dir + '_' + f;
        const rows = playerArt.buildFrame(dir, f);
        addSprite(n, buildSprite(n, rows, skin.pal));
        names.push(n);
      });
      addGroup('player_' + skin.id + '_' + dir, names);
    });
  });

  /* 兼容：默认皮肤仍叫 player_down / player_up / player_side，
     老代码（探针 / 存档 / 任何还在按旧名取帧的地方）不会一下子全断。 */
  playerArt.DIRS.forEach(function (dir) {
    const src = groups['player_' + playerArt.SKINS[0].id + '_' + dir];
    addGroup('player_' + dir, src.slice());
  });

  /* --- 怪物 --- */
  const humanoids = [
    ['zombie', ZOMBIE_BODY, PAL_ZOMBIE, LEGS_A, LEGS_C],
    ['skeleton', SKELETON_BODY, PAL_SKELETON, LEGS_A, LEGS_B],
    ['wraith', WRAITH_BODY, PAL_WRAITH, LEGS_B, LEGS_C],
    ['brute', BRUTE_BODY, PAL_BRUTE, LEGS_B, LEGS_A],
    ['elite', ELITE_BODY, PAL_ELITE, LEGS_C, LEGS_A]
  ];

  humanoids.forEach(([id, body, pal, l0, l1]) => {
    const a = `${id}_0`;
    const b = `${id}_1`;
    addSprite(a, buildSprite(a, withLegs(body, l0), pal));
    addSprite(b, buildSprite(b, withLegs(body, l1), pal));
    addGroup(id, [a, b]);
  });

  addSprite('bat_0', buildSprite('bat_0', BAT_0, PAL_BAT));
  addSprite('bat_1', buildSprite('bat_1', BAT_1, PAL_BAT));
  addGroup('bat', ['bat_0', 'bat_1']);

  addSprite('ghost_0', buildSprite('ghost_0', GHOST_BODY, PAL_GHOST));
  addSprite('ghost_1', buildSprite('ghost_1', GHOST_BODY_2, PAL_GHOST));
  addGroup('ghost', ['ghost_0', 'ghost_1']);

  /* --- 子弹 --- */
  const BOLT_0 = [
    '...KK...',
    '..KWWK..',
    '.KWCCWK.',
    'KWCCCCWK',
    'KWCCCCWK',
    '.KWCCWK.',
    '..KWWK..',
    '...KK...'
  ];
  const BOLT_1 = [
    '........',
    '...KK...',
    '..KWWK..',
    '.KWCCWK.',
    '.KWCCWK.',
    '..KWWK..',
    '...KK...',
    '........'
  ];
  addSprite('bolt_0', buildSprite('bolt_0', BOLT_0, PAL_BOLT));
  addSprite('bolt_1', buildSprite('bolt_1', BOLT_1, PAL_BOLT));
  addGroup('bolt', ['bolt_0', 'bolt_1', 'bolt_0', 'bolt_1']);

  /* --- 经验石 / 红心 / 骨刃 --- */
  [['gem_0', PAL_GEM], ['gem_1', PAL_GEM2], ['gem_2', PAL_GEM3]].forEach(([n, pal]) => {
    addSprite(n, buildSprite(n, GEM_SHAPE, pal));
  });
  addGroup('gem', ['gem_0', 'gem_1', 'gem_2']);

  addSprite('heart', buildSprite('heart', HEART_SHAPE, PAL_HEART));
  addSprite('blade', buildSprite('blade', BLADE_SHAPE, PAL_BLADE));

  /* --- 爆炸 / 火花 --- */
  const boomFrames = makeExplosionFrames();
  const boomNames = boomFrames.map((c, i) => {
    const n = `boom_${i}`;
    addSprite(n, c);
    return n;
  });
  addGroup('boom', boomNames);

  const sparkFrames = makeSparkFrames();
  const sparkNames = sparkFrames.map((c, i) => {
    const n = `spark_${i}`;
    addSprite(n, c);
    return n;
  });
  addGroup('spark', sparkNames);

  /* --- 地面与装饰 ---
     两张主题地表：第一关「血色荒野」焦土锈红、第二关「柠檬深渊」酸沼黄绿。
     都是 128×128 无缝平铺，renderer 按 img.naturalWidth 取周期，零代码改动。 */
  addSprite('ground', makeBiomeGroundTile('waste'));
  addSprite('ground_l2', makeBiomeGroundTile('abyss'));

  /* --- 反解回来的精灵（Boss / 柠檬猪 / 宠物 / 经验球 / 酸液） --- */
  REVERSED_SPRITES.forEach(function (e) { addSprite(e[0], buildSprite(e[0], e[1], e[2])); });
  REVERSED_GROUPS.forEach(function (e) { addGroup(e[0], e[1]); });

  const decos = [
    ['rock', DECO_ROCK, PAL_ROCK],
    ['bones', DECO_BONES, PAL_BONE],
    ['grass', DECO_GRASS, PAL_GRASS],
    ['mushroom', DECO_MUSH, PAL_MUSH],
    ['skull', DECO_SKULL, PAL_SKULL],
    ['grave', DECO_GRAVE, PAL_GRAVE],
    ['stump', DECO_STUMP, PAL_STUMP],
    ['bush', DECO_BUSH, PAL_BUSH]
  ];
  const decoNames = [];
  decos.forEach(([id, rows, pal]) => {
    const n = 'deco_' + id;
    addSprite(n, buildSprite(n, rows, pal));
    decoNames.push(n);
  });
  /* 通用组：两关都能用的中性物件（石头 / 骨头 / 草），没有专属组的关卡退回它 */
  addGroup('deco', decoNames);

  /* --- 主题点缀：按生物群落分组的专属物件 ---
     第一关「血色荒野」要的是废墟与焦土感，第二关「柠檬深渊」要的是酸沼与柠檬，
     两关不再共用同一套点缀（原来两关都撒那 8 个中性物件，看起来当然一模一样）。
     level 侧由 C.LEVELS[i].deco 指定用哪个组。 */
  const themeGroups = {};
  DECO_THEME_MAP.forEach(([groupName, props]) => {
    const list = themeGroups[groupName] || (themeGroups[groupName] = []);
    Object.keys(props).forEach((id) => {
      const spriteName = 'deco_' + id;
      addSprite(spriteName, buildSprite(spriteName, props[id].rows, props[id].pal));
      list.push(spriteName);
    });
  });
  Object.keys(themeGroups).forEach((g) => addGroup(g, themeGroups[g]));
}

/* ===========================================================
   9. 预览图（只在本地生成，不进游戏）
   =========================================================== */

/* ---- >>> 反解精灵（由 vs-art-reverse.mjs + vs-art-revparse.mjs 生成，勿手改） <<< ---- */
/* ===========================================================
   6b. Boss / 宠物 / 特殊掉落：从线上图集反解回来的字符画
   -----------------------------------------------------------
   这批精灵当初是直接写进 sprites.js、没有回灌生成器的，
   这里把它们反解成"字符画 + 调色板"补齐，保证图集可完整重建。
   生成结果与原图逐字节一致（tools/vs-art-compare.mjs 可验）。
   =========================================================== */

const BOSS_0 = [
  '........................',
  '.......KK......KK.......',
  '......KHHK....KHHK......',
  '......KHHKKKKKKHHK......',
  '.....KKMMMMMMMMMMKK.....',
  '....KMMMMMMMMMMMMMMK....',
  '...KMMMMMMMMMMMMMMMMK...',
  '...KMMhhMMMMMMMMhhMMK...',
  '...KMMhhMMMMMMMMhhMMK...',
  '...KMMMMMMMSSMMMMMMMK...',
  '...KMMMMMMSSSSMMMMMMK...',
  '....KMMMMMSSSSMMMMMK....',
  '.....KKMMMMMMMMMMKK.....',
  '...KKKMMMMMMMMMMMMKKK...',
  '..KMMMMMMMMMMMMMMMMMMK..',
  '..KMMMMMMMMMMMMMMMMMMK..',
  '..KMMMMMMMMMMMMMMMMMMK..',
  '..KMMKMMMMMMMMMMMMKMMK..',
  '..KMMKMMMMMMMMMMMMKMMK..',
  '...KKKMMMMMMMMMMMMKKK...',
  '.....KMMMMMMMMMMMMK.....',
  '.....KMMMMMMMMMMMMK.....',
  '....KKMMKKMMKKMMKKMMKK..',
  '....KKK..KK..KK..KKK....',
];
const PAL_BOSS_0 = {
  'K': '#101c0d', 'H': '#e6e0c8', 'M': '#5f9e57', 'h': '#ff3b2f',
  'S': '#26401f'
};

const BOSS_1 = [
  '........................',
  '.......KK......KK.......',
  '......KHHK....KHHK......',
  '......KHHKKKKKKHHK......',
  '.....KKMMMMMMMMMMKK.....',
  '....KMMMMMMMMMMMMMMK....',
  '...KMMMMMMMMMMMMMMMMK...',
  '...KMMhhMMMMMMMMhhMMK...',
  '...KMMhhMMMMMMMMhhMMK...',
  '...KMMMMMMMSSMMMMMMMK...',
  '...KMMMMMMSSSSMMMMMMK...',
  '....KMMMMMSSSSMMMMMK....',
  '.....KKMMMMMMMMMMKK.....',
  '..KKKKMMMMMMMMMMMMKKKK..',
  '..KMMMMMMMMMMMMMMMMMMK..',
  '..KMMMMMMMMMMMMMMMMMMK..',
  '..KMMMMMMMMMMMMMMMMMMK..',
  '...KMMKMMMMMMMMMMMMKMMK.',
  '...KMMKMMMMMMMMMMMMKMMK.',
  '...KKKMMMMMMMMMMMMKKK...',
  '.....KMMMMMMMMMMMMK.....',
  '.....KMMMMMMMMMMMMK.....',
  '.....KMMKKMMKKMMKKMMK...',
  '.....KK..KK..KK..KK.....',
];
const PAL_BOSS_1 = {
  'K': '#101c0d', 'H': '#e6e0c8', 'M': '#5f9e57', 'h': '#ff3b2f',
  'S': '#26401f'
};

const ORB_GOLD = [
  '....KKKK....',
  '..KKHHHHKK..',
  '.KHHMMMMHHK.',
  'KHMMMMMMMMHK',
  'KHMMHHHHMMHK',
  'KHMHHHHHHMHK',
  'KHMHHHHHHMHK',
  'KHMMHHHHMMHK',
  '.KHHMMMMHHK.',
  '..KKHHHHKK..',
  '....KKKK....',
  '............',
];
const PAL_ORB_GOLD = {
  'K': '#5a3c00', 'H': '#ffc93c', 'M': '#fff6cc'
};

const ORB_SUPER = [
  '......KKKK......',
  '....KKHHHHKK....',
  '...KHHHHHHHHK...',
  '..KHHMMMMMMHHK..',
  '.KHHMMhhhhMMHHK.',
  '.KHMMhhSShhMMHK.',
  'KHHMhhSSSShhMHHK',
  'KHMhhSSHHSShhMHK',
  'KHMhhSSHHSShhMHK',
  'KHHMhhSSSShhMHHK',
  '.KHMMhhSShhMMHK.',
  '.KHHMMhhhhMMHHK.',
  '..KHHMMMMMMHHK..',
  '...KHHHHHHHHK...',
  '....KKHHHHKK....',
  '......KKKK......',
];
const PAL_ORB_SUPER = {
  'K': '#3a2a00', 'H': '#ffffff', 'M': '#7ee0ff', 'h': '#ffd166',
  'S': '#ff9ae0'
};

const ACID = [
  '..KKKK..',
  '.KHHHHK.',
  'KHMMHHHK',
  'KHMHHHHK',
  'KHHHHHHK',
  '.KHHHHK.',
  '..KhhK..',
  '...KK...',
];
const PAL_ACID = {
  'K': '#243305', 'H': '#c7f24a', 'M': '#f2ffd0', 'h': '#8fc22c'
};

const PET_FAERIE_0 = [
  '................',
  '.......KK.......',
  '......KHHK......',
  '.....KHHHHK.....',
  '....KHMHHMHK....',
  '....KHHHHHHK....',
  '.....KHHHHK.....',
  '...KKKHHHHKKK...',
  '..KhhKHHHHKhhK..',
  '.KhhhhKHHKhhhhK.',
  '.KhhhhKHHKhhhhK.',
  '..KhhKHHHHKhhK..',
  '...KKKHHHHKKK...',
  '.....KHHHHK.....',
  '......KSSK......',
  '.......KK.......',
];
const PAL_PET_FAERIE_0 = {
  'K': '#0f2418', 'H': '#a6f7b0', 'M': '#123322', 'h': '#bff3ff',
  'S': '#fff6cc'
};

const PET_FAERIE_1 = [
  '................',
  '.......KK.......',
  '......KHHK......',
  '.....KHHHHK.....',
  '....KHMHHMHK....',
  '....KHHHHHHK....',
  '.....KHHHHK.....',
  '..KKKKHHHHKKKK..',
  '.KhhKKHHHHKKhhK.',
  'KhhhK.KHHK.KhhhK',
  'KhhhK.KHHK.KhhhK',
  '.KhhKKHHHHKKhhK.',
  '..KKKKHHHHKKKK..',
  '.....KHHHHK.....',
  '......KSSK......',
  '.......KK.......',
];
const PAL_PET_FAERIE_1 = {
  'K': '#0f2418', 'H': '#a6f7b0', 'M': '#123322', 'h': '#bff3ff',
  'S': '#fff6cc'
};

const PET_PIG_0 = [
  '................',
  '...KK......KK...',
  '..KHHK....KHHK..',
  '..KHHKKKKKKHHK..',
  '.KHHHHHHHHHHHHK.',
  '.KHHKHHHHHHKHHK.',
  '.KHMHKHHHHKHMHK.',
  '.KHHHKHHHHKHHHK.',
  '.KHHHHHHHHHHHHK.',
  '.KHHHhhhhhhHHHK.',
  '.KHHKhMhMhMhKHK.',
  '.KHHHhhhhhhHHHK.',
  '.KHHHHHHHHHHHHK.',
  '..KHHHHHHHHHHK..',
  '...KKHHHHHHKK...',
  '.....KKKKKK.....',
];
const PAL_PET_PIG_0 = {
  'K': '#2b0716', 'H': '#ffb4c8', 'M': '#3b0a1c', 'h': '#fff0f4'
};

const PET_PIG_1 = [
  '................',
  '..KK........KK..',
  '.KHHK......KHHK.',
  '.KHHKKKKKKKKHHK.',
  '.KHHHHHHHHHHHHK.',
  '.KHHKHHHHHHKHHK.',
  '.KHMHKHHHHKHMHK.',
  '.KHHHKHHHHKHHHK.',
  '.KHHHHHHHHHHHHK.',
  '.KHHHhhhhhhHHHK.',
  '.KHHKhMhMhMhKHK.',
  '.KHHHhhhhhhHHHK.',
  '.KHHHHHHHHHHHHK.',
  '..KHHHHHHHHHHK..',
  '..KKKHHHHHHKKK..',
  '..KK..KKKK..KK..',
];
const PAL_PET_PIG_1 = {
  'K': '#2b0716', 'H': '#ffb4c8', 'M': '#3b0a1c', 'h': '#fff0f4'
};

const PET_LEMONPIG_0 = [
  '................',
  '...........KK...',
  '..HH......HMMH..',
  '.HMMH....HMMMH..',
  '.HMMHHHHHHMMMH..',
  '.HMMMMMMMMMMMMH.',
  '.HMMHMMMMMMHMMH.',
  '.HMhHMMMMMMHhMH.',
  '.HMMMHHMMHHMMMH.',
  '.HMMMHSSSSHMMMH.',
  '.HMMMHSESEHMMMH.',
  '.HMMMHSSSSHMMMH.',
  '.HMMMMMMMMMMMMH.',
  '..HMMMMMMMMMMH..',
  '..HHMMMMMMMMHH..',
  '...HHH....HHH...',
];
const PAL_PET_LEMONPIG_0 = {
  'K': '#a8e05f', 'H': '#2a2405', 'M': '#ffe14d', 'h': '#3b2f00',
  'S': '#fffde0', 'E': '#7a6a10'
};

const PET_LEMONPIG_1 = [
  '................',
  '...........KK...',
  '.HH........HMMH.',
  'HMMH......HMMMH.',
  'HMMHHHHHHHHMMMH.',
  '.HMMMMMMMMMMMMH.',
  '.HMMHMMMMMMHMMH.',
  '.HMhHMMMMMMHhMH.',
  '.HMMMHHMMHHMMMH.',
  '.HMMMHSSSSHMMMH.',
  '.HMMMHSESEHMMMH.',
  '.HMMMHSSSSHMMMH.',
  '.HMMMMMMMMMMMMH.',
  '..HMMMMMMMMMMH..',
  '..HHMMMMMMMMHH..',
  '..HHH......HHH..',
];
const PAL_PET_LEMONPIG_1 = {
  'K': '#a8e05f', 'H': '#2a2405', 'M': '#ffe14d', 'h': '#3b2f00',
  'S': '#fffde0', 'E': '#7a6a10'
};

const LEMONPIG_0 = [
  '........................',
  '...........KK...........',
  '.......HH......HH.......',
  '......HMMH....HMMH......',
  '......HMMHHHHHHMMH......',
  '.....HMMMMMMMMMMMMH.....',
  '....HMMMMMMMMMMMMMMH....',
  '...HMMMMMMMMMMMMMMMMH...',
  '..HMMMHHMMMMMMMMHHMMMH..',
  '..HMMHhHMMMMMMMMHhHMMH..',
  '..HMMMHHMMMMMMMMHHMMMH..',
  '..HMMMMMMMMMMMMMMMMMMH..',
  '..HMMMMHHHHHHHHHHMMMMH..',
  '..HMMMHSSSSSSSSSSHMMMH..',
  '..HMMMHSSESSSSESSHMMMH..',
  '..HMMMHSSSSSSSSSSHMMMH..',
  '..HMMMMHHHHHHHHHHMMMMH..',
  '..HMMMMMMMMMMMMMMMMMMH..',
  '...HMMMMMMMMMMMMMMMMH...',
  '....HMMMMMMMMMMMMMMH....',
  '.....HMMMMMMMMMMMMH.....',
  '......HMMMMMMMMMMH......',
  '.......HMMMMMMMMH.......',
  '........HHMMMMHH........',
];
const PAL_LEMONPIG_0 = {
  'K': '#a8e05f', 'H': '#2a2405', 'M': '#ffe14d', 'h': '#3b2f00',
  'S': '#fffde0', 'E': '#7a6a10'
};

const LEMONPIG_1 = [
  '........................',
  '...........KK...........',
  '.......HH......HH.......',
  '......HMMH....HMMH......',
  '......HMMHHHHHHMMH......',
  '.....HMMMMMMMMMMMMH.....',
  '....HMMMMMMMMMMMMMMH....',
  '...HMMMMMMMMMMMMMMMMH...',
  '..HMMMHHMMMMMMMMHHMMMH..',
  '..HMMHhHMMMMMMMMHhHMMH..',
  '..HMMMHHMMMMMMMMHHMMMH..',
  '..HMMMMMMMMMMMMMMMMMMH..',
  '..HMMMMHHHHHHHHHHMMMMH..',
  '..HMMMHSSSSSSSSSSHMMMH..',
  '..HMMMHSSESSSSESSHMMMH..',
  '..HMMMHSSSSSSSSSSHMMMH..',
  '..HMMMMHHHHHHHHHHMMMMH..',
  '..HMMMMMMMMMMMMMMMMMMH..',
  '...HMMMMMMMMMMMMMMMMH...',
  '....HMMMMMMMMMMMMMMH....',
  '.....HMMMMMMMMMMMMH.....',
  '......HMMMMMMMMMMH......',
  '.......HMMMMMMMMH.......',
  '.........HHCCHH.........',
];
const PAL_LEMONPIG_1 = {
  'K': '#a8e05f', 'H': '#2a2405', 'M': '#ffe14d', 'h': '#3b2f00',
  'S': '#fffde0', 'E': '#7a6a10', 'C': '#c7f24a'
};

/* 反解精灵清单：[精灵名, 字符画, 调色板] —— 直接喂给 buildSprite */
const REVERSED_SPRITES = [
  ['boss_0', BOSS_0, PAL_BOSS_0],
  ['boss_1', BOSS_1, PAL_BOSS_1],
  ['orb_gold', ORB_GOLD, PAL_ORB_GOLD],
  ['orb_super', ORB_SUPER, PAL_ORB_SUPER],
  ['acid', ACID, PAL_ACID],
  ['pet_faerie_0', PET_FAERIE_0, PAL_PET_FAERIE_0],
  ['pet_faerie_1', PET_FAERIE_1, PAL_PET_FAERIE_1],
  ['pet_pig_0', PET_PIG_0, PAL_PET_PIG_0],
  ['pet_pig_1', PET_PIG_1, PAL_PET_PIG_1],
  ['pet_lemonPig_0', PET_LEMONPIG_0, PAL_PET_LEMONPIG_0],
  ['pet_lemonPig_1', PET_LEMONPIG_1, PAL_PET_LEMONPIG_1],
  ['lemonPig_0', LEMONPIG_0, PAL_LEMONPIG_0],
  ['lemonPig_1', LEMONPIG_1, PAL_LEMONPIG_1],
];

/* 反解精灵的动画组（与本实体在线上图集里的分组一致） */
const REVERSED_GROUPS = [
  ['boss', ['boss_0', 'boss_1']],
  ['pet_faerie', ['pet_faerie_0', 'pet_faerie_1']],
  ['pet_pig', ['pet_pig_0', 'pet_pig_1']],
  ['pet_lemonPig', ['pet_lemonPig_0', 'pet_lemonPig_1']],
  ['lemonPig', ['lemonPig_0', 'lemonPig_1']],
];
/* ---- >>> 反解精灵 结束 <<< ---- */

function writeSheet(file, names, cols, scale, gap) {
  // 格子尺寸按本组最大精灵算，地面贴图(64x64)和角色(16x16)才能同框
  const maxW = Math.max.apply(null, names.map(n => sprites[n].w));
  const maxH = Math.max.apply(null, names.map(n => sprites[n].h));

  const cellW = maxW * scale + gap;
  const cellH = maxH * scale + gap;
  const rows = Math.ceil(names.length / cols);
  const W = cols * cellW;
  const H = rows * cellH;

  const sheet = createCanvas(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dark = ((Math.floor(x / 8) + Math.floor(y / 8)) & 1) === 0;
      const v = dark ? 46 : 62;
      setPixel(sheet, x, y, [v, v, v + 8, 255]);
    }
  }

  names.forEach((n, i) => {
    const sp = sprites[n];
    const cx = (i % cols) * cellW + gap / 2;
    const cy = Math.floor(i / cols) * cellH + gap / 2;
    const ox = cx + Math.floor((maxW * scale - sp.w * scale) / 2);
    const oy = cy + Math.floor((maxH * scale - sp.h * scale) / 2);

    for (let y = 0; y < sp.h; y++) {
      for (let x = 0; x < sp.w; x++) {
        const p = getPixel(sp, x, y);
        if (!p[3]) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            setPixel(sheet, ox + x * scale + sx, oy + y * scale + sy, [p[0], p[1], p[2], 255]);
          }
        }
      }
    }
  });

  fs.mkdirSync(OUT_PREVIEW_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_PREVIEW_DIR, file), encodePNG(W, H, sheet.data));
  return { file, W, H };
}

/** 把地砖平铺 + 散布装饰，检查场景观感 */
function writeGroundPreview() {
  const ground = sprites['ground'];
  const TS = ground.w;              // 地砖尺寸（64）
  const tiles = 5;
  const scale = 2;
  const TW = TS * tiles;
  const W = TW * scale;
  const H = TW * scale;
  const c = createCanvas(W, H);

  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      for (let y = 0; y < TS; y++) {
        for (let x = 0; x < TS; x++) {
          const p = getPixel(ground, x, y);
          const px = (tx * TS + x) * scale;
          const py = (ty * TS + y) * scale;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              setPixel(c, px + sx, py + sy, [p[0], p[1], p[2], 255]);
            }
          }
        }
      }
    }
  }

  // 散布装饰（模拟游戏内按坐标哈希摆放的效果）
  const decoNames = groups['deco'];
  for (let i = 0; i < 34; i++) {
    const n = decoNames[i % decoNames.length];
    const sp = sprites[n];
    const ox = Math.floor(hash2(i * 3.7, 1.3) * (TW - 20)) * scale;
    const oy = Math.floor(hash2(2.1, i * 5.9) * (TW - 20)) * scale;

    for (let y = 0; y < sp.h; y++) {
      for (let x = 0; x < sp.w; x++) {
        const p = getPixel(sp, x, y);
        if (!p[3]) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            setPixel(c, ox + x * scale + sx, oy + y * scale + sy, [p[0], p[1], p[2], 255]);
          }
        }
      }
    }
  }

  fs.mkdirSync(OUT_PREVIEW_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_PREVIEW_DIR, 'preview_ground.png'), encodePNG(W, H, c.data));
  return { file: 'preview_ground.png', W, H };
}

/* ===========================================================
   10. 输出 sprites.js
   =========================================================== */

function writeSpritesJs() {
  const names = Object.keys(sprites);
  let totalBytes = 0;
  const entries = [];

  names.forEach((n) => {
    const c = sprites[n];
    const png = encodePNG(c.w, c.h, c.data);
    totalBytes += png.length;

    // 自检：解压回来必须和原始像素完全一致
    const idat = pngChunkData(png, 'IDAT');
    const raw = zlib.inflateSync(idat);
    const stride = c.w * 4;
    for (let y = 0; y < c.h; y++) {
      if (raw[y * (stride + 1)] !== 0) throw new Error(`[${n}] 扫描行过滤器异常`);
      for (let i = 0; i < stride; i++) {
        if (raw[y * (stride + 1) + 1 + i] !== c.data[y * stride + i]) {
          throw new Error(`[${n}] PNG 编解码不一致 @row ${y} byte ${i}`);
        }
      }
    }

    entries.push(
      `    ${JSON.stringify(n)}: { w: ${c.w}, h: ${c.h}, uri: "${'data:image/png;base64,' + png.toString('base64')}" }`
    );
  });

  const groupLines = Object.keys(groups).map((g) => {
    return `    ${JSON.stringify(g)}: [${groups[g].map(s => '"' + s + '"').join(', ')}]`;
  });

  const out = `/* ===========================================================
   像素图集（自动生成，请勿手改）
   -----------------------------------------------------------
   由 tools/gen-sprites.js 生成：
     字符画 + 调色板  ->  RGBA  ->  PNG  ->  base64
   这里内嵌的是完整的 PNG 二进制（data:image/png;base64,...），
   不依赖任何外部图片文件，也不联网，双击 index.html 即可用。
   要改美术：编辑 tools/gen-sprites.js 后重新运行 node tools/gen-sprites.js
   =========================================================== */
(function (VS) {
  'use strict';

  /** 单帧图：name -> { w, h, uri } */
  VS.SpriteData = {
${entries.join(',\n')}
  };

  /** 动画分组：name -> [帧名, ...]，直接按数组顺序循环播放 */
  VS.SpriteGroups = {
${groupLines.join(',\n')}
  };

  VS.SpriteInfo = { count: ${names.length}, pngBytes: ${totalBytes} };

  /** 主角皮肤：UI 直接用这份渲染皮肤选择器，不要在别处再写死一遍。
      数据源是 tools/player-art.js 的 SKINS 表。 */
  VS.PlayerSkins = ${JSON.stringify(playerArt.SKINS.map(function (s) { return { id: s.id, name: s.name, pal: s.pal }; }), null, 2)};

})(window.VS = window.VS || {});
`;

  fs.mkdirSync(path.dirname(OUT_JS), { recursive: true });
  fs.writeFileSync(OUT_JS, out, 'utf8');

  return { count: names.length, pngBytes: totalBytes, jsBytes: Buffer.byteLength(out, 'utf8') };
}

/** 从 PNG buffer 里取出指定 chunk 的数据 */
function pngChunkData(png, type) {
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const t = png.toString('ascii', off + 4, off + 8);
    if (t === type) return png.slice(off + 8, off + 8 + len);
    off += 12 + len;
  }
  throw new Error('缺少 chunk: ' + type);
}

/* ===========================================================
   主流程
   =========================================================== */

function main() {
  buildAll();

  const info = writeSpritesJs();

  const actors = Object.keys(sprites).filter(n =>
    n.startsWith('player_') || groups['bat'].includes(n) || groups['ghost'].includes(n) ||
    ['zombie_0', 'zombie_1', 'skeleton_0', 'skeleton_1', 'wraith_0', 'wraith_1',
     'brute_0', 'brute_1', 'elite_0', 'elite_1'].includes(n));

  const fx = groups['bolt'].concat(groups['boom'], groups['spark']);
  const world = ['ground'].concat(groups['deco'], groups['gem'], ['heart', 'blade']);

  const s1 = writeSheet('preview_actors.png', actors, 6, 4, 8);
  const s2 = writeSheet('preview_fx.png', fx, 6, 4, 6);
  const s3 = writeSheet('preview_world.png', world, 5, 2, 8);
  const s4 = writeGroundPreview();

  console.log('生成完成');
  console.log(`  精灵数量 : ${info.count}`);
  console.log(`  PNG 原始 : ${(info.pngBytes / 1024).toFixed(1)} KB`);
  console.log(`  sprites.js: ${(info.jsBytes / 1024).toFixed(1)} KB`);
  console.log('  预览图   :');
  [s1, s2, s3, s4].forEach(s => console.log(`    tools/preview/${s.file}  (${s.W}x${s.H})`));
}

main();
