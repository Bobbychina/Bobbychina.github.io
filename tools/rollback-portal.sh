#!/usr/bin/env bash
# 回滚 bobbycn.cc 的静态站到某次部署前的状态
#
# 用法（在服务器上，或用 ssh 执行）：
#   bash rollback-portal.sh            # 列出可用快照
#   bash rollback-portal.sh latest     # 回滚到最近一次快照
#   bash rollback-portal.sh 20261007-2230
#
# 快照由 .github/workflows/deploy.yml 在每次部署前写入 /opt/stockgame/snapshots/，
# 内容是「上一次部署前的 /var/www/portal 全量 tar 包」。
set -euo pipefail

SNAP_DIR=/opt/stockgame/snapshots
PORTAL=/var/www/portal

if [ ! -d "$SNAP_DIR" ] || [ -z "$(ls -A "$SNAP_DIR" 2>/dev/null)" ]; then
  echo "没有任何快照（$SNAP_DIR 为空）——说明还没有从这个工作流部署过。" >&2
  exit 1
fi

if [ $# -eq 0 ]; then
  echo "可用快照（新 → 旧）："
  ls -1t "$SNAP_DIR"/portal-*.tar.gz 2>/dev/null | head -20
  echo
  echo "用法：bash $0 latest  或  bash $0 <时间戳>"
  exit 0
fi

if [ "$1" = "latest" ]; then
  TARGET=$(ls -1t "$SNAP_DIR"/portal-*.tar.gz | head -1)
else
  TARGET="$SNAP_DIR/portal-$1.tar.gz"
fi

[ -f "$TARGET" ] || { echo "找不到快照：$TARGET" >&2; exit 1; }

echo "将回滚到：$TARGET"
echo "当前线上文件数：$(sudo find "$PORTAL" -type f | wc -l)"

# 回滚前把「当前状态」也存一份，避免回滚本身变成不可逆操作
sudo cp "$TARGET" "/tmp/portal-prebounce-$(date +%H%M%S).tar.gz"

sudo tar -xzf "$TARGET" -C "$PORTAL"
sudo chown -R www-data:www-data "$PORTAL"
sudo find "$PORTAL" -type d -exec chmod 755 {} +
sudo find "$PORTAL" -type f -exec chmod 644 {} +

echo "回滚完成。线上文件数：$(sudo find "$PORTAL" -type f | wc -l)"
echo "建议立即核验：curl -s -o /dev/null -w '%{http_code}\\n' https://bobbycn.cc/"
echo
echo "注意：快照只含本仓库管理的静态内容，不含 admin/ posts/ media/ .deny/"
echo "（那几个目录不在部署范围内，因此也不会被回滚影响）。"
