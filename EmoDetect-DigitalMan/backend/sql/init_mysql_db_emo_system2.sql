-- 初始化 MySQL 新数据库 emo_system2（给 root 授权）
-- 使用 root 账号执行本脚本：
-- mysql -u root -p < sql/init_mysql_db_emo_system2.sql

CREATE DATABASE IF NOT EXISTS emo_system2
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

-- 为了兼容“root 从不同来源连接”的情况，这里同时授权 localhost 与 %
-- 如需更严格安全策略，可将 % 替换为你的应用服务器 IP/主机名。
GRANT ALL PRIVILEGES ON emo_system2.* TO 'root'@'localhost';
GRANT ALL PRIVILEGES ON emo_system2.* TO 'root'@'%';

FLUSH PRIVILEGES;

