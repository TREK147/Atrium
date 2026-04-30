#!/usr/bin/env python3
"""
在 MySQL 上创建 emo_system 库（不指定库名连接，执行 CREATE DATABASE）。
依赖：pip install pymysql python-dotenv
用法（在项目根目录 /root/emo_detect 下）：
  export MYSQL_HOST=127.0.0.1 MYSQL_USER=root MYSQL_PASSWORD='你的密码'
  python3 EmoDetect-DigitalMan/scripts/create_database.py

或把 MYSQL_* 写在 /root/emo_detect/.env 后：
  python3 EmoDetect-DigitalMan/scripts/create_database.py
"""
import os
import sys

try:
    from dotenv import load_dotenv
    _root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    load_dotenv(os.path.join(_root, ".env"))
except ImportError:
    pass

import pymysql

HOST = os.environ.get("MYSQL_HOST", "127.0.0.1")
PORT = int(os.environ.get("MYSQL_PORT", "3306"))
USER = os.environ.get("MYSQL_USER", "root")
PASSWORD = os.environ.get("MYSQL_PASSWORD", "")
DATABASE = os.environ.get("MYSQL_DATABASE", "emo_system")


def main():
    allow_empty = "--allow-empty-password" in sys.argv
    if not PASSWORD and not allow_empty:
        print(
            "未设置 MYSQL_PASSWORD，无法连接 MySQL。\n"
            "请任选其一：\n"
            "  1) 在 /root/emo_detect/.env 中设置 MYSQL_HOST、MYSQL_USER、MYSQL_PASSWORD、MYSQL_DATABASE\n"
            "  2) 一行命令（把密码换成你的）：\n"
            "     MYSQL_HOST=127.0.0.1 MYSQL_USER=root MYSQL_PASSWORD='你的密码' python3 EmoDetect-DigitalMan/scripts/create_database.py\n"
            "  3) 手动登录：mysql -u root -p  然后执行 scripts/setup_mysql.sql 里的 SQL\n"
        )
        sys.exit(1)
    conn = pymysql.connect(
        host=HOST,
        port=PORT,
        user=USER,
        password=PASSWORD,
        charset="utf8mb4",
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{DATABASE}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        conn.commit()
        print(f"已创建或已存在数据库: {DATABASE} @ {HOST}:{PORT}")
        with conn.cursor() as cur:
            cur.execute("SHOW DATABASES LIKE %s", (DATABASE,))
            row = cur.fetchone()
            print("校验:", row)
    finally:
        conn.close()


if __name__ == "__main__":
    if "--allow-empty-password" in sys.argv:
        os.environ["MYSQL_PASSWORD"] = os.environ.get("MYSQL_PASSWORD", "")
    main()
