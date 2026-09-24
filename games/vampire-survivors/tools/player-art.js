/* ===========================================================
   主角美术源（20×24）—— 由 games/vampire-survivors/tools/gen-sprites.js 读取
   -----------------------------------------------------------
   形状与配色分离：加皮肤只往 SKINS 表加一行，不用碰任何字符画。

   画布 20×24，脚下对齐第 22 行，宽高比 0.83（不做成矮胖方块）。
   行布局：
     0-1   留空
     2-4   帽筒（上窄下宽）
     5-6   帽檐（10~12 格宽，剪影靠它立住）
     7-9   脸（第 8 行两只眼，E）
     10    围巾（R）
     11-15 斗篷躯干（T 是金边腰带，画在第 14 行）
     12-16 手臂（按帧摆动，在斗篷侧面外露手 G）
     17-18 斗篷下摆 + 腰线
     19-21 腿（B）
     22    靴底（K）
   方向：down / up / side（side 由渲染层 flipX 复用为左右）
   帧数：每方向 4 帧（0 站立、1 左摆、2 站立、3 右摆）
   =========================================================== */

'use strict';

const W = 20, H = 24;
const DIRS = ['down', 'up', 'side'];
const FRAMES = [0, 1, 2, 3];

/* ===========================================================
   1. 皮肤
   字符：K 轮廓 H 帽主 h 帽暗 S 脸亮 s 脸暗 E 眼
        C 斗篷主 c 斗篷暗 T 金边 R 围巾 B 靴/腿 G 手
   =========================================================== */

const SKINS = [
  {
    id: 'witch', name: '紫袍巫女',
    pal: {
      K: '#140e20', H: '#4b2f72', h: '#33204f',
      S: '#f7d0a8', s: '#d9ab80', E: '#231930',
      C: '#7d59c8', c: '#553a94', T: '#ffd166',
      R: '#c0392b', B: '#382a4d', G: '#e8c49c'
    }
  },
  {
    id: 'crimson', name: '血袍骑士',
    pal: {
      K: '#1a0a0c', H: '#7a1f22', h: '#521417',
      S: '#f2c9a0', s: '#d3a074', E: '#2a1214',
      C: '#b8352f', c: '#83211f', T: '#f0c05a',
      R: '#f0e0c0', B: '#4a2220', G: '#e0b894'
    }
  },
  {
    id: 'frost', name: '霜袍术士',
    pal: {
      K: '#0c1620', H: '#1f4d6b', h: '#14374e',
      S: '#e8d8c8', s: '#c4b0a0', E: '#16303f',
      C: '#4f9fd4', c: '#2f6d9b', T: '#d8f0ff',
      R: '#9fe0ff', B: '#22415a', G: '#dcc8b4'
    }
  },
  {
    id: 'venom', name: '毒沼术士',
    pal: {
      K: '#141c08', H: '#3f5c10', h: '#2a3f0a',
      S: '#e0d8a8', s: '#bcb078', E: '#1e2a0c',
      C: '#8fb52a', c: '#5f8518', T: '#e8f47a',
      R: '#c2e03c', B: '#2d3f14', G: '#d8d0a0'
    }
  }
];

/* ===========================================================
   2. 绘制基元
   =========================================================== */

const blank = () => Array.from({ length: H }, () => new Array(W).fill('.'));

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

/* 帽子：帽筒 6→8→10 格，帽檐 12 格并两侧下压，剪影靠帽檐 */
function drawHat(g) {
  stamp(g, 2, 7, 'KKKKKK');
  stamp(g, 3, 6, 'KHHHHHHK');
  stamp(g, 4, 5, 'KHHHHHHHHK');
  stamp(g, 5, 4, 'KHHHHHHHHHHK');
  stamp(g, 6, 3, 'KKKKKKKKKKKKKK');
}

/* 脸：朝下时露眼，朝上时是后脑（帽筒阴影 + 头发） */
function drawHead(g, dir) {
  if (dir === 'down') {
    stamp(g, 7, 5, 'KSSSSSSSSK');
    stamp(g, 8, 5, 'KSEESSEESK');
    stamp(g, 9, 5, 'KSssssssSK');
  } else {
    stamp(g, 7, 5, 'KhhhhhhhhK');
    stamp(g, 8, 5, 'KhhhhhhhhK');
    stamp(g, 9, 5, 'KhhhhhhhhK');
  }
}

/* 侧视的头：帽子后移、眼睛靠前、只露半张脸 */
function drawHeadSide(g) {
  stamp(g, 2, 7, 'KKKKK');
  stamp(g, 3, 6, 'KHHHHHK');
  stamp(g, 4, 5, 'KHHHHHHHK');
  stamp(g, 5, 4, 'KHHHHHHHHHK');
  stamp(g, 6, 3, 'KKKKKKKKKKKK');
  stamp(g, 7, 6, 'KSSSSSSK');
  stamp(g, 8, 6, 'KSEESSSK');
  stamp(g, 9, 6, 'KSsssssK');
}

/* 围巾 */
function drawScarf(g, x0) {
  stamp(g, 10, x0, 'KRRRRRRRRK');
}

/* 斗篷：肩窄下摆宽，第 14 行金边腰带 */
function drawCloak(g) {
  stamp(g, 11, 5, 'KKCCCCCCKK');
  stamp(g, 12, 4, 'KCCCCCCCCK');
  stamp(g, 13, 4, 'KCCCCCCCCK');
  stamp(g, 14, 4, 'KCCTTTTCCK');
  stamp(g, 15, 4, 'KCCCCCCCCK');
  stamp(g, 16, 3, 'KCCCCCCCCCCK'.slice(0, 12));
  stamp(g, 17, 3, 'KCCCCCCCCCCK'.slice(0, 12));
  stamp(g, 18, 4, 'KKKKKKKKKK');
}

/* 腿：四帧交替。脚在 19~21，靴底 22 */
const LEG_ROWS = [
  /* 0 / 2 站立：两腿并拢对称 */
  { 19: [[5, 6], [12, 13]], 20: [[5, 6], [12, 13]], 21: [[4, 6], [12, 14]] },
  /* 1 左迈：左腿探前、右腿收后 */
  { 19: [[4, 5], [13, 13]], 20: [[4, 5], [13, 13]], 21: [[3, 5], [13, 14]] },
  /* 3 右迈：右腿探前、左腿收后 */
  { 19: [[6, 6], [11, 12]], 20: [[6, 6], [11, 12]], 21: [[5, 6], [11, 13]] }
];
const LEG_FOR = [0, 1, 0, 2];

function drawLegs(g, frame) {
  const spec = LEG_ROWS[LEG_FOR[frame]];
  for (const y of [19, 20, 21]) {
    for (const [a, b] of spec[y]) put(g, y, a, b, 'B');
  }
  /* 靴底 */
  put(g, 22, spec[21][0][0] - 1, spec[21][0][1] + 1, 'K');
  put(g, 22, spec[21][1][0] - 1, spec[21][1][1] + 1, 'K');
}

/* 手臂：中立帧被斗篷盖住不画；摆动帧在斗篷侧面外露手 */
function drawArms(g, frame) {
  if (frame === 1) {
    /* 左臂前摆 */
    stamp(g, 12, 2, 'KG');
    stamp(g, 13, 2, 'KG');
    stamp(g, 14, 2, 'KG');
    stamp(g, 15, 2, 'KK');
  } else if (frame === 3) {
    /* 右臂前摆 */
    stamp(g, 12, 16, 'GK');
    stamp(g, 13, 16, 'GK');
    stamp(g, 14, 16, 'GK');
    stamp(g, 15, 16, 'KK');
  }
}

/* ===========================================================
   4. 组装
   =========================================================== */

function buildFrame(dir, frame) {
  const g = blank();

  if (dir === 'side') {
    drawHeadSide(g);
    drawScarf(g, 6);
  } else {
    drawHat(g);
    drawHead(g, dir);
    drawScarf(g, 5);
  }

  drawCloak(g);
  drawArms(g, frame);
  drawLegs(g, frame);

  return g.map((row) => row.join(''));
}

module.exports = { SKINS, W, H, DIRS, FRAMES, buildFrame };
