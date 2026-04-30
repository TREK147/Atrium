#!/usr/bin/env bash
# 将 backend/sql/apply_emo_system_full_schema.sql 导入宝塔中的 emo_system 库
# 依赖：项目根目录 .env 中 MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQL="$ROOT/backend/sql/apply_emo_system_full_schema.sql"
if [ ! -f "$SQL" ]; then
  echo "找不到: $SQL"
  exit 1
fi
export $(grep -E '^MYSQL_' "$ROOT/../.env" 2>/dev/null | xargs) || true
export MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
export MYSQL_PORT="${MYSQL_PORT:-3306}"
export MYSQL_DATABASE="${MYSQL_DATABASE:-emo_system}"
export MYSQL_USER="${MYSQL_USER:-emo_system}"
if [ -z "${MYSQL_PASSWORD:-}" ]; then
  echo "请在 /root/emo_detect/.env 中设置 MYSQL_PASSWORD"
  exit 1
fi
mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < "$SQL"
echo "已导入 apply_emo_system_full_schema.sql -> $MYSQL_DATABASE"
