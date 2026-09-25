/* ===========================================================
   主角美术源（20×24）—— 由 games/vampire-survivors/tools/gen-sprites.js 读取
   -----------------------------------------------------------
   形状与配色分离：加皮肤只往 SKINS 表加一行，不用碰任何字符画。

   【2026-09-25 重做】上一版的问题：走路时斗篷外侧各有一块 2×2 的"手"，
   四帧里在 13~15 行上下跳 —— 看起来不像手臂，像身子两侧长了会动的肉刺。
   在 20×24 这个尺寸下，"伸出去的手臂"没有空间画成连续的手臂，
   贴在斗篷外就永远是独立方块。所以这一版**不再外露手**：
   走路靠腿的左右摆动 + 渲染层已有的奇数帧上下弹跳表现
   （renderer.drawPlayer 的 bob）。手掌被斗篷挡住也是同类俯视像素游戏的通行做法。

   行布局（脚底对齐第 22 行）：
     2-3   帽尖（2 格宽，做出尖顶剪影）
     4-5   帽筒（4 / 6 格）
     6-7   帽檐（8 / 10 格，剪影靠它立住）
     8-10  脸（第 9 行两只眼睛 E）
     11    围巾 R
     12-16 斗篷躯干（第 15 行金边腰带 T）
     17-18 下摆（迈步帧两侧各让出一格，腿才不会插进斗篷）
     19-20 裤腿（B）
     21-22 靴（K）
   方向：down / up / side（side 由渲染层 flipX 复用为左右）
   帧数：每方向 4 帧（0 站立、1 迈步、2 站立、3 反向迈步）
   =========================================================== */

'use strict';

const W = 20, H = 24;
const DIRS = ['down', 'up', 'side'];
const FRAMES = [0, 1, 2, 3];

/* ===========================================================
   1. 皮肤
   字符：K 轮廓 k 暗部 H 帽主 h 帽暗 S 脸亮 s 脸暗 E 眼
        C 斗篷主 c 斗篷暗 T 金边 R 围巾 B 裤/腿
   =========================================================== */

const SKINS = [
  {
    id: 'witch', name: '紫袍巫女',
    pal: {
      K: '#140e20', k: '#2a1c3d',
      H: '#4b2f72', h: '#33204f',
      S: '#f7d0a8', s: '#d9ab80', E: '#231930',
      C: '#7d59c8', c: '#553a94', T: '#ffd166',
      R: '#c0392b', B: '#2b1f3d'
    }
  },
  {
    id: 'crimson', name: '血袍骑士',
    pal: {
      K: '#1a0a0c', k: '#33161a',
      H: '#7a1f22', h: '#521417',
      S: '#f2c9a0', s: '#d3a074', E: '#2a1214',
      C: '#b8352f', c: '#83211f', T: '#f0c05a',
      R: '#f0e0c0', B: '#3a1a18'
    }
  },
  {
    id: 'frost', name: '霜袍术士',
    pal: {
      K: '#0c1620', k: '#1b3040',
      H: '#1f4d6b', h: '#14374e',
      S: '#e8d8c8', s: '#c4b0a0', E: '#16303f',
      C: '#4f9fd4', c: '#2f6d9b', T: '#d8f0ff',
      R: '#9fe0ff', B: '#1b3244'
    }
  },
  {
    id: 'venom', name: '毒沼术士',
    pal: {
      K: '#141c08', k: '#2a3813',
      H: '#3f5c10', h: '#2a3f0a',
      S: '#e0d8a8', s: '#bcb078', E: '#1e2a0c',
      C: '#8fb52a', c: '#5f8518', T: '#e8f47a',
      R: '#c2e03c', B: '#26330f'
    }
  }
];

/* ===========================================================
   2. 绘制基元
   =========================================================== */

const blank = () => Array.from({ length: H }, () => new Array(W).fill('.'));

/** 在某行 [x0, x1] 闭区间涂 ch（越界自动裁剪） */
function put(g, y, x0, x1, ch) {
  for (let x = x0; x <= x1; x++) if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = ch;
}

/** 从 x0 开始逐字符写一行，'.' = 跳过（保留已有像素） */
function stamp(g, y, x0, str) {
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '.') continue;
    const x = x0 + i;
    if (x < 0 || x >= W) continue;
    g[y][x] = ch;
  }
}

/* ===========================================================
   3. 部件
   =========================================================== */

/* 尖顶帽：帽尖 2 格 -> 帽筒 4/6 -> 帽檐 8/10 */
function drawHat(g) {
  stamp(g, 2, 9, 'KK');
  stamp(g, 3, 8, 'KHHK');
  stamp(g, 4, 7, 'KHHHHK');
  stamp(g, 5, 6, 'KHHHHHHK');
  stamp(g, 6, 5, 'KHHHHHHHHK');
  stamp(g, 7, 4, 'KKKKKKKKKK');
}

/* 正面：露两只眼；背面：帽筒阴影 + 头发 */
function drawHead(g, dir) {
  if (dir === 'down') {
    stamp(g, 8, 6, 'KSSSSSSK');
    stamp(g, 9, 6, 'KSEESSEK');
    stamp(g, 10, 6, 'KSssssSK');
  } else {
    stamp(g, 8, 6, 'KhhhhhhK');
    stamp(g, 9, 6, 'KhhhhhhK');
    stamp(g, 10, 6, 'KhhhhhhK');
  }
}

/* 侧视：帽子后移、只露半张脸、眼睛靠前 */
function drawHeadSide(g) {
  stamp(g, 4, 6, 'KHHHHHHK');
  stamp(g, 5, 5, 'KHHHHHHHHK');
  stamp(g, 6, 4, 'KHHHHHHHHK');
  stamp(g, 7, 4, 'KKKKKKKKKK');
  stamp(g, 8, 6, 'KSSSSSK');
  stamp(g, 9, 6, 'KSEESSK');
  stamp(g, 10, 6, 'KSsssK');
}

/* 围巾 + 斗篷：肩 8 格 -> 下摆 12 格，第 15 行金边腰带。
   全程不画手臂/手 —— 手被斗篷挡住，理由见文件头。 */
function drawCloak(g, hemWide) {
  stamp(g, 11, 6, 'KRRRRRRK');
  stamp(g, 12, 5, 'KKCCCCCCKK');
  stamp(g, 13, 5, 'KCCCCCCCCK');
  stamp(g, 14, 5, 'KCCCCCCCCK');
  stamp(g, 15, 5, 'KCCTTTTCCK');
  stamp(g, 16, 5, 'KCCCCCCCCK');

  const half = hemWide ? 6 : 5;   // 下摆半宽（含轮廓）
  const body = 'C'.repeat(half * 2 - 2);
  stamp(g, 17, 10 - half, 'K' + body + 'K');
  stamp(g, 18, 10 - half, 'K' + body + 'K');
}

/* 腿：四帧交替。裤腿 B 在 19~20 行，靴 K 在 21~22 行。
   站立帧两腿关于中轴 x=10 对称；迈步帧两腿各外移一格（跨步感），
   两腿之间始终留出空隙，腿和斗篷也不会连在一起。 */
const LEG_POSES = [
  /* 0 / 2 站立：两腿并拢 */
  { top: [[7, 8], [11, 12]], low: [[7, 8], [11, 12]] },
  /* 1 / 3 迈步：两腿外移一格 */
  { top: [[6, 7], [12, 13]], low: [[6, 7], [12, 13]] }
];
const LEG_FOR = [0, 1, 0, 1];

function drawLegs(g, frame) {
  const p = LEG_POSES[LEG_FOR[frame]];
  for (const [a, b] of p.top) put(g, 19, a, b, 'B');
  for (const [a, b] of p.low) put(g, 20, a, b, 'B');
  /* 靴：比裤腿各宽一格，压出脚型 */
  for (const [a, b] of p.low) {
    put(g, 21, a - 1, b + 1, 'K');
    put(g, 22, a - 1, b, 'K');
  }
}

/* ===========================================================
   4. 组装
   =========================================================== */

function buildFrame(dir, frame) {
  const g = blank();

  if (dir === 'side') {
    drawHeadSide(g);
    drawCloak(g, false);
  } else {
    drawHat(g);
    drawHead(g, dir);
    drawCloak(g, true);
  }

  drawLegs(g, frame);

  /* 迈步帧两腿外移，斗篷下摆两侧各让出一格，避免腿"插进"斗篷里 */
  if (LEG_FOR[frame] === 1) {
    g[17][4] = '.';
    g[17][15] = '.';
    g[18][4] = '.';
    g[18][15] = '.';
  }

  return g.map((row) => row.join(''));
}

module.exports = { SKINS, W, H, DIRS, FRAMES, buildFrame };
