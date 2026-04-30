-- 旧版 student/emotion_record 迁移到当前后端代码兼容结构
-- 适用场景：你已有本地旧库数据，准备迁移到云库。
-- 执行前请先备份：
--   mysqldump -u <user> -p <db_name> > backup_before_migration.sql

START TRANSACTION;

-- 1) 备份旧表（保险）
CREATE TABLE IF NOT EXISTS student_backup AS SELECT * FROM student;
CREATE TABLE IF NOT EXISTS emotion_record_backup AS SELECT * FROM emotion_record;

-- 2) 新建 student_v2（对齐 backend/database.py）
CREATE TABLE IF NOT EXISTS student_v2 (
  id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id    VARCHAR(64)  NOT NULL COMMENT '学号（唯一）',
  name          VARCHAR(100) NOT NULL COMMENT '姓名',
  face_feature  LONGTEXT     NULL COMMENT '人脸特征向量（JSON字符串）',
  is_deleted    TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除标记 0/1',
  deleted_at    DATETIME     NULL COMMENT '逻辑删除时间',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_student_id (student_id),
  KEY idx_student_deleted (is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) 迁移 student 数据
INSERT INTO student_v2 (student_id, name, face_feature, is_deleted, deleted_at, created_at, updated_at)
SELECT
  CAST(student_id AS CHAR(64)),
  LEFT(name, 100),
  CASE
    WHEN face_feature IS NULL THEN NULL
    ELSE CAST(face_feature AS CHAR)
  END,
  0,
  NULL,
  COALESCE(created_at, CURRENT_TIMESTAMP),
  COALESCE(created_at, CURRENT_TIMESTAMP)
FROM student;

-- 4) 新建 emotion_record_v2（对齐 backend/database.py，并保留旧扩展字段）
CREATE TABLE IF NOT EXISTS emotion_record_v2 (
  id              BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id      VARCHAR(64)  NOT NULL COMMENT '学号',
  emotion_type    VARCHAR(64)  NOT NULL COMMENT '情绪标签',
  intensity       DECIMAL(5,2) NOT NULL COMMENT '情绪置信度',
  timestamp       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
  is_deleted      TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除标记 0/1',
  deleted_at      DATETIME     NULL COMMENT '逻辑删除时间',
  video_frame     VARCHAR(255) NULL COMMENT '视频帧路径',
  face_confidence FLOAT        NULL COMMENT '人脸识别置信度',
  source          VARCHAR(50)  NULL DEFAULT 'camera',
  KEY idx_record_student_time (student_id, timestamp),
  KEY idx_record_deleted (is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5) 迁移 emotion_record 数据
INSERT INTO emotion_record_v2 (
  student_id, emotion_type, intensity, timestamp,
  is_deleted, deleted_at, video_frame, face_confidence, source
)
SELECT
  CAST(student_id AS CHAR(64)),
  LEFT(emotion_type, 64),
  ROUND(COALESCE(intensity, 0), 2),
  COALESCE(timestamp, CURRENT_TIMESTAMP),
  0,
  NULL,
  video_frame,
  face_confidence,
  COALESCE(source, 'camera')
FROM emotion_record;

-- 6) 原子替换旧表
RENAME TABLE student TO student_old, student_v2 TO student;
RENAME TABLE emotion_record TO emotion_record_old, emotion_record_v2 TO emotion_record;

COMMIT;

-- 7) 迁移后校验（可手动执行）
-- SELECT (SELECT COUNT(*) FROM student_old) AS old_student_cnt, (SELECT COUNT(*) FROM student) AS new_student_cnt;
-- SELECT (SELECT COUNT(*) FROM emotion_record_old) AS old_record_cnt, (SELECT COUNT(*) FROM emotion_record) AS new_record_cnt;
