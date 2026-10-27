# bobbychina.github.io

我的个人主页 + 网页游戏厅，纯静态站点，托管在 GitHub Pages。

> **2026-09-28 起主站迁到自建服务器：<https://bobbycn.cc>**（东京 · 宿主 nginx + NestJS 容器，前置 Cloudflare 橙云，源站只允许 CF 回源）。
> 本仓库继续存在，角色是 **静态镜像 / 降级阅读端**：静态内容同源，云能力（云账号、云存档、全站榜、OAuth）走主站的 `/api` 中继 ——
> 见 `games/auth-config.js` 里的 `relay`。仓库中的 `functions/` 只对 Cloudflare Pages 的那份部署生效，**对 GitHub Pages 不起作用**，
> 其逻辑（`/api` 全路径中继、OAuth 两条端点、Origin 白名单）已在主站 nginx 复刻。

- 主页：<https://bobbychina.github.io/>
- 游戏厅：<https://bobbychina.github.io/games/>
- 在线玩：<https://bobbychina.github.io/games/zombie-survival/>

## 结构

| 路径 | 说明 |
|---|---|
| `index.html` | 主页（项目 / 游戏厅 / 关于），单文件、零依赖 |
| `games/index.html` | 游戏厅入口，含账号面板说明 |
| `i18n/i18n.js` | 多语言引擎：按语言同步载入词典、替换 `data-i18n`、生成语言切换器 |
| `i18n/zh-CN.js`、`i18n/zh-TW.js`、`i18n/en.js` | 简中、繁中、英文词典 |
| `tools/i18n-check.mjs` | i18n 自检：词典键 ↔ 页面实际用键是否对齐 |
| `games/zombie-survival/index.html` | 游戏本体，**由游戏仓库构建后同步过来**（`zombie-survival/tools/sync-site.mjs`），别手改 |
| `games/account.js` | 账号/云存档客户端，同样是从游戏仓库同步来的 |
| `games/auth-config.js` | 云后端地址与 GitHub OAuth client_id |
| `games/oauth-callback.html` | OAuth 回调页 |
| `beta-notice.js` | 全站 BETA 声明条 + 手机端未适配提醒 + 第一方匿名访问计数 |
| `chat/index.html` | 站内私线（2026-10-27）：站主与受邀账号（`role=subadmin`）的两人对话页 |
| `assets/chat.css`、`assets/chat.js` | 私线的样式与交互：发文本/文件/链接、内置 emoji、SSE 实时、手机自适应 |
| `tools/site-probe.mjs` | 站点自检：公开文案、外链、横向滚动、移动视口 |
| `tools/site-beta-probe.mjs` | BETA 条与手机提醒的 DOM 自检（含截图） |

## 多语言（i18n）

网站页面、管理后台、账号与存档面板支持 `简体 / 繁體 / EN`。可用 `?lang=en` 或 `?lang=zh-TW` 直达，
选择记在 localStorage；首次访问按浏览器语言判断，`zh-HK`、`zh-Hant` 等归入繁中。文章正文、标题、摘要、标签和用户输入保留原文。
系统邮件与 OAuth 同意页也支持三种语言。游戏内部玩法、剧情、道具和交易界面不属于此次翻译范围。

页面里怎么标注：

```html
<h1 data-i18n="home.h1">默认文案</h1>                    <!-- textContent -->
<p  data-i18n-html="home.about.p1">默认文案</p>          <!-- 允许词条里带 <b>/<a> -->
<meta name="description" data-i18n-attr="content:meta.desc">
<span data-i18n-switch></span>                           <!-- 语言切换器落点 -->
```

运行时拼的 HTML（账号面板、彩蛋面板等）用 `I18N.t('games.login.title')` 取词；语言切换后需要重画的动态内容用
`I18N.onChange(render)` 订阅。查不到的键会原样显示并在控制台警告一次，方便发现漏词条。

**加一种语言（两步）：**

1. 复制 `i18n/en.js` 为 `i18n/<code>.js`，改 `I18N.define('<code>', {…})` 的值；
2. 在 `i18n/i18n.js` 顶部的 `LANGS` 数组里加一行 `{ code:'<code>', label:'显示名', tag:'<html lang 值>' }`。

然后 `node tools/i18n-check.mjs` 自检（缺词条、三种语言的键或插值参数不一致、繁中 emoji 损坏时退出码为 1）。

动态标签可用 `I18N.bind(element, 'textContent', () => I18N.t(key))`；日期和数字分别用 `I18N.date` 与 `I18N.number`。
`I18N.onChange(render)` 返回取消订阅函数。账号弹窗切换语言会保留输入，不要求重新登录。
验收范围、源文件与命令见 [国际化说明](docs/i18n.md)。

## 站内私线（`/chat/`，2026-10-27）

只对两类人开放：**站主本人**与**受邀账号**（身份表 `role=subadmin`，当前只有 `tina`）。页面地址不保密，
门在服务端：`/api/chat/access` 与每个读写端点都会裁决，其它账号看到的是「这条线不通」。

- 能力：发文本、发文件（≤20MB，图片内联预览、其它给下载卡）、发链接（带说明）、内置 emoji（常用/表情/手势/物件）；
  已读回执、对方在线状态、时间分隔、历史分页。
- 实时：上行全 REST，下行 SSE（`/api/chat/stream`，零第三方脚本）；SSE 断了自动退回 5 秒轮询。
- 入口：登录后若你是站主或受邀账号，顶栏会多一个「对话」；账号页也会出现「私线」卡片。
- 后端与部署：见 `stockGameOnlinePro/docs/PRIVATE-LINE-20261027.md`。
- 文案三语齐全，改完跑 `node tools/i18n-check.mjs`。

## 反馈

有 bug、想提建议、或者哪个页面在手机上炸了：**<https://github.com/Bobbychina/Bobbychina.github.io/issues>**

游戏本身的玩法/存档问题提到游戏仓库：**<https://github.com/Bobbychina/zombie-survival/issues>**

## 当前状态

整站是 **BETA**（页面顶部那条横条就是它）：还在开发中，不代表最终品质。
已知情况：

- **手机端做了基础适配**（按钮 ≥44px、字号下限、无横向滚动），但游戏仍以键鼠为设计目标，地图操作和快捷键在手机上不如电脑顺手；手机上会弹一条提醒。
- 访问计数是自己 Worker 上的匿名计数（无 Cookie、不存 IP）；除此之外页面不加载任何第三方脚本。
- 当前站点账号与云存档入口按 `games/auth-config.js` 的 `site` 配置连接主站 API。仓库保留部分历史 Worker 路线；不要把旧额度提示当成现有后端架构或套餐承诺。

## 许可

[PolyForm Noncommercial License 1.0.0](LICENSE)：源码可以随便读、改、分享、拿去玩或做视频/教学，**但不能用于任何商业用途**。

## 本地预览

账号、云存档和在线游戏注入的维护边界、本次 bug 修复与验证命令见 [架构说明](docs/architecture.md)。

从本仓库根目录启动静态预览（不要用 `file://` 测试账号流程）：

```powershell
python -m http.server 5180 --bind 127.0.0.1
```

打开 `http://127.0.0.1:5180/`，先检查主页、游戏厅与语言切换。静态服务器不会实现 `/api`；本地登录和云存档需要按 `games/auth-config.js` 的开发说明连接真实后端。页面能打开不等于认证链路已通过。

2026-10-22 已静态核对当前配置与词典脚本，未重新登录、部署或测试生产 API。练习新增一个词条时，同步三份词典，运行 `node tools/i18n-check.mjs`，然后切换三种语言确认动态内容也更新。新增语言还需检查后端邮件及同意页支持，不能只修改前端 `LANGS` 就声称全站支持。

## macOS 访问（2026-10-10）

已取消客户端与 Cloudflare Pages 的平台拦截。主站已在用户确认后关闭 nginx 拦截并发布空脚本，nginx -t 与 reload 已通过；Cloudflare Pages 与 GitHub Pages 镜像尚未发布。保留 mac-block.js 空脚本以兼容旧页面与游戏同步脚本。此变更恢复访问，尚未在真实 Mac 上验证全部游戏兼容性。
