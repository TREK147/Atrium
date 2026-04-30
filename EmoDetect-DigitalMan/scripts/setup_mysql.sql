-- 在 MySQL/MariaDB 中执行：创建库与专用账号（按需改密码）
-- 用法：mysql -u root -p < setup_mysql.sql
-- 或：sudo mysql < setup_mysql.sql

CREATE DATABASE IF NOT EXISTS emo_system
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 若希望独立账号（推荐生产环境），取消下面注释并设置强密码
-- CREATE USER IF NOT EXISTS 'emo_app'@'localhost' IDENTIFIED BY '请改为强密码';
-- GRANT ALL PRIVILEGES ON emo_system.* TO 'emo_app'@'localhost';
-- FLUSH PRIVILEGES;
