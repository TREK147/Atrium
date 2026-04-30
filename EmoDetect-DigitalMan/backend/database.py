"""
MySQL 连接与 users 表管理。
"""
import re
import os
import pymysql
from pymysql.cursors import DictCursor
from typing import Optional
from werkzeug.security import generate_password_hash

from config import (
    MYSQL_HOST,
    MYSQL_PORT,
    MYSQL_DATABASE,
    MYSQL_USER,
    MYSQL_PASSWORD,
)

STUDENT_ID_REGEX = re.compile(r"^20\d{8}$")
DEFAULT_STUDENT_PASSWORD = "123456"


def get_connection():
    """获取 MySQL 连接。"""
    connect_timeout = int(os.environ.get("MYSQL_CONNECT_TIMEOUT", "5"))
    read_timeout = int(os.environ.get("MYSQL_READ_TIMEOUT", "8"))
    write_timeout = int(os.environ.get("MYSQL_WRITE_TIMEOUT", "8"))
    return pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DATABASE,
        charset="utf8mb4",
        cursorclass=DictCursor,
        connect_timeout=connect_timeout,
        read_timeout=read_timeout,
        write_timeout=write_timeout,
    )


def create_users_table():
    """创建 users 表（若不存在）。"""
    sql = """
    CREATE TABLE IF NOT EXISTS users (
      id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
      mail          VARCHAR(255) NOT NULL COMMENT '邮箱',
      username      VARCHAR(100) NOT NULL COMMENT '用户名',
      password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希（加密存储）',
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      UNIQUE KEY uk_mail (mail),
      KEY idx_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def ensure_users_role_column() -> None:
    """确保 users 表存在 role 列并补齐默认值。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) AS c
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'
                """
            )
            exists = int((cur.fetchone() or {}).get("c", 0)) > 0
            if not exists:
                cur.execute(
                    "ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'STUDENT' COMMENT 'ADMIN|COUNSELOR|STUDENT' AFTER username"
                )
            cur.execute("UPDATE users SET role='STUDENT' WHERE role IS NULL OR role=''")
        conn.commit()


def ensure_user_profile_columns() -> None:
    """确保 users 表有个性化字段 preferred_name / onboarding_done。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) AS c
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'preferred_name'
                """
            )
            if int((cur.fetchone() or {}).get("c", 0)) == 0:
                cur.execute(
                    "ALTER TABLE users ADD COLUMN preferred_name VARCHAR(50) NULL COMMENT '用户希望被称呼的名字' AFTER username"
                )
            cur.execute(
                """
                SELECT COUNT(*) AS c
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'onboarding_done'
                """
            )
            if int((cur.fetchone() or {}).get("c", 0)) == 0:
                cur.execute(
                    "ALTER TABLE users ADD COLUMN onboarding_done TINYINT NOT NULL DEFAULT 0 COMMENT '首次欢迎流程是否完成' AFTER role"
                )
        conn.commit()


def get_user_by_mail(mail: str) -> Optional[dict]:
    """按邮箱查询用户。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, mail, username, preferred_name, role, onboarding_done, password_hash FROM users WHERE mail = %s",
                (mail.strip().lower(),),
            )
            return cur.fetchone()


def get_user_by_id(user_id: int) -> Optional[dict]:
    """按 id 查询用户（不含密码）。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, mail, username, preferred_name, role, onboarding_done FROM users WHERE id = %s",
                (user_id,),
            )
            return cur.fetchone()


def create_user(mail: str, username: str, password_hash: str, role: str = "STUDENT") -> int:
    """插入用户，返回 id。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (mail, username, role, password_hash) VALUES (%s, %s, %s, %s)",
                (mail.strip().lower(), username.strip(), (role or "STUDENT").strip().upper(), password_hash),
            )
            conn.commit()
            return cur.lastrowid


def get_user_by_username(username: str) -> Optional[dict]:
    """按用户名（此处用于学号/教师号/管理员账号）查询用户。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, mail, username, preferred_name, role, onboarding_done, password_hash FROM users WHERE username = %s LIMIT 1",
                ((username or "").strip(),),
            )
            return cur.fetchone()


def get_user_by_account(account: str) -> Optional[dict]:
    """按登录账号查询（优先 username，同时兼容历史 mail 登录）。"""
    normalized = (account or "").strip()
    if not normalized:
        return None
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, mail, username, role, password_hash
                   , preferred_name, onboarding_done
                   FROM users
                   WHERE username = %s OR mail = %s
                   ORDER BY id ASC
                   LIMIT 1""",
                (normalized, normalized.lower()),
            )
            return cur.fetchone()


def ensure_default_accounts() -> None:
    """确保默认管理员/辅导员账号存在，便于联调演示。"""
    defaults = [
        ("supermanager@local", "SuperManager", "ADMIN"),
        ("2011800051@local", "2011800051", "COUNSELOR"),
        ("1999800037@local", "1999800037", "COUNSELOR"),
    ]
    password_hash = generate_password_hash("123456", method="pbkdf2:sha256")
    with get_connection() as conn:
        with conn.cursor() as cur:
            for mail, username, role in defaults:
                cur.execute("SELECT id FROM users WHERE username = %s LIMIT 1", (username,))
                row = cur.fetchone()
                if row:
                    cur.execute(
                        "UPDATE users SET mail=%s, role=%s, password_hash=%s WHERE id=%s",
                        (mail, role, password_hash, row["id"]),
                    )
                    continue
                cur.execute(
                    "INSERT INTO users (mail, username, role, password_hash) VALUES (%s, %s, %s, %s)",
                    (mail, username, role, password_hash),
                )
            cur.execute(
                "UPDATE users SET role='STUDENT' WHERE username NOT IN ('SuperManager','2011800051','1999800037')"
            )
        conn.commit()


def update_user_preferred_name(user_id: int, preferred_name: str) -> bool:
    """写入用户偏好称呼并标记 onboarding 完成。"""
    name = (preferred_name or "").strip()[:50]
    if not name:
        return False
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET preferred_name=%s, onboarding_done=1 WHERE id=%s",
                (name, user_id),
            )
            conn.commit()
            return cur.rowcount > 0


def _is_valid_student_id(student_id: str) -> bool:
    return bool(STUDENT_ID_REGEX.fullmatch((student_id or "").strip()))


def _build_student_mail(student_id: str, user_id: Optional[int] = None) -> str:
    # 学生账号标识统一使用学号，前端个人菜单第二行直接展示该字段。
    if user_id is None:
        return f"{student_id}"
    return f"{student_id}_{user_id}"


def ensure_student_accounts() -> int:
    """
    按 student 表预分配账号：
    - 仅处理符合学号格式且未逻辑删除的学生
    - username=学生姓名（无姓名时回退学号）
    - mail=student_id（用于学号登录与前端展示）
    - 默认密码=123456（仅新建账号时设置）
    - role 固定为 STUDENT
    返回本次新增账号数量。
    """
    created_count = 0
    default_password_hash = generate_password_hash(DEFAULT_STUDENT_PASSWORD, method="pbkdf2:sha256")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT student_id, name FROM student WHERE is_deleted = 0")
            rows = cur.fetchall() or []
            for row in rows:
                student_id = (row.get("student_id") or "").strip()
                if not _is_valid_student_id(student_id):
                    continue
                student_name = (row.get("name") or "").strip()[:100] or student_id
                target_mail = _build_student_mail(student_id)
                cur.execute("SELECT id FROM users WHERE mail = %s LIMIT 1", (target_mail,))
                exists_by_mail = cur.fetchone()
                if exists_by_mail:
                    cur.execute(
                        "UPDATE users SET username=%s, role='STUDENT' WHERE id = %s",
                        (student_name, exists_by_mail["id"]),
                    )
                    continue

                cur.execute("SELECT id FROM users WHERE username = %s LIMIT 1", (student_id,))
                exists_legacy = cur.fetchone()
                if exists_legacy:
                    cur.execute(
                        "UPDATE users SET mail=%s, username=%s, role='STUDENT' WHERE id = %s",
                        (target_mail, student_name, exists_legacy["id"]),
                    )
                    continue

                cur.execute(
                    "INSERT INTO users (mail, username, role, password_hash) VALUES (%s, %s, %s, %s)",
                    (target_mail, student_name, "STUDENT", default_password_hash),
                )
                created_count += 1
        conn.commit()
    return created_count


def ensure_student_account_for_student_id(student_id: str, student_name: str = "") -> bool:
    """
    针对单个 student_id 预分配账号（用于 upsert_student 后补齐账号）。
    返回是否新建了账号。
    """
    sid = (student_id or "").strip()
    if not _is_valid_student_id(sid):
        return False

    normalized_name = (student_name or "").strip()[:100] or sid
    target_mail = _build_student_mail(sid)
    default_password_hash = generate_password_hash(DEFAULT_STUDENT_PASSWORD, method="pbkdf2:sha256")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE mail = %s LIMIT 1", (target_mail,))
            exists_by_mail = cur.fetchone()
            if exists_by_mail:
                cur.execute(
                    "UPDATE users SET username=%s, role='STUDENT' WHERE id = %s",
                    (normalized_name, exists_by_mail["id"]),
                )
                conn.commit()
                return False

            cur.execute("SELECT id FROM users WHERE username = %s LIMIT 1", (sid,))
            exists_legacy = cur.fetchone()
            if exists_legacy:
                cur.execute(
                    "UPDATE users SET mail=%s, username=%s, role='STUDENT' WHERE id = %s",
                    (target_mail, normalized_name, exists_legacy["id"]),
                )
                conn.commit()
                return False

            cur.execute(
                "INSERT INTO users (mail, username, role, password_hash) VALUES (%s, %s, %s, %s)",
                (target_mail, normalized_name, "STUDENT", default_password_hash),
            )
        conn.commit()
        return True


def upsert_student_login_profile(student_id: str, student_name: str, password_hash: str) -> int:
    """
    以学号为主键维护学生登录账号（注册时使用）：
    - mail 固定为学号
    - username 固定为学生姓名
    - role 固定为 STUDENT
    - password_hash 使用注册提交的新密码
    返回用户 id。
    """
    sid = (student_id or "").strip()
    name = (student_name or "").strip()[:100] or sid
    if not _is_valid_student_id(sid):
        raise ValueError("invalid student_id")
    if not password_hash:
        raise ValueError("password hash required")
    target_mail = _build_student_mail(sid)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE mail = %s LIMIT 1", (target_mail,))
            by_mail = cur.fetchone()
            if by_mail:
                cur.execute(
                    "UPDATE users SET username=%s, role='STUDENT', password_hash=%s WHERE id=%s",
                    (name, password_hash, by_mail["id"]),
                )
                conn.commit()
                return int(by_mail["id"])

            cur.execute("SELECT id FROM users WHERE username = %s LIMIT 1", (sid,))
            legacy = cur.fetchone()
            if legacy:
                cur.execute(
                    "UPDATE users SET mail=%s, username=%s, role='STUDENT', password_hash=%s WHERE id=%s",
                    (target_mail, name, password_hash, legacy["id"]),
                )
                conn.commit()
                return int(legacy["id"])

            cur.execute(
                "INSERT INTO users (mail, username, role, password_hash) VALUES (%s, %s, %s, %s)",
                (target_mail, name, "STUDENT", password_hash),
            )
            conn.commit()
            return int(cur.lastrowid)


def create_emotion_labels_table():
    """创建 emotion_labels 表（若不存在），与 users.id 对应。"""
    sql = """
    CREATE TABLE IF NOT EXISTS emotion_labels (
      id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
      user_id       INT          NOT NULL COMMENT '用户 id，对应 users.id',
      emotion_label VARCHAR(64)  NOT NULL COMMENT '情绪标签',
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
      KEY idx_user_id (user_id),
      KEY idx_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户情绪标签表'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def add_emotion_label(user_id: int, emotion_label: str) -> int:
    """为该 user_id 添加一条情绪标签记录，返回本条记录 id。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO emotion_labels (user_id, emotion_label) VALUES (%s, %s)",
                (user_id, (emotion_label or "").strip()),
            )
            conn.commit()
            return cur.lastrowid


def get_emotion_labels_by_user(user_id: int, limit: int = 100) -> list:
    """按 user_id 查询该用户的情绪标签列表，按时间倒序。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, user_id, emotion_label, created_at
                   FROM emotion_labels WHERE user_id = %s ORDER BY created_at DESC LIMIT %s""",
                (user_id, max(1, limit)),
            )
            return cur.fetchall()


def get_latest_emotion_label(user_id: int) -> Optional[dict]:
    """取该用户最近一条情绪标签。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, user_id, emotion_label, created_at
                   FROM emotion_labels WHERE user_id = %s ORDER BY created_at DESC LIMIT 1""",
                (user_id,),
            )
            return cur.fetchone()


# ---------- 会话与消息（聊天记录持久化） ----------


def create_conversations_table():
    """创建 conversations 表，与 users.id 对应。"""
    sql = """
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户会话表'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def create_messages_table():
    """创建 messages 表，与 conversations.id 对应。"""
    sql = """
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会话消息表'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def create_conversation(user_id: int, title: str = "新对话") -> int:
    """创建会话，返回 id。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO conversations (user_id, title) VALUES (%s, %s)",
                (user_id, (title or "新对话").strip()[:255]),
            )
            conn.commit()
            return cur.lastrowid


def get_conversations_by_user(user_id: int, limit: int = 200) -> list:
    """按 user_id 查询会话列表，按 updated_at 倒序。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT c.id, c.user_id, c.title, c.last_message AS last_message, c.pinned, c.created_at, c.updated_at,
                          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
                   FROM conversations c
                   WHERE c.user_id = %s
                   ORDER BY c.pinned DESC, c.updated_at DESC
                   LIMIT %s""",
                (user_id, max(1, limit)),
            )
            return cur.fetchall()


def get_conversation_by_id(conv_id: int, user_id: int) -> Optional[dict]:
    """查询单条会话，且需属于该 user_id。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, user_id, title, last_message, pinned, created_at, updated_at FROM conversations WHERE id = %s AND user_id = %s",
                (conv_id, user_id),
            )
            return cur.fetchone()


def update_conversation(conv_id: int, user_id: int, title: Optional[str] = None, pinned: Optional[int] = None, last_message: Optional[str] = None, updated_at=None) -> bool:
    """更新会话（仅允许所属用户）。"""
    updates = []
    args = []
    if title is not None:
        updates.append("title = %s")
        args.append((title or "").strip()[:255])
    if pinned is not None:
        updates.append("pinned = %s")
        args.append(1 if pinned else 0)
    if last_message is not None:
        updates.append("last_message = %s")
        args.append((last_message or "")[:500])
    if not updates:
        return True
    args.extend([conv_id, user_id])
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE conversations SET " + ", ".join(updates) + " WHERE id = %s AND user_id = %s",
                tuple(args),
            )
            conn.commit()
            return cur.rowcount > 0


def delete_conversation(conv_id: int, user_id: int) -> bool:
    """删除会话及其消息（仅允许所属用户）。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM messages WHERE conversation_id = %s", (conv_id,))
            cur.execute("DELETE FROM conversations WHERE id = %s AND user_id = %s", (conv_id, user_id))
            conn.commit()
            return cur.rowcount > 0


def create_message(conversation_id: int, role: str, content: str, msg_type: str = "text", file_url: Optional[str] = None, file_name: Optional[str] = None) -> int:
    """插入一条消息，返回 id。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO messages (conversation_id, role, content, type, file_url, file_name)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (conversation_id, (role or "user").strip(), (content or "").strip(), (msg_type or "text").strip(), file_url, file_name),
            )
            conn.commit()
            return cur.lastrowid


def update_conversation_last_message(conv_id: int, last_message: str) -> None:
    """更新会话的 last_message 与 updated_at（由应用层在写入 message 后调用）。"""
    msg_preview = (last_message or "").strip()[:500]
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE conversations SET last_message = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s", (msg_preview, conv_id))
        conn.commit()


def get_messages_by_conversation(conversation_id: int, limit: int = 500) -> list:
    """按会话 id 查询消息列表，按 created_at 正序。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, conversation_id, role, content, type, file_url, file_name, created_at
                   FROM messages WHERE conversation_id = %s ORDER BY created_at ASC, id ASC LIMIT %s""",
                (conversation_id, max(1, limit)),
            )
            return cur.fetchall()


def get_conversation_owner(conversation_id: int) -> Optional[int]:
    """返回会话所属 user_id，不存在则 None。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT user_id FROM conversations WHERE id = %s", (conversation_id,))
            row = cur.fetchone()
            return row["user_id"] if row else None


def get_messages_for_user_range(user_id: int, start_at: str, end_at: str, limit: int = 3000) -> list:
    """跨会话拉取某用户在时间范围内的消息，按时间正序。start_at/end_at 为 'YYYY-MM-DD HH:MM:SS'。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT m.id, m.conversation_id, m.role, m.content, m.created_at
                   FROM messages m
                   INNER JOIN conversations c ON c.id = m.conversation_id
                   WHERE c.user_id = %s
                     AND m.created_at >= %s AND m.created_at < %s
                   ORDER BY m.created_at ASC
                   LIMIT %s""",
                (user_id, start_at, end_at, max(1, limit)),
            )
            return cur.fetchall() or []


# ---------- 周报情感日记（由对话摘要生成） ----------


def create_weekly_journal_table():
    sql = """
    CREATE TABLE IF NOT EXISTS weekly_journal (
      id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id       INT          NOT NULL COMMENT '用户 id',
      week_start    DATE         NOT NULL COMMENT '该周周一日期',
      mood          VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '心情比喻，如：阴、晴',
      body          TEXT         NOT NULL COMMENT '日记正文',
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_week (user_id, week_start),
      KEY idx_user_updated (user_id, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='周报情感日记'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def upsert_weekly_journal(user_id: int, week_start: str, mood: str, body: str) -> int:
    """week_start: YYYY-MM-DD。存在则更新 mood/body。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO weekly_journal (user_id, week_start, mood, body)
                   VALUES (%s, %s, %s, %s)
                   ON DUPLICATE KEY UPDATE mood = VALUES(mood), body = VALUES(body)""",
                (user_id, week_start[:10], (mood or "").strip()[:64], (body or "").strip()),
            )
            conn.commit()
            cur.execute(
                "SELECT id FROM weekly_journal WHERE user_id = %s AND week_start = %s",
                (user_id, week_start[:10]),
            )
            row = cur.fetchone()
            return int(row["id"]) if row else 0


def list_weekly_journals(user_id: int, limit: int = 24) -> list:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, user_id, week_start, mood, body, created_at, updated_at
                   FROM weekly_journal WHERE user_id = %s
                   ORDER BY week_start DESC LIMIT %s""",
                (user_id, max(1, limit)),
            )
            return cur.fetchall() or []


def get_weekly_journal_by_week(user_id: int, week_start: str) -> Optional[dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, user_id, week_start, mood, body, created_at, updated_at
                   FROM weekly_journal WHERE user_id = %s AND week_start = %s LIMIT 1""",
                (user_id, week_start[:10]),
            )
            return cur.fetchone()


# ---------- 情绪异常记录（存原因，供模型检索与对症疏导） ----------


def create_emotion_anomalies_table():
    """情绪异常表：对话/监控发现异常时写入。from_monitoring 0=聊天 1=监控；聊天时可存 reason。"""
    sql = """
    CREATE TABLE IF NOT EXISTS emotion_anomalies (
      id             INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id        INT          NOT NULL,
      emotion_label  VARCHAR(64)  NOT NULL COMMENT '情绪标签',
      reason         TEXT         NULL COMMENT '具体原因（来自聊天时填写，来自监控可空）',
      from_monitoring TINYINT     NOT NULL DEFAULT 0 COMMENT '0=聊天 1=监控',
      created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='情绪异常记录'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def _ensure_from_monitoring_column():
    """已有表补加 from_monitoring 列（兼容旧库）；若有 source 列则按 source 回填。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT COUNT(*) AS n FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'emotion_anomalies' AND COLUMN_NAME = 'from_monitoring'"""
            )
            if cur.fetchone()["n"] == 0:
                cur.execute(
                    "ALTER TABLE emotion_anomalies ADD COLUMN from_monitoring TINYINT NOT NULL DEFAULT 0 COMMENT '0=聊天 1=监控' AFTER reason"
                )
                try:
                    cur.execute("UPDATE emotion_anomalies SET from_monitoring = 1 WHERE source = 'monitoring'")
                except Exception:
                    pass
        conn.commit()


def add_emotion_anomaly(user_id: int, emotion_label: str, reason: str = "", from_monitoring: int = 0) -> int:
    """写入一条情绪异常。from_monitoring: 0=聊天（可填 reason），1=监控。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO emotion_anomalies (user_id, emotion_label, reason, from_monitoring)
                   VALUES (%s, %s, %s, %s)""",
                (user_id, (emotion_label or "").strip()[:64], (reason or "").strip()[:2000] or None, 1 if from_monitoring else 0),
            )
            conn.commit()
            return cur.lastrowid


def get_emotion_anomalies_by_user(user_id: int, limit: int = 100, since_days: Optional[int] = None) -> list:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if since_days is not None and since_days > 0:
                cur.execute(
                    """SELECT id, user_id, emotion_label, reason, from_monitoring, created_at
                       FROM emotion_anomalies WHERE user_id = %s AND created_at >= DATE_SUB(NOW(), INTERVAL %s DAY)
                       ORDER BY created_at DESC LIMIT %s""",
                    (user_id, since_days, max(1, limit)),
                )
            else:
                cur.execute(
                    """SELECT id, user_id, emotion_label, reason, from_monitoring, created_at
                       FROM emotion_anomalies WHERE user_id = %s ORDER BY created_at DESC LIMIT %s""",
                    (user_id, max(1, limit)),
                )
            return cur.fetchall()


def count_recent_anomalies(user_id: int, days: int = 7) -> int:
    """最近 N 天内异常次数，用于触发「多次异常则主动疏导」。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT COUNT(*) AS n FROM emotion_anomalies
                   WHERE user_id = %s AND created_at >= DATE_SUB(NOW(), INTERVAL %s DAY)""",
                (user_id, max(1, days)),
            )
            row = cur.fetchone()
            return int(row["n"]) if row else 0


def count_recent_face_abnormal_records(student_id: str, days: int = 7, abnormal_labels: Optional[list] = None) -> int:
    """统计某学号最近 N 天内的人脸异常情绪记录数量（emotion_record）。"""
    sid = (student_id or "").strip()
    if not sid:
        return 0
    labels = [str(x).strip().lower() for x in (abnormal_labels or []) if str(x).strip()]
    if not labels:
        labels = ["anger", "contempt", "disgust", "fear", "sadness"]
    placeholders = ",".join(["%s"] * len(labels))
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""SELECT COUNT(*) AS n
                    FROM emotion_record
                    WHERE student_id = %s
                      AND is_deleted = 0
                      AND timestamp >= DATE_SUB(NOW(), INTERVAL %s DAY)
                      AND LOWER(emotion_type) IN ({placeholders})""",
                tuple([sid, max(1, days)] + labels),
            )
            row = cur.fetchone()
            return int(row["n"]) if row else 0


# ---------- 主动疏导触发（监控/多次异常后由数字人主动发起） ----------


def create_proactive_triggers_table():
    sql = """
    CREATE TABLE IF NOT EXISTS proactive_triggers (
      id             INT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id        INT      NOT NULL,
      trigger_type   VARCHAR(32) NOT NULL DEFAULT 'monitoring' COMMENT 'monitoring|repeated_anomaly',
      acknowledged_at DATETIME NULL COMMENT '用户已响应时间',
      created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_pending (user_id, acknowledged_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='主动疏导触发记录'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def create_proactive_trigger(user_id: int, trigger_type: str = "monitoring") -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO proactive_triggers (user_id, trigger_type) VALUES (%s, %s)",
                (user_id, (trigger_type or "monitoring")[:32]),
            )
            conn.commit()
            return cur.lastrowid


def get_pending_proactive_trigger(user_id: int) -> Optional[dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, user_id, trigger_type, created_at FROM proactive_triggers
                   WHERE user_id = %s AND acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 1""",
                (user_id,),
            )
            return cur.fetchone()


def acknowledge_proactive_trigger(trigger_id: int, user_id: int) -> bool:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE proactive_triggers SET acknowledged_at = CURRENT_TIMESTAMP WHERE id = %s AND user_id = %s",
                (trigger_id, user_id),
            )
            conn.commit()
            return cur.rowcount > 0


def get_emotion_stats_by_user(user_id: int, days: int = 30) -> list:
    """按日聚合情绪异常数量，供情感曲线。返回 [{"date": "YYYY-MM-DD", "count": n}, ...]。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT DATE(created_at) AS date, COUNT(*) AS count
                   FROM emotion_anomalies WHERE user_id = %s AND created_at >= DATE_SUB(CURDATE(), INTERVAL %s DAY)
                   GROUP BY DATE(created_at) ORDER BY date ASC""",
                (user_id, max(1, days)),
            )
            rows = cur.fetchall()
    return [{"date": (r["date"].isoformat() if hasattr(r["date"], "isoformat") else str(r["date"])), "count": r["count"]} for r in rows]


# ---------- 用户日程（从对话提取或手动添加） ----------


def create_user_schedules_table():
    sql = """
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户日程'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def create_students_table():
    """创建学生表（用于人脸库），支持逻辑删除。"""
    sql = """
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生人脸库'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def create_emotion_records_table():
    """创建识别记录表，支持逻辑删除。"""
    sql = """
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生情绪识别记录'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def _ensure_soft_delete_columns(table_name: str):
    """兼容旧表：补齐 is_deleted / deleted_at 字段。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT COUNT(*) AS n FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = 'is_deleted'""",
                (table_name,),
            )
            if cur.fetchone()["n"] == 0:
                cur.execute(
                    f"ALTER TABLE {table_name} ADD COLUMN is_deleted TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标记 0/1'"
                )
            cur.execute(
                """SELECT COUNT(*) AS n FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = 'deleted_at'""",
                (table_name,),
            )
            if cur.fetchone()["n"] == 0:
                cur.execute(
                    f"ALTER TABLE {table_name} ADD COLUMN deleted_at DATETIME NULL COMMENT '逻辑删除时间'"
                )
        conn.commit()


def upsert_student(student_id: str, name: str, face_feature_json: Optional[str] = None) -> None:
    """新增或更新学生（若已逻辑删除会恢复）。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            if face_feature_json is None:
                cur.execute(
                    """INSERT INTO student (student_id, name, is_deleted, deleted_at)
                       VALUES (%s, %s, 0, NULL)
                       ON DUPLICATE KEY UPDATE
                       name = VALUES(name),
                       is_deleted = 0,
                       deleted_at = NULL""",
                    ((student_id or "").strip(), (name or "").strip()[:100]),
                )
            else:
                cur.execute(
                    """INSERT INTO student (student_id, name, face_feature, is_deleted, deleted_at)
                       VALUES (%s, %s, %s, 0, NULL)
                       ON DUPLICATE KEY UPDATE
                       name = VALUES(name),
                       face_feature = VALUES(face_feature),
                       is_deleted = 0,
                       deleted_at = NULL""",
                    ((student_id or "").strip(), (name or "").strip()[:100], face_feature_json),
                )
        conn.commit()
    ensure_student_account_for_student_id(student_id, name)


def list_students(include_deleted: bool = False, limit: int = 200) -> list:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if include_deleted:
                cur.execute(
                    """SELECT id, student_id, name, face_feature, is_deleted, deleted_at, created_at, updated_at
                       FROM student ORDER BY updated_at DESC LIMIT %s""",
                    (max(1, limit),),
                )
            else:
                cur.execute(
                    """SELECT id, student_id, name, face_feature, is_deleted, deleted_at, created_at, updated_at
                       FROM student WHERE is_deleted = 0 ORDER BY updated_at DESC LIMIT %s""",
                    (max(1, limit),),
                )
            return cur.fetchall()


def get_student_by_student_id(student_id: str, include_deleted: bool = False) -> Optional[dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if include_deleted:
                cur.execute(
                    """SELECT id, student_id, name, face_feature, is_deleted, deleted_at, created_at, updated_at
                       FROM student WHERE student_id = %s LIMIT 1""",
                    ((student_id or "").strip(),),
                )
            else:
                cur.execute(
                    """SELECT id, student_id, name, face_feature, is_deleted, deleted_at, created_at, updated_at
                       FROM student WHERE student_id = %s AND is_deleted = 0 LIMIT 1""",
                    ((student_id or "").strip(),),
                )
            return cur.fetchone()


def soft_delete_student(student_id: str) -> bool:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE student
                   SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP
                   WHERE student_id = %s AND is_deleted = 0""",
                ((student_id or "").strip(),),
            )
            conn.commit()
            return cur.rowcount > 0


def update_student(student_id: str, name: Optional[str] = None) -> bool:
    updates = []
    args = []
    if name is not None:
        updates.append("name = %s")
        args.append((name or "").strip()[:100])
    if not updates:
        return True
    args.extend([(student_id or "").strip()])
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE student SET " + ", ".join(updates) + " WHERE student_id = %s AND is_deleted = 0",
                tuple(args),
            )
            updated_rows = cur.rowcount
            if updated_rows > 0 and name is not None:
                normalized_name = (name or "").strip()[:100]
                if normalized_name:
                    cur.execute(
                        "UPDATE users SET username=%s WHERE mail=%s AND role='STUDENT'",
                        (normalized_name, (student_id or "").strip()),
                    )
            conn.commit()
            return updated_rows > 0


def load_face_database() -> dict:
    """返回 { student_id: np.array(feature) } 的原始 JSON 结构数据。"""
    rows = list_students(include_deleted=False, limit=5000)
    out = {}
    for row in rows:
        feature = row.get("face_feature")
        if feature:
            out[row["student_id"]] = feature
    return out


def add_emotion_record(student_id: str, emotion_type: str, intensity: float) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO emotion_record (student_id, emotion_type, intensity)
                   VALUES (%s, %s, %s)""",
                ((student_id or "").strip(), (emotion_type or "").strip()[:64], float(intensity)),
            )
            conn.commit()
            return cur.lastrowid


def list_emotion_records(student_id: Optional[str] = None, limit: int = 200) -> list:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if student_id:
                cur.execute(
                    """SELECT id, student_id, emotion_type, intensity, timestamp, is_deleted, deleted_at
                       FROM emotion_record
                       WHERE is_deleted = 0 AND student_id = %s
                       ORDER BY timestamp DESC LIMIT %s""",
                    ((student_id or "").strip(), max(1, limit)),
                )
            else:
                cur.execute(
                    """SELECT id, student_id, emotion_type, intensity, timestamp, is_deleted, deleted_at
                       FROM emotion_record
                       WHERE is_deleted = 0
                       ORDER BY timestamp DESC LIMIT %s""",
                    (max(1, limit),),
                )
            return cur.fetchall()


def soft_delete_emotion_record(record_id: int) -> bool:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE emotion_record
                   SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP
                   WHERE id = %s AND is_deleted = 0""",
                (record_id,),
            )
            conn.commit()
            return cur.rowcount > 0


def create_schedule(user_id: int, title: str, scheduled_at: str, end_at: Optional[str] = None, source: str = "conversation", raw_text: Optional[str] = None) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO user_schedules (user_id, title, scheduled_at, end_at, source, raw_text)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (user_id, (title or "").strip()[:500], scheduled_at, end_at, (source or "conversation")[:32], (raw_text or "")[:2000]),
            )
            conn.commit()
            return cur.lastrowid


def get_schedules_by_user(user_id: int, start_date: Optional[str] = None, end_date: Optional[str] = None, limit: int = 200) -> list:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if start_date and end_date:
                cur.execute(
                    """SELECT id, user_id, title, scheduled_at, end_at, source, raw_text, status, created_at
                       FROM user_schedules WHERE user_id = %s AND status = 'pending'
                       AND scheduled_at >= %s AND scheduled_at <= %s
                       ORDER BY scheduled_at ASC LIMIT %s""",
                    (user_id, start_date, end_date, max(1, limit)),
                )
            else:
                cur.execute(
                    """SELECT id, user_id, title, scheduled_at, end_at, source, raw_text, status, created_at
                       FROM user_schedules WHERE user_id = %s ORDER BY scheduled_at DESC LIMIT %s""",
                    (user_id, max(1, limit)),
                )
            return cur.fetchall()


def get_schedule_by_id(schedule_id: int, user_id: int) -> Optional[dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, user_id, title, scheduled_at, end_at, source, raw_text, status, created_at FROM user_schedules WHERE id = %s AND user_id = %s",
                (schedule_id, user_id),
            )
            return cur.fetchone()


def update_schedule(schedule_id: int, user_id: int, title: Optional[str] = None, scheduled_at: Optional[str] = None, end_at: Optional[str] = None, status: Optional[str] = None) -> bool:
    updates, args = [], []
    if title is not None:
        updates.append("title = %s")
        args.append((title or "").strip()[:500])
    if scheduled_at is not None:
        updates.append("scheduled_at = %s")
        args.append(scheduled_at)
    if end_at is not None:
        updates.append("end_at = %s")
        args.append(end_at)
    if status is not None:
        updates.append("status = %s")
        args.append((status or "pending")[:20])
    if not updates:
        return True
    args.extend([schedule_id, user_id])
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE user_schedules SET " + ", ".join(updates) + " WHERE id = %s AND user_id = %s", tuple(args))
            conn.commit()
            return cur.rowcount > 0


def delete_schedule(schedule_id: int, user_id: int) -> bool:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM user_schedules WHERE id = %s AND user_id = %s", (schedule_id, user_id))
            conn.commit()
            return cur.rowcount > 0


def create_user_feedback_table():
    """用户反馈表：聊天端「发送反馈」写入，管理端读取。"""
    sql = """
    CREATE TABLE IF NOT EXISTS user_feedback (
      id              INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id         INT          NOT NULL COMMENT '用户 id',
      username        VARCHAR(100) NOT NULL DEFAULT '' COMMENT '用户名快照',
      email           VARCHAR(255) NOT NULL DEFAULT '' COMMENT '邮箱快照',
      content         TEXT         NOT NULL COMMENT '反馈内容',
      screenshot_url  VARCHAR(500) NULL COMMENT '截图 URL（可空）',
      allow_contact   TINYINT      NOT NULL DEFAULT 0 COMMENT '是否允许联系',
      created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_created (user_id, created_at),
      KEY idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户反馈'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def create_user_memory_vectors_table():
    """长期记忆（向量）表：存储聊天摘要、偏好、习惯、情绪线索等。"""
    sql = """
    CREATE TABLE IF NOT EXISTS user_memory_vectors (
      id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id        INT          NOT NULL,
      memory_type    VARCHAR(32)  NOT NULL DEFAULT 'chat' COMMENT 'chat|preference|habit|emotion|task',
      content        TEXT         NOT NULL,
      vector_json    LONGTEXT     NOT NULL COMMENT '向量数组 JSON',
      metadata_json  LONGTEXT     NULL COMMENT '附加信息 JSON',
      created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_type_time (user_id, memory_type, created_at),
      KEY idx_user_time (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户长期记忆向量表'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def add_user_memory_vector(
    user_id: int,
    memory_type: str,
    content: str,
    vector_json: str,
    metadata_json: Optional[str] = None,
) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO user_memory_vectors (user_id, memory_type, content, vector_json, metadata_json)
                   VALUES (%s, %s, %s, %s, %s)""",
                (
                    user_id,
                    (memory_type or "chat").strip()[:32],
                    (content or "").strip()[:5000],
                    (vector_json or "").strip()[:200000],
                    (metadata_json or "").strip()[:200000] or None,
                ),
            )
            conn.commit()
            return cur.lastrowid


def list_user_memory_vectors(user_id: int, memory_type: Optional[str] = None, limit: int = 300) -> list:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if memory_type:
                cur.execute(
                    """SELECT id, user_id, memory_type, content, vector_json, metadata_json, created_at
                       FROM user_memory_vectors
                       WHERE user_id = %s AND memory_type = %s
                       ORDER BY created_at DESC LIMIT %s""",
                    (user_id, memory_type[:32], max(1, limit)),
                )
            else:
                cur.execute(
                    """SELECT id, user_id, memory_type, content, vector_json, metadata_json, created_at
                       FROM user_memory_vectors
                       WHERE user_id = %s
                       ORDER BY created_at DESC LIMIT %s""",
                    (user_id, max(1, limit)),
                )
            return cur.fetchall() or []


def create_task_interruption_records_table():
    """任务打断与恢复记录表。"""
    sql = """
    CREATE TABLE IF NOT EXISTS task_interruption_records (
      id                BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id           INT          NOT NULL,
      conversation_id   INT          NULL COMMENT '对应会话，可空',
      title             VARCHAR(500) NOT NULL COMMENT '任务标题',
      progress_note     TEXT         NULL COMMENT '当前进度摘要',
      resume_hint       TEXT         NULL COMMENT '恢复建议',
      status            VARCHAR(20)  NOT NULL DEFAULT 'interrupted' COMMENT 'interrupted|resumed|closed',
      interrupted_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resumed_at        DATETIME     NULL,
      created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_user_status_time (user_id, status, interrupted_at),
      KEY idx_user_updated (user_id, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务打断恢复记录'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def create_task_interruption_record(
    user_id: int,
    title: str,
    progress_note: str = "",
    resume_hint: str = "",
    conversation_id: Optional[int] = None,
) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO task_interruption_records
                   (user_id, conversation_id, title, progress_note, resume_hint, status)
                   VALUES (%s, %s, %s, %s, %s, 'interrupted')""",
                (
                    user_id,
                    conversation_id,
                    (title or "").strip()[:500],
                    (progress_note or "").strip()[:4000] or None,
                    (resume_hint or "").strip()[:4000] or None,
                ),
            )
            conn.commit()
            return cur.lastrowid


def resume_task_interruption_record(record_id: int, user_id: int, resume_note: str = "") -> bool:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE task_interruption_records
                   SET status = 'resumed',
                       resumed_at = CURRENT_TIMESTAMP,
                       resume_hint = COALESCE(NULLIF(%s, ''), resume_hint)
                   WHERE id = %s AND user_id = %s AND status = 'interrupted'""",
                ((resume_note or "").strip()[:4000], record_id, user_id),
            )
            conn.commit()
            return cur.rowcount > 0


def get_latest_interrupted_task(user_id: int) -> Optional[dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, user_id, conversation_id, title, progress_note, resume_hint, status,
                          interrupted_at, resumed_at, created_at, updated_at
                   FROM task_interruption_records
                   WHERE user_id = %s AND status = 'interrupted'
                   ORDER BY interrupted_at DESC LIMIT 1""",
                (user_id,),
            )
            return cur.fetchone()


def add_user_feedback(
    user_id: int,
    username: str,
    email: str,
    content: str,
    screenshot_url: Optional[str] = None,
    allow_contact: int = 0,
) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO user_feedback (user_id, username, email, content, screenshot_url, allow_contact)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (
                    user_id,
                    (username or "").strip()[:100],
                    (email or "").strip()[:255],
                    (content or "").strip()[:4000],
                    ((screenshot_url or "").strip()[:500] or None),
                    1 if allow_contact else 0,
                ),
            )
            conn.commit()
            return cur.lastrowid


def list_user_feedback(limit: int = 200) -> list:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, user_id, username, email, content, screenshot_url, allow_contact, created_at
                   FROM user_feedback
                   ORDER BY created_at DESC
                   LIMIT %s""",
                (max(1, min(int(limit or 200), 1000)),),
            )
            return cur.fetchall()


def init_db():
    """初始化数据库（创建表等）。"""
    create_users_table()
    ensure_users_role_column()
    ensure_user_profile_columns()
    create_emotion_labels_table()
    create_conversations_table()
    create_messages_table()
    create_weekly_journal_table()
    create_emotion_anomalies_table()
    _ensure_from_monitoring_column()
    create_proactive_triggers_table()
    create_user_schedules_table()
    create_students_table()
    create_emotion_records_table()
    create_user_feedback_table()
    create_user_memory_vectors_table()
    create_task_interruption_records_table()
    _ensure_soft_delete_columns("student")
    _ensure_soft_delete_columns("emotion_record")
    ensure_default_accounts()
    ensure_student_accounts()


if __name__ == "__main__":
    init_db()
    print("users、emotion_labels、conversations、messages、emotion_anomalies、proactive_triggers、user_schedules 已创建或已存在。")
