/* 第三方登录配置（bobbychina.github.io/games）
   ----------------------------------------------------------------------------
   把注册好的 client_id 填进下面的引号里就会自动启用对应的「一键登录」——
   没填也不会坏：界面会走兜底路线（GitHub 用令牌绑定，微软提示去配置）。

   ① GitHub OAuth App（免费，约 3 分钟）
      打开 https://github.com/settings/applications/new
        Application name          ：bobbychina games
        Homepage URL              ：https://bobbychina.github.io/games/
        Authorization callback URL：https://bobbychina.github.io/games/oauth-callback.html
      创建后点「Generate a new client secret」不必填到这里（静态站不存密钥）；
      把 Client ID 填到下面 github.clientId。
      ⚠️ 关键：创建完在应用设置页勾上 **Enable Device Flow**（这样即使浏览器拿不到
         OAuth 的 CORS 响应，也还有"设备码"这条备用路可走）。

   ② 微软 Entra 应用注册 —— **已放弃（2026-09-12 实测）**
      个人微软账号在 entra.microsoft.com / Azure 门户走「创建租户 / 注册应用」时，
      会被要求绑定信用卡（等于先开 Azure 订阅）。我们不需要为登录花这个钱：
      **GitHub 一条路已经够用**，所以 microsoft.clientId 保持空，
      界面会自动隐藏「绑定微软账号」按钮（代码与 OneDrive 云盘逻辑仍在，
      哪天你有企业/学校租户，填上 clientId 就立刻可用）。
*/
window.DSH_AUTH_CONFIG = {
  /* ══════════════════════════════════════════════════════════════════════════
     站点统一授权（2026-10-08 起，站内游戏的主登录方式）
     ----------------------------------------------------------------------------
     站点账号就是唯一账号：游戏通过 OAuth 2.0 授权码 + PKCE 拿站点身份
     （/api/auth/identity/oauth/*，源码见 stockGameOnlinePro/backend/src/modules/identity/oauth.*）。
     客户端 SDK：/games/site-auth.js（window.SiteAuth）+ /games/site-saves.js（云存档）。
     这一节只需要在**加新游戏**时补一行：目录名 → client_id（client_id 在后端种子表里注册）。
     ══════════════════════════════════════════════════════════════════════════ */
  site: {
    /* 站点基址。留空 = 按域名自动判定：
         · *.bobbycn.cc（含 staging）→ 用当前源（同源，Cookie 天然可用）；
         · 其它源（GitHub Pages 镜像 / 本机静态站）→ 也用当前源，靠门户自身中继 /api。
       本机开发时静态站与后端是两个端口，必须显式填后端地址，例如：
         relay: 'http://127.0.0.1:8099',   后端用 node scripts/_local-oauth-server.ps1 起 */
    relay: '',
    /* 游戏目录 → client_id。key 是 /games/ 下的目录名；值是后端注册的 client_id。
       目录名与 client_id 一致时可以省略（SDK 会用目录名当 client_id）。 */
    games: {
      'games': 'bobbycn-games',
      'zombie-survival': 'zombie-survival',
      'dreamcore': 'dreamcore-walk',
      'vampire-survivors': 'vampire-survivors',
      'racing3d': 'racing3d',
    },
  },

  /* 云账号后端：同一个 Cloudflare Worker 既做 GitHub 中继，也做账号/云存档/排行榜 API。
     换成你自己的 Worker 地址即可；留空 '' = 退回纯本机账号（不联网）。
     ⚠️ 它是 `*.workers.dev`：部分网络（校园网/运营商）把这个域名整段 DNS 黑洞。
     账号库会把下面的 github.relay 当**第一候选**、这里当兜底（和排行榜同一套策略），
     所以只要能连上中继，注册/登录/云存档/榜单就都能用；两个都不通时会明确告诉用户
     "这次只能建本机账号"，不再静默降级。
     ⚠️ 2026-10-08 起：站内游戏的登录与云存档已迁到站点账号（见上面的 site 段），
     这段 Worker 配置只服务于**老账号/老存档的一次性迁移**与排行榜的历史兼容。 */
  api: 'https://dsh-oauth-relay.bobby-minecraft.workers.dev',

  // 回调页：一定要和上面登记的地址逐字一致
  // ⚠️ 换域名后要去 GitHub OAuth App 设置里把 Authorization callback URL 同步改成这个
  redirect: 'https://bobbycn.cc/games/oauth-callback.html',

  github: {
    clientId: 'Ov23liPzQ7xNDx0FdUdh',   // bobbychina's games（2026-09-12 注册，Device Flow 已开）
    scope: 'gist read:user',      // gist = 云存档用的私有 Gist；read:user = 显示头像/用户名
    /* 中继：**整个 /api/* 都从这儿转发**（账号、云存档、全站榜），外加 OAuth 两条端点。
       2026-09-28 起中继搬到自己家服务器：`bobbycn.cc` 的 nginx 复刻了原来 CF Pages Functions
       （源码见 stockGameOnlinePro/deploy/nginx/portal.conf；旧实现 functions/[[path]].js 仍留在仓库里备查）。
       走自家域名就不再受"某些网络把 *.pages.dev / *.workers.dev 整段 DNS 黑洞"的影响。
       留空 = 只走直连（会先试直连，失败再报"连不上云后端"）。 */
    relay: 'https://bobbycn.cc',
    // 旧的 Worker 版（同账号，留个地址备查；在黑洞网络里不可达）：https://dsh-oauth-relay.bobby-minecraft.workers.dev
  },

  microsoft: {
    clientId: '',                 // ← 例如 '11111111-2222-3333-4444-555555555555'
    tenant: 'common',             // 个人账户 + 组织账户都用 common
    scope: 'openid profile offline_access User.Read Files.ReadWrite.AppFolder',
  },
};
