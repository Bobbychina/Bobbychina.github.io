/* 第二关「柠檬深渊」专属怪物的字符画（16×16 画布，脚下对齐最后两行）。
   ===========================================================
   为什么单独一个文件：第一关与第二关原来共用同一批人形怪（僵尸/骷髅/巨魔…
   都是同一套模板换色），走进去两关打起来长得一模一样。
   这里给第二关单独准备 3 只"酸适应"的怪，人形 + 蝠形 + 祭司三种剪影，
   靠 tools/vs-deco-sheet.mjs 渲染成对照图目视挑选，
   再由 games/vampire-survivors/tools/gen-sprites.js 编译进图集。

   设计口径（配合第二关刚压暗的地表 rgb(38,40,25)）：
     · 病态但不霓虹 —— 主体是脏黄绿 #7d9440 / #5e7430，受光 #a8bd5c；
       只有眼睛与酸滴用 #e2f07a，一帧里就那么几点。
     · 每只怪先立剪影再上明暗：
         acidhusk    鼓胀的烂尸，横宽、滴酸
         sporebat    蝠形，背上顶一个酸黄孢子囊
         toxicshaman 尖帽兜 + 发光眼 + 手里冒泡的酸瓶
     · 两帧靠腿/下摆错位做出"走"，不是整张图位移。

   调色板字符：
     K 轮廓 / D 罩袍暗 / F 腐肉中调 / f 腐肉暗部 / H 腐肉受光
     B 骨 / A 酸光 / a 酸光明 / E 眼（最亮，用得最少）
   =========================================================== */

/* ---------------- 调色板 ---------------- */

/* 蚀酸腐尸：脏黄绿的腐肉 + 蚀出的骨茬 + 滴落的酸 */
const PAL_ACID_HUSK = {
  K: '#141a0a',   // 轮廓
  f: '#5e7430',   // 腐肉暗部
  F: '#7d9440',   // 腐肉中调
  H: '#a8bd5c',   // 腐肉受光 / 鼓胀处的高光
  B: '#b8bd9a',   // 骨茬
  A: '#c2d84a',   // 酸光（溅出的酸）
  E: '#e2f07a'    // 最亮的酸滴（一帧只有一格）
};

/* 孢蝠：同族的翼膜 + 背上那颗酸黄孢子囊 */
const PAL_SPORE_BAT = {
  K: '#141a0a',
  H: '#a8bd5c',   // 翼尖受光
  F: '#7d9440',   // 翼膜中调
  f: '#5e7430',   // 翼膜暗部（翼根 / 腋下）
  A: '#c2d84a',   // 孢子囊
  E: '#e2f07a'    // 囊心 / 眼（最亮，一帧就那么几点）
};

/* 腐沼祭司：深色兜帽罩袍 + 黄眼 + 冒泡的酸瓶 + 肩上骨饰 */
const PAL_TOXIC_SHAMAN = {
  K: '#141a0a',   // 轮廓
  D: '#333f1a',   // 罩袍暗部
  F: '#7d9440',   // 罩袍中调
  f: '#5e7430',   // 罩袍褶皱
  H: '#a8bd5c',   // 受光的肩线
  B: '#b8bd9a',   // 骨饰
  A: '#c2d84a',   // 酸瓶
  E: '#e2f07a'    // 发光的眼睛
};

/* ---------------- 蚀酸腐尸 acidhusk ----------------
   横宽的鼓胀烂尸：大肚腩 + 外张的短臂 + 蚀出的骨茬，
   最下一行滴一格酸。两帧手脚错开。 */

const ACID_HUSK_0 = [
  '................',
  '.....KKKKKK.....',
  '....KfFFFFfK....',
  '....KFEFEFK.....',
  '....KFFFFFFK....',
  '.....KBBBBK.....',
  '...KKKKKKKKKK...',
  '..KFfFFFFFFfFK..',
  '.KFfFFFFFFFFfFK.',
  '.KFfFFHHHHFFfFK.',
  '.KFfFHAAAAHFFfK.',
  '.KFFfFHHHHFFfFK.',
  '..KFFfFFFFfFFK..',
  '...KKfFFFFfKK...',
  '....KKfKKfKK....',
  '....KKK..KKK....'
];

const ACID_HUSK_1 = [
  '................',
  '.....KKKKKK.....',
  '....KfFFFFfK....',
  '....KFEFEFK.....',
  '....KFFFFFFK....',
  '.....KBBBBK.....',
  '...KKKKKKKKKK...',
  '..KFfFFFFFFfFK..',
  '.KFfFFFFFFFFfFK.',
  '.KFfFFHHHHFFfFK.',
  '.KFfFHAAAAHFFfK.',
  '.KFFfFHHHHFFfFK.',
  '..KFFfFFFFfFFK..',
  '...KKfFFFFfKK...',
  '...KKfKKfKKK....',
  '...KKK..KK......'
];

/* ---------------- 孢蝠 sporebat ----------------
   蝠形剪影：头在**最上面**（尖耳 + 亮眼），翅膀往下斜张，
   躯干正中驮一颗亮黄的孢子囊 —— 和第一关那只紫血蝠（紫身红眼）一眼分开。
   前两版都栽在剪影上：V 字朝下的那版像片叶子、横摊的那版像只虫；
   这一版照第一关血蝠的读法来（头在上、翼在下、躯干居中），
   只是把"荧光红眼 + 紫身"换成"酸黄孢子囊 + 病绿翼膜"。
   两帧靠腿与翼尖错开。 */

const SPORE_BAT_0 = [
  '................',
  '................',
  '..K..........K..',
  '.KHK........KHK.',
  '.KFFK......KFFK.',
  '..KffKKKKKKffK..',
  '...KFFEEEEFFK...',
  '....KFFFFFFK....',
  '....KFAAAAFK....',
  '....KFAEEAFK....',
  '....KFAAAAFK....',
  '.....KFFFFK.....',
  '......KFFK......',
  '.......KK.......',
  '.....KK..KK.....',
  '.....KK..KK.....'
];

const SPORE_BAT_1 = [
  '................',
  '................',
  '..K..........K..',
  '.KHK........KHK.',
  '.KFFK......KFFK.',
  '..KffKKKKKKffK..',
  '...KFFEEEEFFK...',
  '....KFFFFFFK....',
  '....KFAAAAFK....',
  '....KFAEEAFK....',
  '....KFAAAAFK....',
  '....KFFFFFFK....',
  '.....KFFFFK.....',
  '......KFFK......',
  '....KK....KK....',
  '....KK....KK....'
];

/* ---------------- 腐沼祭司 toxicshaman ----------------
   尖帽兜罩袍，兜里两点亮黄眼；左手边提着一只冒泡的酸瓶
   （酸瓶故意顶出袍子的轮廓，剪影上就认得出"拿着东西"）。
   两帧靠下摆与酸瓶位置错开。 */

const TOXIC_SHAMAN_0 = [
  '................',
  '.......KK.......',
  '......KDDK......',
  '.....KDDFDK.....',
  '....KDDEEDDK....',
  '....KDFFFFDK....',
  '...KDFFFFFFDK...',
  '...KDHHHHHHHK...',
  '..KDFFBFFBFFFK..',
  '..KDFFFBBBFFFDK.',
  '..KDFFAAEAFDDK..',
  '..KDFFAAEAFDDK..',
  '..KDFFFAAFFFDK..',
  '.KDfFFFFFFFFfDK.',
  '.KDDfFFFFFFfDDK.',
  '.KKKKKKKKKKKKKK.'
];

const TOXIC_SHAMAN_1 = [
  '................',
  '.......KK.......',
  '......KDDK......',
  '.....KDDFDK.....',
  '....KDDEEDDK....',
  '....KDFFFFDK....',
  '...KDFFFFFFDK...',
  '...KDHHHHHHHK...',
  '..KDFFBFFBFFFK..',
  '..KDFFFBBBFFFDK.',
  '..KDFFAAFFFDK...',
  '..KDFAAEAFDDK...',
  '..KDFAAEAFDDK...',
  '.KDfFFFFFFFFfDK.',
  '.KDfFFFFFFFFfDK.',
  '.KKKKKKKKKKKKKK.'
];

/* ---------------- 导出 ----------------
   每个怪一条目 { rows, frames, pal }：
     rows   第一帧（对照图工具 / 只读 rows 的地方用）
     frames 全部帧（生成器按它出 <组名>_0 / <组名>_1 与 <组名> 动画组）
     pal    调色板（必须覆盖 frames 里出现的每个字符）
   分组名就是图集里的组名；渲染层是拿怪物的 type 直接查 SpriteGroups 的，
   所以组名必须和 config.js 里 C.ENEMY_TYPES 的 id 逐字一致。

   FRAMES 视图：把每一帧摊平成 `<id>_<帧号>` 单独一条。
   只给 tools/vs-deco-sheet.mjs 这类**只认 { rows, pal }** 的对照图工具用
   （gen-sprites.js 不读它，别把它当成第二份数据源）。 */

const L2 = {
  acidhusk: { rows: ACID_HUSK_0, frames: [ACID_HUSK_0, ACID_HUSK_1], pal: PAL_ACID_HUSK },
  sporebat: { rows: SPORE_BAT_0, frames: [SPORE_BAT_0, SPORE_BAT_1], pal: PAL_SPORE_BAT },
  toxicshaman: { rows: TOXIC_SHAMAN_0, frames: [TOXIC_SHAMAN_0, TOXIC_SHAMAN_1], pal: PAL_TOXIC_SHAMAN }
};

const L2_FRAMES = {};
Object.keys(L2).forEach(function (id) {
  const d = L2[id];
  const frames = d.frames || [d.rows];
  frames.forEach(function (rows, i) {
    L2_FRAMES[id + '_' + i] = { rows: rows, pal: d.pal };
  });
});

module.exports = {
  level2: L2,
  /* 摊平的逐帧视图（只给对照图工具用） */
  FRAMES: { level2: L2_FRAMES }
};
