-- 用户表：用于注册与登录
-- 数据库: emo_system
-- 执行: mysql -u emo_system -p emo_system < sql/create_users.sql

CREATE TABLE IF NOT EXISTS users (
  id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
  mail          VARCHAR(255) NOT NULL COMMENT '邮箱',
  username      VARCHAR(100) NOT NULL COMMENT '用户名',
  password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希（加密存储）',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  UNIQUE KEY uk_mail (mail),
  KEY idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';
