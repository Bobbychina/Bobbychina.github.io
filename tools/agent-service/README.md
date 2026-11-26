# 站点目录与内容协商

首页通过 WebMCP 注册 `search_site_directory`。同一份公开目录数据由 `/mcp` 和 `/a2a` 提供给远程客户端。文章浏览数和站点 OAuth 各自沿用站点现有的后端接口。公开文档位于仓库根目录的 `.well-known/` 和 `auth.md`。

在本目录执行 `npm ci --omit=dev --ignore-scripts` 安装锁定版本的依赖，执行 `node --test markdown.test.cjs` 检查内容协商。运行 `node server.cjs` 后，服务默认监听 `127.0.0.1:18746`。可通过 `PORTAL_ROOT` 指定主站静态根目录，通过 `BLOG_POSTS_ROOT` 指定已发布文章目录。

## 源站部署

`install.py install` 用于首次定向安装。将服务代码、生产依赖、首页及目录脚本、robots.txt、auth.md 和 .well-known 文件放在独立发布目录的 `src/` 下，保持仓库相对路径。脚本将变更前的文件和清单保存到同级 `rollback/`，检查首页是否漂移、Nginx 配置能否加载，并在本机请求 Markdown 成功后重载 Nginx。用同一脚本的 `rollback` 子命令还原该次安装。

服务使用源站已有的 Node 22 Alpine 镜像，仅将端口发布到本机回环地址。容器只读挂载首页、游戏厅、资源页、赞助页及已发布文章。主站常规部署会重启此目录容器，以便重新绑定更换过的 HTML 文件。若使用单文件发布脚本原子替换这些挂载文件，发布完成后同样执行 `docker restart bobbycn-agent-directory`。博客文章从挂载的文章目录按请求读取。

DNS 记录和导入说明见 [dns](dns/README.md)。
