-- 初始化 MySQL 用户与数据库（解决 1045 Access denied）
-- 使用 root 或有 CREATE USER 权限的账号执行本脚本
-- 执行: mysql -u root -p < sql/init_mysql_user.sql

CREATE DATABASE IF NOT EXISTS emo_system
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

-- 若用户已存在则先删除（避免密码不一致导致 1045）
DROP USER IF EXISTS 'emo_system'@'localhost';

CREATE USER 'emo_system'@'localhost'
  IDENTIFIED BY '2bpWJt4mBGCJpGkm';

GRANT ALL PRIVILEGES ON emo_system.* TO 'emo_system'@'localhost';
FLUSH PRIVILEGES;
