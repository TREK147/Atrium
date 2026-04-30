#!/usr/bin/env bash
# 在本机安装 MariaDB（若未安装）、创建 emo_system 库并执行 Python init_db 建表
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
SQL_FILE="$(dirname "$0")/setup_mysql.sql"

echo "==> 1) 检查 MariaDB / MySQL 服务"

if command -v mysql >/dev/null 2>&1 && (systemctl is-active --quiet mariadb 2>/dev/null || systemctl is-active --quiet mysqld 2>/dev/null); then
  echo "    已有运行中的 MariaDB/MySQL，跳过安装"
elif command -v yum >/dev/null 2>&1; then
  echo "    尝试安装 mariadb-server（需 root）..."
  sudo yum install -y mariadb-server mariadb || true
  sudo systemctl enable --now mariadb || sudo systemctl enable --now mysqld || true
elif command -v apt-get >/dev/null 2>&1; then
  echo "    尝试安装 mariadb-server（需 root）..."
  sudo apt-get update -y
  sudo apt-get install -y mariadb-server
  sudo systemctl enable --now mariadb
fi

echo "==> 2) 创建数据库 emo_system"
if sudo mysql --version >/dev/null 2>&1; then
  sudo mysql < "$SQL_FILE"
elif mysql --version >/dev/null 2>&1; then
  mysql -u root -p < "$SQL_FILE" || mysql -u root < "$SQL_FILE"
else
  echo "未找到 mysql 客户端，请手动执行: mysql -u root -p < $SQL_FILE"
  exit 1
fi

echo "==> 3) Python 建表（init_db）"
cd "$BACKEND"
export MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
export MYSQL_PORT="${MYSQL_PORT:-3306}"
export MYSQL_DATABASE="${MYSQL_DATABASE:-emo_system}"
export MYSQL_USER="${MYSQL_USER:-root}"
export MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
python3 -c "import database; database.init_db()"
echo "完成。请在项目根目录 .env 中设置 MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE（与上面一致）。"
