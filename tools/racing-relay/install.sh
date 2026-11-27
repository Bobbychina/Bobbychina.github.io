#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rev=${1:?commit required}
[[ "$rev" =~ ^[0-9a-f]{40}$ ]]
service=oval-racing-relay
image="$service:$rev"
vhost=/etc/nginx/conf.d/portal.conf
snippet=/etc/nginx/snippets/oval-racing-relay.conf
anchor='include /etc/nginx/snippets/agent-readiness-locations.conf;'
include="include $snippet;"
if ! grep -Fq "$include" "$vhost"; then
  test "$(grep -Fc "$anchor" "$vhost")" = 1
fi
docker build --tag "$image" .
health() { curl -fsS --max-time 2 http://127.0.0.1:18789/games/racing3d/relay/health | grep -qx 'oval-relay-v1'; }
if docker inspect "$service-prev" >/dev/null 2>&1; then echo 'Previous rollback container still present' >&2; exit 1; fi
backup=$(mktemp -d)
cp -p "$vhost" "$backup/portal.conf"
if test -e "$snippet"; then cp -p "$snippet" "$backup/route.conf"; fi
had_old=0
if docker inspect "$service" >/dev/null 2>&1; then
  docker rename "$service" "$service-prev"
  docker stop "$service-prev"
  had_old=1
fi
rollback() {
  docker rm -f "$service" >/dev/null 2>&1 || true
  if test "$had_old" = 1; then docker rename "$service-prev" "$service"; docker start "$service"; fi
  cp -p "$backup/portal.conf" "$vhost"
  if test -f "$backup/route.conf"; then cp -p "$backup/route.conf" "$snippet"; else rm -f "$snippet"; fi
  nginx -t && systemctl reload nginx
}
trap rollback ERR
docker run -d --name "$service" --restart unless-stopped --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 64 --memory 128m --cpus 0.5 --log-opt max-size=2m --log-opt max-file=2 \
  -p 127.0.0.1:18789:8789 "$image"
for t in {1..15}; do if health; then break; fi; sleep 1; done
health
install -m 644 route.conf "$snippet"
if ! grep -Fq "$include" "$vhost"; then
  sed -i "\\|$anchor|a\\    $include" "$vhost"
fi
nginx -t
systemctl reload nginx
trap - ERR
if test "$had_old" = 1; then docker rm "$service-prev"; fi
echo 'Racing relay is ready'
