-- 情绪标签表：与 emo_system.users 的 id 对应，存该用户对应的情绪标签
-- 数据库: emo_system
-- 执行: mysql -u emo_system -p emo_system < sql/create_emotion_labels.sql

CREATE TABLE IF NOT EXISTS emotion_labels (
  id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
  user_id       INT          NOT NULL COMMENT '用户 id，对应 users.id',
  emotion_label VARCHAR(64)  NOT NULL COMMENT '情绪标签',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
  KEY idx_user_id (user_id),
  KEY idx_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户情绪标签表';
