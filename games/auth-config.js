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
  /* 云账号后端：同一个 Cloudflare Worker 既做 GitHub 中继，也做账号/云存档 API。
     换成你自己的 Worker 地址即可；留空 '' = 退回纯本机账号（不联网）。 */
  api: 'https://dsh-oauth-relay.bobby-minecraft.workers.dev',

  // 回调页：一定要和上面登记的地址逐字一致
  redirect: 'https://bobbychina.github.io/games/oauth-callback.html',

  github: {
    clientId: 'Ov23liPzQ7xNDx0FdUdh',   // bobbychina's games（2026-09-12 注册，Device Flow 已开）
    scope: 'gist read:user',      // gist = 云存档用的私有 Gist；read:user = 显示头像/用户名
    /* 可选：GitHub 的换 token 接口不给浏览器跨域头，静态站拿不到响应时用中继兜底。
       部署一个 Cloudflare Worker（免费、不要卡）：
         npx wrangler login
         npx wrangler deploy tools/oauth-relay-worker.js --name dsh-oauth-relay
       然后把 https://dsh-oauth-relay.<你的子域>.workers.dev 填到这里，一键授权就通了。
       留空 = 只走直连（客户端会先试 form 简单请求、再试 JSON，两条都失败才报错）。 */
    relay: 'https://dsh-oauth-relay.bobby-minecraft.workers.dev',
  },

  microsoft: {
    clientId: '',                 // ← 例如 '11111111-2222-3333-4444-555555555555'
    tenant: 'common',             // 个人账户 + 组织账户都用 common
    scope: 'openid profile offline_access User.Read Files.ReadWrite.AppFolder',
  },
};
