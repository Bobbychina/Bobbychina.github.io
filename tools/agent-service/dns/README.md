# 发布 bobbycn.cc 的代理目录记录

DNS-AID 使用 `_index._agents.bobbycn.cc` 指向站点的公开目录。目录中的两条 ARD 记录分别指向 MCP 与 A2A 的描述文件，客户端从描述文件取得实际服务地址。SVCB 提供 HTTPS 主机、端口和 HTTP/2，配套 TXT 提供目录路径。[DNS-AID 草案 §3.2 和 §4](https://datatracker.ietf.org/doc/html/draft-mozleywilliams-dawn-dnsaid#section-3.2) · [ARD 条目格式](https://agenticresourcediscovery.org/spec/)

1. 从公网获取 `https://bobbycn.cc/.well-known/agent-directory`。核对两条记录中的 `url` 均返回 JSON，并分别测试卡片中的 `/mcp` 和 `/a2a`。
2. 在 Cloudflare 的 bobbycn.cc 区域打开 **DNS → Records**，查询 `_index._agents`。若已有记录，核对类型、目标与内容，保留原值以便回退，已有相同记录可跳过。
3. 在 **Import and Export** 中导入本目录的 `agent-index.zone`，使用 **DNS only**。该文件仅含此名称的一条 SVCB 和一条 TXT。若界面要求逐条添加，按下表录入。

| 类型 | 名称 | TTL | 数据 |
| --- | --- | --- | --- |
| SVCB | `_index._agents` | 300 秒 | Priority `1`，Target `bobbycn.cc.`，Value `alpn="h2" port=443` |
| TXT | `_index._agents` | 300 秒 | `path=/.well-known/agent-directory` |

4. 从权威 DNS 和公共递归解析器读取上述两条记录，并访问所指的目录。示例命令为 `dig @marissa.ns.cloudflare.com _index._agents.bobbycn.cc SVCB`、`dig @1.1.1.1 _index._agents.bobbycn.cc SVCB` 和 `dig @1.1.1.1 _index._agents.bobbycn.cc TXT`。先前缓存的 NXDOMAIN 可能会保留至其否定缓存 TTL 到期。
5. 如需回退，仅移除本次新增的两条记录。对曾有旧值的记录恢复其原值。
