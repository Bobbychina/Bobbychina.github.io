# bobbychina.github.io

我的个人主页 + 网页游戏厅，纯静态站点，托管在 GitHub Pages。

- 主页：<https://bobbychina.github.io/>
- 游戏厅：<https://bobbychina.github.io/games/>
- 在线玩：<https://bobbychina.github.io/games/zombie-survival/>

## 结构

| 路径 | 说明 |
|---|---|
| `index.html` | 主页（项目 / 游戏厅 / 关于），单文件、零依赖 |
| `games/index.html` | 游戏厅入口，含账号面板说明 |
| `games/zombie-survival/index.html` | 游戏本体，**由游戏仓库构建后同步过来**（`zombie-survival/tools/sync-site.mjs`），别手改 |
| `games/account.js` | 账号/云存档客户端，同样是从游戏仓库同步来的 |
| `games/auth-config.js` | 云后端地址与 GitHub OAuth client_id |
| `games/oauth-callback.html` | OAuth 回调页 |
| `beta-notice.js` | 全站 BETA 声明条 + 手机端未适配提醒 + 第一方匿名访问计数 |
| `tools/site-probe.mjs` | 站点自检：公开文案、外链、横向滚动、移动视口 |
| `tools/site-beta-probe.mjs` | BETA 条与手机提醒的 DOM 自检（含截图） |

## 反馈

有 bug、想提建议、或者哪个页面在手机上炸了：**<https://github.com/Bobbychina/Bobbychina.github.io/issues>**

游戏本身的玩法/存档问题提到游戏仓库：**<https://github.com/Bobbychina/zombie-survival/issues>**

## 当前状态

整站是 **BETA**（页面顶部那条横条就是它）：还在开发中，不代表最终品质。
已知情况：

- **手机端做了基础适配**（按钮 ≥44px、字号下限、无横向滚动），但游戏仍以键鼠为设计目标，地图操作和快捷键在手机上不如电脑顺手；手机上会弹一条提醒。
- 访问计数是自己 Worker 上的匿名计数（无 Cookie、不存 IP）；除此之外页面不加载任何第三方脚本。
- 云后端是自建的 Cloudflare Worker（免费额度），忙时可能返回"今天上传次数用完"，本地存档不受影响。

## 许可

[PolyForm Noncommercial License 1.0.0](LICENSE)：源码可以随便读、改、分享、拿去玩或做视频/教学，**但不能用于任何商业用途**。

## 本地预览

任何静态服务器都行（请不要直接双击 `file://`，云存档与 OAuth 需要 http 源）：

```powershell
npx serve .          # 或
python -m http.server 5180
```
