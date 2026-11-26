# bobbycn.cc auth.md

阅读公开文章、浏览游戏厅和查询文章浏览数都可以匿名进行。自动化客户端要通过只读目录 API 搜索公开入口，可以领取一小时有效的目录密钥。需要读取个人资料的应用使用下文的用户 OAuth 授权码流程。

## 为代理注册目录密钥（anonymous agent registration）

1. 读取 [目录资源元数据](https://bobbycn.cc/.well-known/oauth-protected-resource/agent/directory)，再从[授权服务器元数据](https://bobbycn.cc/.well-known/oauth-authorization-server)的 `agent_auth` 查看支持的方法和地址。
2. 向 `POST https://bobbycn.cc/agent/auth` 发送 `Content-Type: application/json` 和以下 JSON。首次请求无需凭据。

   ```json
   {"type":"anonymous","requested_credential_type":"api_key"}
   ```

3. 成功响应包含 `registration_id`、`credential`、`credential_expires`、`scopes` 及领取信息。将 `credential` 作为 Bearer API key 保存在客户端。它仅具备 `directory.read` 权限。
4. 用 `GET https://bobbycn.cc/agent/directory?query=Minecraft` 查询。请求头使用 `Authorization: Bearer <credential>`。结果的 `entries` 数组含标题 `title` 与站内网址 `url`。省略 `query` 可列出目录。凭据到期或被撤销后会收到 HTTP 401；仍需要目录访问时重新注册。
5. 使用完毕，向 `POST https://bobbycn.cc/agent/auth/revoke` 发送相同的 Bearer 请求头，正文留空。HTTP 204 表示撤销成功。

### 把撤销权限交给人

代理取得目录密钥后即可查询。如需由人独立撤销，在 `claim_token_expires` 前，向注册响应的 `claim_url`（`POST https://bobbycn.cc/agent/auth/claim`）发送 JSON `{"claim_token":"<claim_token>"}`。界面向用户展示返回的 `verification_uri` 和 `user_code`。用户亲自打开[目录密钥领取页](https://bobbycn.cc/agent/claim)，输入短码并确认。页面只展示一次 `owner_token`，用户可保存它，用同一页面或撤销 API 作废这次注册。领取确认的是短码持有权，目录密钥的权限和期限继续适用。保持密钥、领取令牌和所有者令牌私密。

## 以站点用户身份访问个人资料

### 接入登记

第三方应用接入采用人工登记。应用运营者可向 [contact@bobbycn.cc](mailto:contact@bobbycn.cc) 提供应用名称、精确的 HTTPS 回调地址和需要的权限。站长登记后分配 `client_id`，机密客户端另领 `client_secret`。用户可在[账号中心](https://bobbycn.cc/account/)管理已授予的访问权限。

### 让用户授权

1. 从[授权服务器元数据](https://bobbycn.cc/.well-known/oauth-authorization-server)读取授权、令牌和撤销端点。
2. 生成随机 `state` 和 PKCE 验证值，将验证值的 SHA-256 摘要编码为无填充的 base64url。用用户的浏览器打开授权端点，携带 `response_type=code`、自己的 `client_id`、登记的 `redirect_uri`、`scope`、`state`、`code_challenge` 和 `code_challenge_method=S256`。让用户本人在站点登录并决定是否同意。
3. 在回调处核对 `state`。用户拒绝时结束流程。收到授权码后，向令牌端点发送表单 POST，提交 `grant_type=authorization_code`、`client_id`、原 `redirect_uri`、`code` 和 `code_verifier`。机密客户端从自己的后端提交 `client_secret`。
4. 以 `Authorization: Bearer <access_token>` 请求 `GET https://bobbycn.cc/api/auth/identity/oauth/userinfo`。身份标识使用 `openid`，昵称资料使用 `profile`，读取邮箱另需 `email`。仅请求当前用途需要的权限。资料端点的授权方和传递方式见[受保护资源元数据](https://bobbycn.cc/.well-known/oauth-protected-resource)。
5. 需续期时，在令牌端点使用表单字段 `grant_type=refresh_token`、`refresh_token` 和同一客户端的认证信息。成功后保存新返回的刷新令牌。结束授权时可向撤销端点 POST 当前刷新令牌（`token`）及同一客户端的认证信息。
