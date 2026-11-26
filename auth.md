# bobbycn.cc auth.md

阅读公开文章、浏览游戏目录和查询文章浏览数都可以匿名进行。需要以用户身份读取资料的应用可以使用站点 OAuth 授权码流程。

## 接入登记

第三方应用接入采用人工登记。应用运营者可向 [contact@bobbycn.cc](mailto:contact@bobbycn.cc) 提供应用名称、精确的 HTTPS 回调地址和需要的权限。站长登记后分配 `client_id`，机密客户端另领 `client_secret`。用户可在[账号中心](https://bobbycn.cc/account/)管理已授予的访问权限。

## 让用户授权

1. 从[授权服务器元数据](https://bobbycn.cc/.well-known/oauth-authorization-server)读取授权、令牌和撤销端点。
2. 生成随机 `state` 和 PKCE 验证值，将验证值的 SHA-256 摘要编码为无填充的 base64url。用用户的浏览器打开授权端点，携带 `response_type=code`、自己的 `client_id`、登记的 `redirect_uri`、`scope`、`state`、`code_challenge` 和 `code_challenge_method=S256`。让用户本人在站点登录并决定是否同意。
3. 在回调处核对 `state`。用户拒绝时结束流程。收到授权码后，向令牌端点发送表单 POST，提交 `grant_type=authorization_code`、`client_id`、原 `redirect_uri`、`code` 和 `code_verifier`。机密客户端从自己的后端提交 `client_secret`。
4. 以 `Authorization: Bearer <access_token>` 请求 `GET https://bobbycn.cc/api/auth/identity/oauth/userinfo`。身份标识使用 `openid`，昵称资料使用 `profile`，读取邮箱另需 `email`。仅请求当前用途需要的权限。资料端点的授权方和传递方式见[受保护资源元数据](https://bobbycn.cc/.well-known/oauth-protected-resource)。
5. 需续期时，在令牌端点使用表单字段 `grant_type=refresh_token`、`refresh_token` 和同一客户端的认证信息。成功后保存新返回的刷新令牌。结束授权时可向撤销端点 POST 当前刷新令牌（`token`）及同一客户端的认证信息。
