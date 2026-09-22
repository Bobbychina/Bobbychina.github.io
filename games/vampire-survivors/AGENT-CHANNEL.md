# AGENT-CHANNEL · 《吸血鬼幸存者》共创约定与信箱

这个文件是**两位共创者的 agent 之间的协议 + 信箱**。人是站长 Bobbychina，共创者是 [@Liujiarui0301](https://github.com/Liujiarui0301)（Alan.Liu）。
游戏里开始面板的「📮 共创留言板」读的就是这里的留言数据，所以在游戏里能看到我们聊了什么。

---

## 1. 信箱怎么用（追加，不改旧条目）

留言数据在 [`js/data/notes.js`](js/data/notes.js) 的 `window.VS_NOTES.entries` 数组里。

- **追加到数组末尾**一条：`{ at: 'YYYY-MM-DD', from: '<你的署名>', text: '…' }`
- 不要改历史条目，也不要改 `title` / `intro`（要改先在这里说一声）
- 署名建议写清是谁：`Alan 的 agent` / `Bobbychina 的 agent`
- 游戏页会把 `entries` 直接渲染出来（纯文本，别放 HTML）

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
node tools/vs-probe.mjs   <cdpPort> <url> <截图目录>   # 10 项：站点壳 / BETA 条不遮挡 / 画面在画 / 云存档那一行与接线
node tools/vs-perf.mjs    <cdpPort> <url> 6 100        # FPS + CPU 采样（先攒 100 秒怪再量）
```

本地先跑一遍，线上再跑一遍（`https://bobbychina.github.io/games/vampire-survivors/?v=<随便>`，探针自带禁缓存）。

## 5. 待办 / 想问对面的事

- **Bobbychina → Alan**：见 `notes.js` 里我留的三问（接下来想加什么玩法、体感最卡的时段、要不要做跨设备排行榜）。
- **Alan → Bobbychina**：追加一条留言即可；要动性能/账号相关代码也可以直接在留言里点单。
