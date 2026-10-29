# 墨狂网页版联机 · 2.1.0

入口：`https://bobbycn.cc/games/alan/` 大厅的 **线上论剑**，或者直接访问 `https://bobbycn.cc/games/alan/online/`。

## 玩家流程

房主直接在网页创建房间，复制邀请链接给朋友。朋友打开链接后点击加入；也可在同一页面手动填写 10 位房间码。双方准备后倒计时三秒开战。支持认输、双方再战、退出与重连。

玩家不需要下载客户端、安装 Node、填写内网地址或开放本机 HTTP 端口。房主的浏览器是战斗计算方，房主应保持页面在前台；切换标签隐藏页面时会暂停战斗，返回后继续。房间断线保留座位 20 秒，并自动尝试恢复。

## 静态网站上的实现

- `games/alan/index.html` 基于本次发布前线上游戏页面，删除下载时 Cloudflare 注入的重复统计标签，通过 `online-entry.js` 接入联机。
- `online/engine.js` 将线上已有的 `game.js` 与 `chapters.js` 封装成 Worker 可运行的引擎；内部只允许已经内置的章节依赖。
- `online/combat.js` 复用原版 Duel、输入清洗与快照转换，不包含 Node HTTP、文件系统和 WebSocket 服务端。
- `online/worker.js` 与 `room.js` 在房主 Worker 中推进 60Hz 双人战斗，广播 30Hz 快照，管理准备、暂停、结算和再战。
- `online/local-authority.js` 提供仅作用于本模块的 Socket 接口，将房主和远端玩家的操作送入 Worker；不改写浏览器全局 WebSocket。
- `online/transport.js` 使用固定随附的 PeerJS 1.5.5，通过公共信令建立真实 WebRTC DataChannel，传输输入与快照。
- `online/client.js` 处理页面状态、邀请、键鼠/触屏输入和原版水墨画面。

前端不连接 localhost、`/room` 或 `/ink-duel` 游戏服务，因而能随现有静态站发布。旧 `lan.html` 入口会转到新版在线页面。

客户端只提交按键操作，战斗数据由房主计算。这适合朋友切磋；房主浏览器不是独立于玩家的可信服务器，不应据此宣称能防作弊。

## 网络边界

默认公共信令为 `https://0.peerjs.com`。信令负责配对，数据走 WebRTC。页面支持替换为兼容 PeerServer 的信令地址，以及填写自有 TURN 服务。

部分校园网、对称 NAT 或限制 UDP 的网络需要 TURN 中继；该版本不捆绑 TURN 账号，不能保证所有网络均可直连。TURN 密码仅留在页面内存，不随邀请分享、不写入游戏存档或浏览器存储。

## 验证

```sh
node --test tools/alan-online.test.cjs
node tools/i18n-check.mjs
```

本地预览为纯静态 HTTP，不运行任何游戏后台。已验证原游戏大厅入口、两名独立浏览器玩家、邀请链接、真实 WebRTC、Worker 战斗、移动与扣血、断线暂停恢复、结算、再战，并断言不存在指向本机游戏服务的 WebSocket。正式域名的发布结果应另行实际检查。

测试未覆盖两条独立外网之间的 NAT 穿透和真实 TURN 账号。公共信令状态与玩家网络条件可能影响连接。

## 发布与回退

本次使用站点现有 main 自动部署流程。只添加墨狂相关静态文件和测试，不修改部署配置。原本仅保留在线上的游戏内容从本次开始进入站点仓库。

工作流不删除服务器旧文件。回退联机入口时应恢复 `games/alan/index.html` 与 `lan.html` 的旧内容并重新部署；不能假设删除仓库文件会删除服务器文件。本次变更前的线上页面已在实施环境保留副本。

PeerJS MIT 许可随附于 `games/alan/online/vendor/peerjs.LICENSE`。
