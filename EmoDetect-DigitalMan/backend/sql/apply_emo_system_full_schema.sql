-- 与 backend/database.py 中 init_db() 建表逻辑一致，导入到宝塔已有库 emo_system 即可
-- 用法（在服务器上）：
--   mysql -h127.0.0.1 -u emo_system -p emo_system < backend/sql/apply_emo_system_full_schema.sql
-- 或在 phpMyAdmin 选中数据库 emo_system → 导入本文件

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

USE `emo_system`;

-- ---------- users / emotion_labels ----------
CREATE TABLE IF NOT EXISTS users (
  id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
  mail          VARCHAR(255) NOT NULL COMMENT '邮箱',
  username      VARCHAR(100) NOT NULL COMMENT '用户名',
  password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希（加密存储）',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  UNIQUE KEY uk_mail (mail),
  KEY idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

CREATE TABLE IF NOT EXISTS emotion_labels (
  id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
  user_id       INT          NOT NULL COMMENT '用户 id，对应 users.id',
  emotion_label VARCHAR(64)  NOT NULL COMMENT '情绪标签',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
  KEY idx_user_id (user_id),
  KEY idx_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户情绪标签表';

-- ---------- conversations / messages ----------
CREATE TABLE IF NOT EXISTS conversations (
  id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
  user_id       INT          NOT NULL COMMENT '用户 id',
  title         VARCHAR(255) NOT NULL DEFAULT '新对话' COMMENT '会话标题',
  last_message  VARCHAR(500) NULL COMMENT '最后一条消息摘要',
  pinned        TINYINT      NOT NULL DEFAULT 0 COMMENT '是否固定 0/1',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user_id (user_id),
  KEY idx_user_updated (user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户会话表';

CREATE TABLE IF NOT EXISTS messages (
  id              INT          NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
  conversation_id INT          NOT NULL COMMENT '会话 id',
  role            VARCHAR(20)  NOT NULL DEFAULT 'user' COMMENT 'user | assistant',
  content         TEXT         NOT NULL COMMENT '消息内容',
  type            VARCHAR(20)  NOT NULL DEFAULT 'text' COMMENT 'text|image|file|voice|video',
  file_url        VARCHAR(500) NULL,
  file_name       VARCHAR(255) NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_conv_id (conversation_id),
  KEY idx_conv_created (conversation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会话消息表';

-- ---------- emotion_anomalies / proactive_triggers ----------
CREATE TABLE IF NOT EXISTS emotion_anomalies (
  id             INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id        INT          NOT NULL,
  emotion_label  VARCHAR(64)  NOT NULL COMMENT '情绪标签',
  reason         TEXT         NULL COMMENT '具体原因（来自聊天时填写，来自监控可空）',
  from_monitoring TINYINT     NOT NULL DEFAULT 0 COMMENT '0=聊天 1=监控',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='情绪异常记录';

CREATE TABLE IF NOT EXISTS proactive_triggers (
  id             INT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id        INT      NOT NULL,
  trigger_type   VARCHAR(32) NOT NULL DEFAULT 'monitoring' COMMENT 'monitoring|repeated_anomaly',
  acknowledged_at DATETIME NULL COMMENT '用户已响应时间',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_pending (user_id, acknowledged_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='主动疏导触发记录';

-- ---------- user_schedules ----------
CREATE TABLE IF NOT EXISTS user_schedules (
  id           INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      INT          NOT NULL,
  title        VARCHAR(500) NOT NULL COMMENT '事项标题',
  scheduled_at DATETIME     NOT NULL COMMENT '计划时间',
  end_at       DATETIME     NULL COMMENT '结束时间',
  source       VARCHAR(32)  NOT NULL DEFAULT 'conversation' COMMENT 'conversation|manual',
  raw_text     TEXT         NULL COMMENT '原始对话片段',
  status       VARCHAR(20)  NOT NULL DEFAULT 'pending' COMMENT 'pending|done|cancelled',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_time (user_id, scheduled_at),
  KEY idx_user_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户日程';

-- ---------- student / emotion_record（人脸库与识别记录） ----------
CREATE TABLE IF NOT EXISTS student (
  id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id    VARCHAR(64)  NOT NULL COMMENT '学号（唯一）',
  name          VARCHAR(100) NOT NULL COMMENT '姓名',
  face_feature  LONGTEXT     NULL COMMENT '人脸特征向量（JSON）',
  is_deleted    TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除标记 0/1',
  deleted_at    DATETIME     NULL COMMENT '逻辑删除时间',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_student_id (student_id),
  KEY idx_student_deleted (is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生人脸库';

CREATE TABLE IF NOT EXISTS emotion_record (
  id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id    VARCHAR(64)  NOT NULL COMMENT '学号',
  emotion_type  VARCHAR(64)  NOT NULL COMMENT '情绪标签',
  intensity     DECIMAL(5,2) NOT NULL COMMENT '情绪置信度',
  timestamp     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
  is_deleted    TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除标记 0/1',
  deleted_at    DATETIME     NULL COMMENT '逻辑删除时间',
  KEY idx_record_student_time (student_id, timestamp),
  KEY idx_record_deleted (is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生情绪识别记录';

SET FOREIGN_KEY_CHECKS = 1;
