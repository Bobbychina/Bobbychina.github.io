---
name: read-blog-views
description: 按公开文章的链接查询潮汐太空港已记录的浏览数。
---

# 查询公开文章浏览数

1. 从[文章目录](https://bobbycn.cc/posts/)或用户提供的本站文章链接，取得 `/posts/<slug>/` 中的文章标识。
2. 发送匿名 GET 请求到 `https://bobbycn.cc/api/blog/views`，把文章标识放进 `slugs` 查询参数。多个标识用英文逗号连接，每批最多 200 个。例如 [self-hosted-in-tokyo 的计数](https://bobbycn.cc/api/blog/views?slugs=self-hosted-in-tokyo)。
3. 成功响应是 JSON。按原标识从 `views` 对象中读取数值。响应缺少某篇文章的键时，告诉用户当前没有计数记录。服务报错时，保留错误状态，不能据此判断浏览数。

字段定义见[公开 API 描述](https://bobbycn.cc/.well-known/blog-views.openapi.json)。
