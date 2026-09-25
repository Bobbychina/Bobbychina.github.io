/* 两个生物群落的点缀字符画（20×20 画布，脚下对齐第 19 行）。
   第一关「血色荒野」= 焦土 / 铁丝网 / 锈铁残骸 / 骸骨
   第二关「柠檬深渊」= 酸池 / 柠檬树 / 孢子囊 / 酸晶

   这是美术源，由 tools/vs-deco-sheet.mjs 渲染成对照图目视检查，
   再由 games/vampire-survivors/tools/gen-sprites.js 编译进图集。
   改图形只改这里。

   上一版被打回的一批（锈铁像木头、铁丝网太抽象、柠檬树像长矛、
   酸池没读成"池"、孢子囊是暗块、柠檬堆和酸晶分不清）在这一版里
   都按"先立剪影、再上明暗"重画：每件东西先保证轮廓能认出来。
   =========================================================== */

/* ---------------- 第一关 · 血色荒野 ---------------- */

const PAL_WASTE = {
  '.': null,
  K: '#140c0e',   // 轮廓（焦土黑）
  G: '#4a3a30',   // 石中调
  w: '#3a2a2a',   // 焦木暗部
  W: '#5c4038',   // 焦木亮部
  r: '#4a231c',   // 锈铁暗部
  R: '#8a4a32',   // 锈铁亮部
  A: '#c47a42',   // 锈铁高光 / 铆钉
  B: '#8e8570',   // 骨暗
  b: '#b3a98e',   // 骨中
  c: '#d2c9ac',   // 骨受光
  g: '#33261f',   // 干土
  d: '#241a18',   // 灰烬 / 炭
  y: '#c98a3c'    // 余烬
};

/* 枯树：主干 + 两处分叉，光秃无叶 */
const DECO_DEADTREE = [
  '....................',
  '.........KwK........',
  '........KwWWK.......',
  '...KwK..KwWK........',
  '..KwWWK.KwWK........',
  '..KwWWK.KwWK........',
  '...KwWKKwWWK........',
  '....KwWWWWWK........',
  '.....KwWWWK.........',
  '.....KwWWWK.........',
  '....KwWWWWK.........',
  '....KwWWWWK.........',
  '...KwWWWWWK.........',
  '...KwWWWWWK.........',
  '..KwWWWWWWK.........',
  '..KwWK.KwWK.........',
  '..KwK...KwK.........',
  '.KwWK...KwWK........',
  'KggggKKKggggK.......',
  'KgggggggggggK.......'
];

/* 铁丝网：两根木桩 + 三道带倒刺的铁丝（倒刺画成上下小尖） */
const DECO_WIRE = [
  '....................',
  '....................',
  '....KwK......KwK....',
  '....KwWK.....KwWK...',
  '....KwWK.....KwWK...',
  '....KwWK.....KwWK...',
  '....KwWK.....KwWK...',
  '.K.KwWK.K.K..KwWK.K.',
  '.KKKwWKKKKKKKKwWKKK.',
  'KrRrwWrRrRrRrwWrRrRK',
  '.KKKwWKKKKKKKKwWKKK.',
  '.K.KwWK.K.K..KwWK.K.',
  '....KwWK.....KwWK...',
  '....KwWK.....KwWK...',
  '.K.KwWK.K.K..KwWK.K.',
  '.KKKwWKKKKKKKKwWKKK.',
  'KrRrwWrRrRrRrwWrRrRK',
  '.KKKwWKKKKKKKKwWKKK.',
  '....KwWK.....KwWK...',
  '...KggggK...KggggK..'
];

/* 锈蚀残骸：一块斜插在地上的破铁板（带铆钉与断口），不是木头 */
const DECO_RUST = [
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '..........KKKKKKKK..',
  '.........KrRRRRRRK..',
  '........KrRARRARRK..',
  '.......KrRRRRRRRRK..',
  '......KrRARRARRRK...',
  '.....KrRRRRRRRRK....',
  '....KrRARRARRRK.....',
  '...KrRRRRRRRRK......',
  '..KrRARRARRRK.......',
  '..KrRRRRRRRK........',
  '..KrrrrrrrK.........',
  '..KKKKKKKK..........',
  '....KrRK............',
  '....KrRK............',
  '...KgggggK..........'
];

/* 骸骨堆：一具头骨 + 交叉长骨 */
const DECO_BONEPILE = [
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '.........KcK........',
  '........KcbcK.......',
  '.......KcbbbK.......',
  '.......KbKBbK.......',
  '.......KbKbbK.......',
  '.......KBbbBK.......',
  '........KbbK........',
  '.........KK.........',
  '..KbK...........KbK.',
  '.KbcbK.........KbcbK',
  '.KbBbKKKKKKKKKKKbBbK',
  '..KbBbBbBbBbBbBbBbK.',
  '...KKKKKKKKKKKKKK...',
  '...KggggggggggggK...',
  '..KggggggggggggggK..'
];

/* 余烬堆：熄灭的篝火，中心还有余温 */
const DECO_EMBER = [
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '.........KyK........',
  '........KyAyK.......',
  '.......KdAAAdK......',
  '......KdAArAAdK.....',
  '.....KdWrRrRrWdK....',
  '....KdWrRrRrRrWdK...',
  '....KdWrRrRrRrWdK...',
  '.....KddddddddK.....',
  '...KgggggggggggK....',
  '..KgggggggggggggK...',
  '..KgggggggggggggK...',
  '..KKKKKKKKKKKKKKK...'
];

/* 碎石堆：三块有明暗面的断石 */
const DECO_WASTE_ROCK = [
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '.........KGK........',
  '........KGGWK.......',
  '.......KGGWWK.......',
  '......KGGWWWK.......',
  '.....KGGWWWKK.......',
  '..KGK.KGWWK.KGK.....',
  '.KGGWK.KKK.KGGWK....',
  '.KGWWK.....KGWWK....',
  '.KGGWK.....KGGWK....',
  '..KKK.......KKK.....',
  '...KggggggggggK.....',
  '..KggggggggggggK....',
  '..KggggggggggggK....'
];

/* ---------------- 第二关 · 柠檬深渊 ---------------- */

const PAL_ABYSS = {
  '.': null,
  K: '#111607',   // 轮廓（酸沼黑）
  G: '#3f5c10',   // 沼绿暗
  g: '#5f8518',   // 沼绿中
  L: '#8fb52a',   // 沼绿亮
  a: '#96c020',   // 苔暗
  A: '#c2e03c',   // 苔亮
  l: '#e8f47a',   // 荧光黄
  y: '#d8e84a',   // 柠檬
  Y: '#f5f7a8',   // 柠檬高光
  B: '#9aa47e',   // 蚀骨暗
  b: '#c2cba6',   // 蚀骨中
  c: '#e0e6c8',   // 蚀骨受光
  P: '#2b3a08',   // 孢子暗
  p: '#7ba524',   // 孢子亮
  w: '#b9c46a'    // 苍白酸黄（2026-09-25 加：孢子囊囊体 / 柠檬树冠 / 草尖，
                  //   目的是把这一关的"一片绿"打散成黄绿相间）
};

/* 柠檬树：树冠占大头、挂三颗柠檬，树干细 —— 上次像长矛是树冠太小 */
const DECO_LEMONTREE = [
  '....................',
  '.......KGGwGGK......',
  '.....KGGwwwwGGK.....',
  '....KGGwwLLwwGGK....',
  '...KGGwwLLwwLLGGK...',
  '...KGGwwLLwwLLGGK...',
  '..KGGwwLLLLLLwwGGK..',
  '..KGGwwLLLLLLwwGGK..',
  '..KGGwwLLLLLLwwGGK..',
  '..KGGGwwLLLLwwGGGK..',
  '...KGGGwwwwwwGGGK...',
  '....KGGGwwwwGGGK....',
  '.....KGGGGGGGGK.....',
  '.......KGgGK........',
  '.......KGgGK........',
  '......KGgGK.........',
  '......KGgGK.........',
  '.....KGGgGGK........',
  '....KGGGGGGGK.......',
  '...KgggggggggK......'
];

/* 酸池：扁椭圆的水洼 + 中间冒泡 + 岸边一圈亮黄 */
const DECO_ACIDPOOL = [
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '......KllllllK......',
  '....KllyyyyyyllK....',
  '...KlyyyAAAyyyylK...',
  '..KlyyAAAAAAAyyylK..',
  '..KlyAAAAAAAAAaylK..',
  '..KlyyAAAAAAAayylK..',
  '..KllyyyAAAayyyllK..',
  '...KlllyyyyyylllK...',
  '....KKlllllllKK.....',
  '...KGGGGGGGGGGGGK...',
  '..KGGGGGGGGGGGGGGK..',
  '..KGGGGGGGGGGGGGGK..'
];

/* 孢子囊：鼓起的圆囊，顶端裂口喷孢子。
   2026-09-25：站长反馈"绿色装饰太多"，囊体从绿改**苍白的酸白色**（用 w 槽），
   只留底座的沼绿 —— 这样它在一片绿里是"亮点"而不是又一块绿。 */
const DECO_SPOREPOD = [
  '....................',
  '....................',
  '....................',
  '....................',
  '.......ww..ww.......',
  '......w.w..w.w......',
  '.......KwwwwK.......',
  '......KwKwwKwK......',
  '.....KwKwwwwKwK.....',
  '....KwKwwllwwKwK....',
  '....KwKwwllwwKwK....',
  '...KwKwwwwwwwwKwK...',
  '...KwKwwwwwwwwKwK...',
  '...KwKwwwwwwwwKwK...',
  '...KwKwwwwwwwwKwK...',
  '...KwKwwwwwwwwKwK...',
  '...KwKwwwwwwwwKwK...',
  '...KwKwwwwwwwwKwK...',
  '...KGGGGGGGGGGGGK...',
  '..KggggggggggggggK..'
];

/* 酸晶：细长的结晶簇（三根高低不同），和柠檬树桩区分开 */
const DECO_ACIDCRYSTAL = [
  '....................',
  '....................',
  '....................',
  '...........KlK......',
  '...........KlK......',
  '......KlK..KlK......',
  '......KlK.KlYK......',
  '......KlK.KlYK......',
  '.....KlyK.KlyK......',
  '.....KlyK.KlyK......',
  '....KlyyKKlyyK......',
  '....KlyyKKlyyK......',
  '...KlyyyKKlyyyK.....',
  '...KlyyyKKlyyyK.....',
  '..KlyyyyKKlyyyyK....',
  '..KlyyyyKKlyyyyK....',
  '..KyyyyyKKyyyyyK....',
  '..KKKKKKKKKKKKKK....',
  '..KGGGGGGGGGGGGK....',
  '..KggggggggggggK....'
];

/* 酸沼草：两丛宽叶，叶尖荧光 */
const DECO_ABYSSGRASS = [
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....KwK...KwK.......',
  '...KwAK...KwAK......',
  '...KwAK...KwAK......',
  '..KwAAK..KwAAK......',
  '..KwAAK..KwAAK......',
  '..KAAAK..KAAAK......',
  '..KGGGGKKKGGGGK.....',
  '..KGGGGKKKGGGGK.....',
  '...KGGGKKKGGGK......',
  '...KgggKKKgggK......',
  '..KggggggggggggK....',
  '..KggggggggggggK....'
];

/* 蚀骨：被酸蚀出孔洞的残骸，颜色偏青白 */
const DECO_ACIDBONE = [
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '.........KcK........',
  '........KcbcK.......',
  '.......KcbbbK.......',
  '.......KbKBbK.......',
  '.......KbKbbK.......',
  '.......KBbbBK.......',
  '........KbbK........',
  '.........KK.........',
  '..KbK...........KbK.',
  '.KbcbK.........KbcbK',
  '.KbBbKKKKKKKKKKKbBbK',
  '..KbBbBbBbBbBbBbBbK.',
  '...KKKKKKKKKKKKKK...',
  '...KGGGGGGGGGGGGK...',
  '..KGGGGGGGGGGGGGGK..'
];

/* 柠檬果堆：三颗落果堆在一起，带高光 —— 和酸晶（细长簇）明显不同 */
const DECO_LEMONPILE = [
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '.........KyK........',
  '........KyYyK.......',
  '........KyyyK.......',
  '.....KyKKyyyKK......',
  '....KyYyKyyyyK......',
  '...KyyyyKKyyyK......',
  '...KyyyK.KyyK.......',
  '...KKKK..KyyK.......',
  '.........KKKK.......',
  '..KGGGGGGGGGGGGK....',
  '..KggggggggggggK....'
];

/* ---------------- 导出（CommonJS：生成器用 require 读它） ---------------- */

const wrap = (rows, pal) => ({ rows, pal });

module.exports = {
  deco_l1: {
    waste_rock: wrap(DECO_WASTE_ROCK, PAL_WASTE),
    waste_bone: wrap(DECO_BONEPILE, PAL_WASTE),
    waste_stump: wrap(DECO_EMBER, PAL_WASTE)
  },
  deco_l1_big: {
    deadtree: wrap(DECO_DEADTREE, PAL_WASTE),
    wire: wrap(DECO_WIRE, PAL_WASTE),
    rust: wrap(DECO_RUST, PAL_WASTE)
  },
  deco_l2: {
    acidpool: wrap(DECO_ACIDPOOL, PAL_ABYSS),
    abyssgrass: wrap(DECO_ABYSSGRASS, PAL_ABYSS),
    abyss_bone: wrap(DECO_ACIDBONE, PAL_ABYSS)
  },
  deco_l2_big: {
    lemontree: wrap(DECO_LEMONTREE, PAL_ABYSS),
    sporepod: wrap(DECO_SPOREPOD, PAL_ABYSS),
    acidcrystal: wrap(DECO_ACIDCRYSTAL, PAL_ABYSS),
    lemonpile: wrap(DECO_LEMONPILE, PAL_ABYSS)
  }
};
