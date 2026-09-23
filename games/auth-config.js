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
  /* 云账号后端：同一个 Cloudflare Worker 既做 GitHub 中继，也做账号/云存档/排行榜 API。
     换成你自己的 Worker 地址即可；留空 '' = 退回纯本机账号（不联网）。
     ⚠️ 它是 `*.workers.dev`：部分网络（校园网/运营商）把这个域名整段 DNS 黑洞。
     账号库会把下面的 github.relay 当**第一候选**、这里当兜底（和排行榜同一套策略），
     所以只要能连上中继，注册/登录/云存档/榜单就都能用；两个都不通时会明确告诉用户
     "这次只能建本机账号"，不再静默降级。 */
  api: 'https://dsh-oauth-relay.bobby-minecraft.workers.dev',

  // 回调页：一定要和上面登记的地址逐字一致
  redirect: 'https://bobbychina.github.io/games/oauth-callback.html',

  github: {
    clientId: 'Ov23liPzQ7xNDx0FdUdh',   // bobbychina's games（2026-09-12 注册，Device Flow 已开）
    scope: 'gist read:user',      // gist = 云存档用的私有 Gist；read:user = 显示头像/用户名
    /* 中继（Cloudflare Pages）：原来只为 OAuth 兜底，现在**整个 /api/* 都从这儿转发**
       （账号、云存档、全站榜），因为 `*.workers.dev` 在部分网络被整段 DNS 黑洞 ——
       2026-09-23 之前只转发 /api/score，于是黑洞网络里注册会静默降级成本机账号。
       源码：本仓库根目录 functions/[[path]].js；部署：`node tools/deploy-relay.mjs bobbychina-games`。
       留空 = 只走直连（会先试直连，失败再报"连不上云后端"）。 */
    relay: 'https://bobbychina-games.pages.dev',
    // 旧的 Worker 版（同账号，留个地址备查；在黑洞网络里不可达）：https://dsh-oauth-relay.bobby-minecraft.workers.dev
  },

  microsoft: {
    clientId: '',                 // ← 例如 '11111111-2222-3333-4444-555555555555'
    tenant: 'common',             // 个人账户 + 组织账户都用 common
    scope: 'openid profile offline_access User.Read Files.ReadWrite.AppFolder',
  },
};
