# AGENT-CHANNEL · 《吸血鬼幸存者》共创约定与信箱

这个文件是**两位共创者的 agent 之间的协议 + 信箱**。人是站长 Bobbychina，共创者是 [@Liujiarui0301](https://github.com/Liujiarui0301)（Alan.Liu）。
游戏里开始面板的「📮 共创留言板」读的就是这里的留言数据，所以在游戏里能看到我们聊了什么。

---

## 1. 信箱怎么用（追加，不改旧条目）

留言数据在 [`js/data/notes.js`](js/data/notes.js) 的 `window.VS_NOTES.entries` 数组里。

> ⚠️ **2026-09-22 协议更新（吃过一次亏）**：原先两人都往 `js/data/notes.js` 的同一个数组末尾追加，
> git 自动合并后**少了一个逗号**，线上留言板整个没渲染。现在改成分文件：
> - 我写 [`js/data/notes/bobbychina.js`](js/data/notes/bobbychina.js)
> - 你写 [`js/data/notes/alan.js`](js/data/notes/alan.js)
> - [`js/data/notes.js`](js/data/notes.js) 只是聚合器（两边都别动它）
>
> 各写各的文件 = 两个 agent 的提交永远不在同一段文本上打架。

- **追加到你自己那个文件的 `entries` 末尾**一条：`{ at: 'YYYY-MM-DD', text: '…' }`（`from` 由文件头统一带上）
- 不要改历史条目，也不要动聚合器 `notes.js`
- 游戏页会把两边合成后的列表直接渲染出来（纯文本，别放 HTML）
- 改完自检一下语法：`node --check js/data/notes/alan.js`（就吃过这个亏）

## 2. 谁负责哪一块（避免两个人改同一处）

| 范围 | 归属 | 说明 |
|---|---|---|
| 玩法、数值、武器/怪物/掉落、动画帧 | Alan | 你的主场，随你改 |
| 性能、账号与云存档、站点壳、CSP、构建与探针 | Bobbychina | 我这边维护，改之前说一声 |

## 3. 别动这几处（改了就出事）

1. **脚本要用 `defer`**：线上每个请求 0.6~1.0s，串行下载 20 个文件要 15s；`defer` 并行且保持执行顺序。加新 js 文件时照抄现有写法。
2. **性能红线：每帧别做全屏填充 / 每帧新建渐变**。瓶颈是「每帧光栅化多少像素」，不是 JS 逻辑：
   - 暗角、低血红屏、金球光晕都要**预渲染成小图**再贴（现状就是这么做的）
   - 渲染缩放按像素预算压到整数档（`renderer.js` 的 `pickRenderScale`）
   - `resize()` 不要每帧读 `clientWidth`（会强制全页重排），改尺寸走 `needResize` 脏标记
   - 判断标准：`node tools/vs-perf.mjs <cdpPort> <url> [秒] [攒怪秒数]`，1440×900@2x 要稳 60fps
3. **站点壳与版本条**：画布上下要给 `--beta-h` 让位（`#app` 的 `top: var(--beta-h)`），别把 BETA 条盖回去。
4. **CSP 保持收紧**：`connect-src` 只放行 `api.github.com` 与账号中继（云存档要用的），加外链前先问。
5. **云存档契约**：`game=vampire-survivors` / `slot=main`，走 `/games/account.js`（`DSHAccount.savePut/cloudPush/cloudPull/syncNow`）；存档对象就是 `VS.Save` 那份 `{bestTime,bestKills,bestLevel,runs,totalKills,muted}`，加字段没问题，改名要先说。

## 4. 改动怎么验（两条命令，别跳）

```bash
node tools/vs-probe.mjs       <cdpPort> <url> <截图目录>   # 16 项：站点壳 / BETA 条不遮挡 / 画面在画 / 云存档那一行与接线 / 全站榜
node tools/vs-boss-probe.mjs  <cdpPort> <url> <截图目录>   # 11 项：Boss 四档七招 / 护盾与虚弱期 / 狂暴 / 闪避 / 520 怪帧率 / TTK
node tools/vs-perf.mjs        <cdpPort> <url> 6 100        # FPS + CPU 采样（先攒 100 秒怪再量）
```

一条命令跑全套：`powershell -File tools\reg-site.ps1`（共创游戏页 + 游戏厅 + 帧率体检，结果落盘）。

> **量 TTK / 调数值前先看这条**（2026-09-23 踩过）：`tools/vs-boss-probe.mjs` 里的机器人玩家是「重心逃逸」，
> 不打缠斗约束的话它会一路逃到弹幕外，同一套构筑两局能跑出 117 vs 203 DPS —— 量出来的是它逃跑多久，
> 不是构筑 DPS。探针里现在加了「离 Boss 超 240px 就拉回来」的缠斗约束，数字才稳（实测 196~203 DPS）。
> 你自己写测量脚本时照抄这条，否则调的是一组噪声。

本地先跑一遍，线上再跑一遍（`https://bobbychina.github.io/games/vampire-survivors/?v=<随便>`，探针自带禁缓存）。

## 5. 待办 / 想问对面的事

- **当前版本（2026-09-23）**：Boss 二版已上线 —— 血量基础 **5400**（5:00 实到 ≈13230）、四档七招（新增激光横扫 / 落石）、
  **护盾阶段**（破 62% / 30% 时无敌 + 召唤 8~10 只小弟，清光才破盾，破盾后 2.5s 受伤 ×1.35）、18% 以下狂暴；
  玩家侧新增 <kbd>Shift</kbd> 闪避（0.3s 无敌帧）；腐化光环 / 环绕骨刃 / 血爆新星三件轮椅已削（详见 `config.js` 注释）。
  TTK 实测：中期构筑对 Boss ≈148~203 DPS → **65~89 秒**（本地实测 68.1 秒）。
- **收信工具**：`node tools/agent-inbox.mjs [--fetch]` —— 一行命令看清「对面最近提交了什么、两边留言板各几条、我是不是欠回信」（只读，不改文件）。动这个游戏之前先跑一次，别让人家等太久。
- **Bobbychina → Alan**：见 `notes/bobbychina.js` 里我留的三问（接下来想加什么玩法、体感最卡的时段、要不要做跨设备排行榜）—— 前两条已有答复；第三条（全局榜）已交付上线。2026-09-23 又追加了三条待答：招式手感是否要调、要不要按 `bossCount` 往池子里加招、武器进化的存档字段名。
- **Alan → Bobbychina**：追加一条留言即可；要动性能/账号相关代码也可以直接在留言里点单。
