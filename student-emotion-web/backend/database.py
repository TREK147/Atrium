"""
学生情绪管理系统 — MySQL 表结构与数据访问。
表名前缀 sem_，可与同库中 EmoDetect 的 users 等表共存。
"""
import datetime as dt
import json
import os
import re
import time
import uuid
from typing import Any, Dict, List, Optional, Set, Tuple

import pymysql
from pymysql.cursors import DictCursor

from config import (
    MYSQL_CONNECT_TIMEOUT,
    MYSQL_DATABASE,
    MYSQL_HOST,
    MYSQL_PASSWORD,
    MYSQL_PORT,
    MYSQL_READ_TIMEOUT,
    MYSQL_USER,
    MYSQL_WRITE_TIMEOUT,
)

DEFAULT_SIM_COLLEGE_ID = ""
DEFAULT_SIM_COLLEGE_NAME = "软件学院"
DEFAULT_SIM_GRADE = "2024"
DEFAULT_SIM_MAJOR = "软件工程"

# 与角色/范围配置页一致：用于在 scope_json 未落库时从「XX学院管理员」角色名称推断学院
SEM_COLLEGE_PAIRS: Tuple[Tuple[str, str], ...] = (
    ("C021", "软件学院"),
    ("C005", "计算机学院"),
    ("C030", "经济学院"),
)

# 与 EmoDetect users.mail（学号或 学号_userId）一致
_STUDENT_NO_IN_MAIL = re.compile(r"^(?P<sid>20\d{8})(?:_\d+)?$")


def get_connection():
    return pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DATABASE,
        charset="utf8mb4",
        cursorclass=DictCursor,
        connect_timeout=MYSQL_CONNECT_TIMEOUT,
        read_timeout=MYSQL_READ_TIMEOUT,
        write_timeout=MYSQL_WRITE_TIMEOUT,
    )


def _exec(sql: str, args: tuple = ()) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, args)
        conn.commit()


def _fetchone(sql: str, args: tuple = ()) -> Optional[dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            return cur.fetchone()


def _fetchall(sql: str, args: tuple = ()) -> list:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            return cur.fetchall()


def _table_exists(table_name: str) -> bool:
    row = _fetchone(
        """SELECT COUNT(*) AS n FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s""",
        (MYSQL_DATABASE, table_name),
    )
    return bool(row and int(row.get("n", 0)) > 0)


def _safe_fetchall(sql: str, args: tuple = (), fallback: Optional[list] = None) -> list:
    try:
        return _fetchall(sql, args)
    except Exception:
        return [] if fallback is None else fallback


def _safe_fetchone(sql: str, args: tuple = ()) -> Optional[dict]:
    try:
        return _fetchone(sql, args)
    except Exception:
        return None


def _to_ts_ms(value: Any) -> int:
    if value is None:
        return int(time.time() * 1000)
    if isinstance(value, (int, float)):
        n = int(value)
        return n if n > 10_000_000_000 else n * 1000
    if hasattr(value, "timestamp"):
        try:
            return int(value.timestamp() * 1000)
        except Exception:
            return int(time.time() * 1000)
    return int(time.time() * 1000)


def _clamp_score(score: float) -> int:
    return max(0, min(100, int(round(score))))


def _score_from_intensity(intensity: Any) -> int:
    try:
        val = float(intensity)
    except (TypeError, ValueError):
        return 50
    if val <= 1:
        return _clamp_score(val * 100)
    return _clamp_score(val)


def _mood_from_emotion_label(label: Any) -> str:
    text = str(label or "").strip().lower()
    if not text:
        return "中性"
    positive = {
        "happy",
        "happiness",
        "surprise",
        "excited",
        "positive",
        "joy",
        "高兴",
        "开心",
        "愉快",
        "惊喜",
    }
    negative = {
        "sad",
        "sadness",
        "angry",
        "anger",
        "fear",
        "disgust",
        "negative",
        "depressed",
        "悲伤",
        "难过",
        "焦虑",
        "生气",
        "愤怒",
        "恐惧",
    }
    if text in positive:
        return "积极"
    if text in negative:
        return "消极"
    return "中性"


def init_schema() -> None:
    stmts = [
        """
        CREATE TABLE IF NOT EXISTS sem_staff (
          id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          staff_no VARCHAR(32) NOT NULL COMMENT '工号',
          name VARCHAR(100) NOT NULL,
          password_hash VARCHAR(64) NOT NULL,
          password_salt VARCHAR(64) NOT NULL,
          role VARCHAR(20) NOT NULL COMMENT 'ADMIN|COUNSELOR',
          role_name VARCHAR(100) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE|FROZEN|DISABLED|LOCKED',
          failed_login_count INT NOT NULL DEFAULT 0,
          locked_until_ms BIGINT NULL,
          last_login_ms BIGINT NULL,
          scope_json TEXT NULL COMMENT '辅导员数据范围 JSON',
          created_at_ms BIGINT NOT NULL,
          UNIQUE KEY uk_staff_no (staff_no),
          KEY idx_role (role)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS sem_student (
          student_no VARCHAR(32) NOT NULL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          college_id VARCHAR(32) NOT NULL,
          college_name VARCHAR(100) NOT NULL,
          grade VARCHAR(20) NOT NULL,
          major VARCHAR(100) NOT NULL,
          class_id VARCHAR(32) NOT NULL,
          class_name VARCHAR(100) NOT NULL,
          phone VARCHAR(32) NOT NULL,
          id_card_no VARCHAR(32) NOT NULL,
          KEY idx_college_grade (college_id, grade, major, class_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS sem_emotion_point (
          id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          student_no VARCHAR(32) NOT NULL,
          ts_ms BIGINT NOT NULL,
          score INT NOT NULL,
          mood VARCHAR(10) NOT NULL COMMENT '积极|中性|消极',
          source VARCHAR(32) NOT NULL,
          KEY idx_student_ts (student_no, ts_ms)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS sem_report (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          student_no VARCHAR(32) NOT NULL,
          created_at_ms BIGINT NOT NULL,
          summary TEXT NOT NULL,
          risk_level VARCHAR(10) NOT NULL,
          tags_json TEXT NOT NULL,
          modality_json TEXT NOT NULL,
          report_kind VARCHAR(16) NOT NULL DEFAULT 'legacy' COMMENT 'legacy|daily|hourly',
          period_start_ms BIGINT NULL,
          period_end_ms BIGINT NULL,
          KEY idx_student (student_no),
          KEY idx_student_kind_period (student_no, report_kind, period_start_ms)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS sem_alert (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          student_no VARCHAR(32) NOT NULL,
          student_name VARCHAR(100) NOT NULL,
          created_at_ms BIGINT NOT NULL,
          level VARCHAR(10) NOT NULL,
          reason TEXT NOT NULL,
          assigned_counselor_staff_no VARCHAR(32) NOT NULL,
          status VARCHAR(20) NOT NULL COMMENT 'NEW|FOLLOWED|CLEARED',
          note TEXT NULL,
          updated_at_ms BIGINT NULL,
          KEY idx_assignee (assigned_counselor_staff_no, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS sem_threshold (
          id INT NOT NULL PRIMARY KEY DEFAULT 1,
          sensitivity INT NOT NULL DEFAULT 70,
          level_rules_json TEXT NOT NULL,
          updated_at_ms BIGINT NOT NULL,
          updated_by_staff_no VARCHAR(32) NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS sem_audit_log (
          id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          action VARCHAR(64) NOT NULL,
          actor_staff_no VARCHAR(32) NULL,
          actor_name VARCHAR(100) NULL,
          target_student_no VARCHAR(32) NULL,
          target_staff_no VARCHAR(32) NULL,
          detail TEXT NOT NULL,
          ts_ms BIGINT NOT NULL,
          ip VARCHAR(64) NOT NULL,
          device VARCHAR(500) NOT NULL,
          KEY idx_ts (ts_ms),
          KEY idx_actor (actor_staff_no, ts_ms)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS sem_user_feedback (
          id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          staff_id INT NOT NULL COMMENT 'sem_staff.id',
          staff_no VARCHAR(32) NOT NULL COMMENT '工号快照',
          display_name VARCHAR(100) NOT NULL COMMENT '姓名快照',
          contact_email VARCHAR(255) NOT NULL DEFAULT '' COMMENT '用户填写的联系邮箱（可空）',
          content TEXT NOT NULL,
          screenshot_url VARCHAR(500) NULL,
          allow_contact TINYINT NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY idx_created (created_at),
          KEY idx_staff (staff_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='意见反馈（教师端提交，管理端查看）'
        """,
    ]
    for sql in stmts:
        _exec(sql)


def seed_demo_data() -> None:
    """若 sem_staff 为空则写入示例数据（仅供本地演示调试）。"""
    row = _fetchone("SELECT COUNT(*) AS c FROM sem_staff", ())
    if row and int(row["c"]) > 0:
        return

    import hashlib

    def md5_pw(plain: str, salt: str) -> str:
        return hashlib.md5(f"{salt}:{plain}".encode("utf-8")).hexdigest()

    now = int(time.time() * 1000)
    salt_a = "a1b2c3d4e5f6789012345678ab"
    salt_t1 = "b2c3d4e5f67890123456789abc"
    salt_t2 = "c3d4e5f67890123456789abcd"

    staff_rows = [
        (
            "SuperManager",
            "SuperManager",
            md5_pw("123456", salt_a),
            salt_a,
            "ADMIN",
            "管理员",
            "ACTIVE",
            0,
            None,
            None,
            None,
            now,
        ),
        (
            "2011800051",
            "孙晓",
            md5_pw("123456", salt_t1),
            salt_t1,
            "COUNSELOR",
            "信息工程学院教师",
            "ACTIVE",
            0,
            None,
            None,
            json.dumps(
                {
                    "collegeId": "C01",
                    "collegeName": "信息工程学院",
                    "grade": "2024",
                    "major": "软件工程",
                    "classIds": ["CL2401", "CL2402"],
                },
                ensure_ascii=False,
            ),
            now,
        ),
        (
            "1999800037",
            "徐本柱",
            md5_pw("123456", salt_t2),
            salt_t2,
            "COUNSELOR",
            "管理学院教师",
            "ACTIVE",
            0,
            None,
            None,
            json.dumps(
                {
                    "collegeId": "C02",
                    "collegeName": "管理学院",
                    "grade": "2023",
                    "major": "工商管理",
                    "classIds": ["CL2301"],
                },
                ensure_ascii=False,
            ),
            now,
        ),
    ]

    with get_connection() as conn:
        with conn.cursor() as cur:
            for s in staff_rows:
                cur.execute(
                    """INSERT INTO sem_staff
                    (staff_no, name, password_hash, password_salt, role, role_name, status,
                     failed_login_count, locked_until_ms, last_login_ms, scope_json, created_at_ms)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    s,
                )

            students = [
                (
                    "20240001",
                    "李雷",
                    "C01",
                    "信息工程学院",
                    "2024",
                    "软件工程",
                    "CL2401",
                    "软工2401班",
                    "13912346705",
                    "320101200601019999",
                ),
                (
                    "20240002",
                    "韩梅梅",
                    "C01",
                    "信息工程学院",
                    "2024",
                    "软件工程",
                    "CL2402",
                    "软工2402班",
                    "13877776666",
                    "320101200602028888",
                ),
                (
                    "20230011",
                    "王强",
                    "C02",
                    "管理学院",
                    "2023",
                    "工商管理",
                    "CL2301",
                    "工管2301班",
                    "13700001111",
                    "320101200501017777",
                ),
            ]
            for st in students:
                cur.execute(
                    """INSERT INTO sem_student
                    (student_no, name, college_id, college_name, grade, major, class_id, class_name, phone, id_card_no)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    st,
                )

            one_day = 24 * 3600 * 1000
            # 情绪曲线数据由学生端（EmoDetect 聊天/人脸等）写入 sem_emotion_point

            r1 = f"rpt_{uuid.uuid4().hex[:12]}"
            r2 = f"rpt_{uuid.uuid4().hex[:12]}"
            cur.execute(
                """INSERT INTO sem_report (id, student_no, created_at_ms, summary, risk_level, tags_json, modality_json)
                VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (
                    r1,
                    "20240001",
                    now - 3 * one_day,
                    "近一周情绪整体偏稳定，数字人交互中出现轻度压力主题，建议关注学习与作息。",
                    "低",
                    json.dumps(["学习压力", "作息"], ensure_ascii=False),
                    json.dumps(["文本", "表情"], ensure_ascii=False),
                ),
            )
            cur.execute(
                """INSERT INTO sem_report (id, student_no, created_at_ms, summary, risk_level, tags_json, modality_json)
                VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (
                    r2,
                    "20240002",
                    now - 2 * one_day,
                    "情绪波动较明显，负向词频上升，建议进行一次线下谈话与支持性干预。",
                    "中",
                    json.dumps(["情绪波动", "人际"], ensure_ascii=False),
                    json.dumps(["文本", "语音"], ensure_ascii=False),
                ),
            )

            aid = f"alt_{uuid.uuid4().hex[:12]}"
            cur.execute(
                """INSERT INTO sem_alert
                (id, student_no, student_name, created_at_ms, level, reason, assigned_counselor_staff_no, status, note, updated_at_ms)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    aid,
                    "20240002",
                    "韩梅梅",
                    now - 6 * 3600 * 1000,
                    "中",
                    "今日负向情绪占比上升，且连续 3 天均值下降。",
                    "2011800051",
                    "NEW",
                    None,
                    None,
                ),
            )

            rules = [
                {"level": "低", "minScore": 60, "maxScore": 100},
                {"level": "中", "minScore": 45, "maxScore": 59.99},
                {"level": "高", "minScore": 30, "maxScore": 44.99},
                {"level": "危", "minScore": 0, "maxScore": 29.99},
            ]
            cur.execute(
                """INSERT INTO sem_threshold (id, sensitivity, level_rules_json, updated_at_ms, updated_by_staff_no)
                VALUES (1, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                sensitivity=VALUES(sensitivity),
                level_rules_json=VALUES(level_rules_json),
                updated_at_ms=VALUES(updated_at_ms),
                updated_by_staff_no=VALUES(updated_by_staff_no)""",
                (70, json.dumps(rules, ensure_ascii=False), now, "SuperManager"),
            )
        conn.commit()


def staff_row_public(row: dict) -> dict:
    scope = None
    scopes_out: Optional[List[dict]] = None
    role = (row.get("role") or "").strip()
    if role == "COUNSELOR" and row.get("scope_json"):
        entries = counselor_scope_entries(row)
        if entries:
            scopes_out = entries
            scope = entries[0]
    elif row.get("scope_json"):
        try:
            scope = json.loads(row["scope_json"])
        except (json.JSONDecodeError, TypeError):
            scope = None
    if role == "ADMIN":
        eff = effective_admin_scope(row)
        if _scope_has_college_constraint(eff):
            scope = eff
    out = {
        "id": str(row["id"]),
        "staffNo": row["staff_no"],
        "name": row["name"],
        "role": row["role"],
        "roleName": row["role_name"],
        "scope": scope,
        "status": row["status"],
        "failedLoginCount": int(row["failed_login_count"] or 0),
        "lockedUntil": row["locked_until_ms"],
        "lastLoginAt": row["last_login_ms"],
        "createdAt": row["created_at_ms"],
    }
    if scopes_out is not None:
        out["scopes"] = scopes_out
    return out


def student_row_public(row: dict) -> dict:
    return {
        "studentNo": row["student_no"],
        "name": row["name"],
        "collegeId": row["college_id"],
        "collegeName": row["college_name"],
        "grade": row["grade"],
        "major": row["major"],
        "classId": row["class_id"],
        "className": row["class_name"],
        "phone": row["phone"],
        "idCardNo": row["id_card_no"],
    }


def _parse_scope_json(staff: dict) -> dict:
    raw = staff.get("scope_json")
    if not raw:
        return {}
    try:
        return json.loads(raw) if isinstance(raw, str) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def counselor_scope_entries(staff: dict) -> List[dict]:
    """辅导员数据范围：支持 legacy 单对象或 { \"scopes\": [ {...}, ... ] } 多辖区并集。"""
    obj = _parse_scope_json(staff)
    if not isinstance(obj, dict):
        return []
    scopes = obj.get("scopes")
    if isinstance(scopes, list) and scopes:
        out: List[dict] = []
        for s in scopes:
            if isinstance(s, dict) and _scope_has_college_constraint(s):
                out.append(s)
        return out
    if _scope_has_college_constraint(obj):
        return [obj]
    return []


def _counselor_single_scope_matches_student(s: dict, student: dict) -> bool:
    if not _scope_has_college_constraint(s):
        return False
    if not _scope_college_matches_student(s, student):
        return False
    if not student.get("grade") or not student.get("major"):
        return False
    if not student.get("class_id"):
        return False
    if (s.get("grade") or "") != (student.get("grade") or ""):
        return False
    if (s.get("major") or "") != (student.get("major") or ""):
        return False
    class_ids = s.get("classIds") or []
    return (student.get("class_id") or "") in class_ids


def infer_college_scope_from_role_name(staff: dict) -> dict:
    """当 sem_staff.scope_json 为空但 role_name 为「计算机学院管理员」等形式时，推断学院 scope。"""
    if (staff.get("role") or "").strip() != "ADMIN":
        return {}
    if (staff.get("staff_no") or "").strip() == "SuperManager":
        return {}
    rn = (staff.get("role_name") or "").strip()
    if not rn.endswith("管理员"):
        return {}
    if rn in ("管理员", "超级管理员"):
        return {}
    core = rn[:-3]
    if not core.endswith("学院"):
        return {}
    for cid, cname in SEM_COLLEGE_PAIRS:
        if core == cname:
            return {"collegeId": cid, "collegeName": cname}
    return {}


def effective_admin_scope(staff: dict) -> dict:
    """管理员用于数据可见性/菜单的学院维度：DB scope 优先，否则按角色名称推断。"""
    if (staff.get("role") or "").strip() != "ADMIN":
        return {}
    s = _parse_scope_json(staff)
    if _scope_has_college_constraint(s):
        return s
    return infer_college_scope_from_role_name(staff)


def _scope_has_college_constraint(s: dict) -> bool:
    return bool((s.get("collegeId") or "").strip() or (s.get("collegeName") or "").strip())


def _scope_college_matches_student(s: dict, student: dict) -> bool:
    """学院维度：优先 college_id；学生缺 id 时用 college_name 与 scope 中的学院名对齐。"""
    scid = (s.get("collegeId") or "").strip()
    sname = (s.get("collegeName") or "").strip()
    cid = (student.get("college_id") or "").strip()
    cname = (student.get("college_name") or "").strip()
    if scid and cid:
        return scid == cid
    if scid and not cid:
        return bool(sname and cname and sname == cname)
    if sname and cname:
        return sname == cname
    return False


def within_scope(staff: dict, student: dict) -> bool:
    role = (staff.get("role") or "").strip()

    if role == "COUNSELOR":
        if not staff.get("scope_json"):
            return False
        entries = counselor_scope_entries(staff)
        if not entries:
            return False
        for s in entries:
            if _counselor_single_scope_matches_student(s, student):
                return True
        return False

    if role == "ADMIN":
        s = effective_admin_scope(staff)
        has_college = _scope_has_college_constraint(s)
        # 未配置学院维度：全校/系统级管理员（档案字段不齐时也放行，避免误伤历史数据）
        if not has_college:
            return True
        # 学院管理员：必须能判定学院归属，且与 scope 一致
        cid = (student.get("college_id") or "").strip()
        cname = (student.get("college_name") or "").strip()
        if not cid and not cname:
            return False
        return _scope_college_matches_student(s, student)

    return True


def get_staff_by_staff_no(staff_no: str) -> Optional[dict]:
    return _fetchone("SELECT * FROM sem_staff WHERE staff_no = %s", (staff_no.strip(),))


def get_staff_by_id(uid: int) -> Optional[dict]:
    return _fetchone("SELECT * FROM sem_staff WHERE id = %s", (uid,))


def list_all_staff() -> list:
    return _fetchall("SELECT * FROM sem_staff ORDER BY id", ())


def is_super_manager_staff(row: dict) -> bool:
    return (row.get("staff_no") or "").strip() == "SuperManager"


def is_sem_full_power_admin(row: dict) -> bool:
    """超级管理员，或未绑定学院维度的系统级管理员（可访问全校配置/审计等）。"""
    if row.get("role") != "ADMIN":
        return False
    if is_super_manager_staff(row):
        return True
    s = effective_admin_scope(row)
    return not _scope_has_college_constraint(s)


def _scope_colleges_match(sa: dict, sb: dict) -> bool:
    """比较两段 scope 的学院是否一致（用于学院管理员与辅导员 scope 对齐）。"""
    fake = {"college_id": (sb.get("collegeId") or "").strip(), "college_name": (sb.get("collegeName") or "").strip()}
    return _scope_college_matches_student(sa, fake)


def can_college_admin_manage_target(actor: dict, target: dict) -> bool:
    """账号/角色操作：谁能改谁。超级管理员可管所有；学院管理员仅能管本学院辅导员。"""
    if is_super_manager_staff(actor):
        return True
    if is_super_manager_staff(target):
        return False
    if actor.get("role") != "ADMIN":
        return False
    actor_s = effective_admin_scope(actor)
    if not _scope_has_college_constraint(actor_s):
        return True
    if target.get("role") == "ADMIN":
        return False
    if target.get("role") != "COUNSELOR":
        return False
    entries = counselor_scope_entries(target)
    if not entries:
        return False
    # 列表/操作可见性：只要有一条辖区落在本学院，即视为「本院相关人员」（单工号多学院）
    return any(_scope_colleges_match(actor_s, e) for e in entries)


def counselor_has_multi_college_scopes(target: dict) -> bool:
    """辅导员是否在多条辖区中涉及多个不同学院（用于限制学院管理员改角色/范围）。"""
    entries = counselor_scope_entries(target)
    if len(entries) < 2:
        return False
    keys: Set[str] = set()
    for e in entries:
        cid = (e.get("collegeId") or "").strip()
        cname = (e.get("collegeName") or "").strip()
        keys.add(cid or cname or "")
    keys.discard("")
    return len(keys) > 1


def _dedupe_scope_entries(entries: List[dict]) -> List[dict]:
    """按 学院+年级+专业+班级集合 去重辖区列表。"""
    seen: Set[Tuple[str, str, str, str, Tuple[str, ...]]] = set()
    out: List[dict] = []
    for e in entries:
        cid = (e.get("collegeId") or "").strip()
        cname = (e.get("collegeName") or "").strip()
        grade = (e.get("grade") or "").strip()
        major = (e.get("major") or "").strip()
        cids = tuple(sorted(str(x) for x in (e.get("classIds") or [])))
        key = (cid, cname, grade, major, cids)
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "collegeId": cid,
                "collegeName": cname,
                "grade": grade,
                "major": major,
                "classIds": list(e.get("classIds") or []),
            }
        )
    return out


def merge_counselor_staff_accounts(keep_staff_no: str, remove_staff_no: str) -> dict:
    """
    将 remove 工号的辅导员账号并入 keep（同一人两条 sem_staff 场景）：
    合并 scope_json 为 scopes 并集，预警指派人迁移，删除 remove。
    仅 COUNSELOR；保留 keep 的密码与姓名。
    """
    kn = (keep_staff_no or "").strip()
    rn = (remove_staff_no or "").strip()
    if not kn or not rn or kn == rn:
        raise ValueError("需要两个不同的工号")
    keep = get_staff_by_staff_no(kn)
    rem = get_staff_by_staff_no(rn)
    if not keep or not rem:
        raise ValueError("工号不存在")
    if (keep.get("role") or "").strip() != "COUNSELOR" or (rem.get("role") or "").strip() != "COUNSELOR":
        raise ValueError("仅支持合并两条辅导员（COUNSELOR）记录")
    merged = _dedupe_scope_entries(counselor_scope_entries(keep) + counselor_scope_entries(rem))
    if not merged:
        raise ValueError("合并后无有效辖区，请检查双方 scope_json")
    names = list({(e.get("collegeName") or "").strip() for e in merged if (e.get("collegeName") or "").strip()})
    role_name = (f"{'、'.join(names)}辅导员" if len(names) > 1 else (keep.get("role_name") or "辅导员"))[:100]
    new_json = json.dumps({"scopes": merged}, ensure_ascii=False)
    _exec(
        "UPDATE sem_alert SET assigned_counselor_staff_no=%s WHERE assigned_counselor_staff_no=%s",
        (kn, rn),
    )
    _exec(
        "UPDATE sem_staff SET scope_json=%s, role_name=%s WHERE staff_no=%s",
        (new_json, role_name, kn),
    )
    _exec("DELETE FROM sem_staff WHERE staff_no=%s", (rn,))
    return {"kept": kn, "removed": rn, "scopesCount": len(merged), "roleName": role_name}


def counselor_active_name_taken(name: str, exclude_staff_no: Optional[str] = None) -> bool:
    """是否已有在职辅导员使用相同姓名（用于禁止再建新工号造重复人）。"""
    nm = (name or "").strip()
    if not nm:
        return False
    ex = (exclude_staff_no or "").strip()
    if ex:
        row = _safe_fetchone(
            "SELECT id FROM sem_staff WHERE role='COUNSELOR' AND status='ACTIVE' AND name=%s AND staff_no<>%s LIMIT 1",
            (nm, ex),
        )
    else:
        row = _safe_fetchone(
            "SELECT id FROM sem_staff WHERE role='COUNSELOR' AND status='ACTIVE' AND name=%s LIMIT 1",
            (nm,),
        )
    return bool(row)


def _collapse_known_duplicate_zhuyan_staff_if_present() -> None:
    """若库中仍残留 SWC0101/CSC0101 两条「朱妍」演示数据，启动时自动并为一条多学院账号。"""
    a = get_staff_by_staff_no("SWC0101")
    b = get_staff_by_staff_no("CSC0101")
    if not a or not b:
        return
    if (a.get("role") or "").strip() != "COUNSELOR" or (b.get("role") or "").strip() != "COUNSELOR":
        return
    if (a.get("name") or "").strip() != "朱妍" or (b.get("name") or "").strip() != "朱妍":
        return
    try:
        merge_counselor_staff_accounts("SWC0101", "CSC0101")
    except Exception:
        pass


def list_staff_for_admin_console(actor: dict) -> list:
    """账号列表 / 角色配置下拉：与权限模型一致。"""
    rows = list_all_staff()
    if actor.get("role") != "ADMIN":
        return []
    if is_super_manager_staff(actor):
        return rows
    if is_sem_full_power_admin(actor):
        return [x for x in rows if not is_super_manager_staff(x)]
    out: list = []
    for x in rows:
        if is_super_manager_staff(x):
            continue
        if can_college_admin_manage_target(actor, x):
            out.append(x)
    return out


def assert_counselor_scope_matches_actor_college(actor: dict, scope: Optional[dict]) -> Optional[str]:
    """学院管理员创建/调整辅导员时，校验 scope 学院与本人一致。返回错误文案或 None。"""
    actor_s = effective_admin_scope(actor)
    if not _scope_has_college_constraint(actor_s):
        return None
    if not isinstance(scope, dict):
        return "学院管理员操作辅导员时必须携带 scope（含学院）"
    if not _scope_colleges_match(actor_s, scope):
        return "辅导员数据范围中的学院必须与当前学院管理员一致"
    return None


def assert_counselor_scopes_list_matches_actor_college(actor: dict, scopes: list) -> Optional[str]:
    """学院管理员为多辖区辅导员逐项校验学院（每项均须落在本人学院）。"""
    if not isinstance(scopes, list) or not scopes:
        return "必须提供至少一条辅导员辖区"
    for s in scopes:
        if not isinstance(s, dict):
            return "scopes 项格式错误"
        msg = assert_counselor_scope_matches_actor_college(actor, s)
        if msg:
            return msg
    return None


def update_staff_password(uid: int, password_hash: str, password_salt: str) -> None:
    _exec(
        "UPDATE sem_staff SET password_hash=%s, password_salt=%s WHERE id=%s",
        (password_hash, password_salt, uid),
    )


def update_staff_role_scope(
    staff_no: str,
    role: str,
    role_name: str,
    scope_json: Optional[str],
) -> None:
    _exec(
        "UPDATE sem_staff SET role=%s, role_name=%s, scope_json=%s WHERE staff_no=%s",
        (role, role_name, scope_json, staff_no),
    )


def create_staff_account(
    staff_no: str,
    name: str,
    password_hash: str,
    password_salt: str,
    role: str,
    role_name: str,
    scope_json: Optional[str],
    status: str = "ACTIVE",
) -> bool:
    """创建教职工账号；若工号已存在返回 False。"""
    existed = _safe_fetchone("SELECT id FROM sem_staff WHERE staff_no=%s", (staff_no.strip(),))
    if existed:
        return False
    now_ms = int(time.time() * 1000)
    _exec(
        """INSERT INTO sem_staff
           (staff_no, name, password_hash, password_salt, role, role_name, status,
            failed_login_count, locked_until_ms, last_login_ms, scope_json, created_at_ms)
           VALUES (%s,%s,%s,%s,%s,%s,%s,0,NULL,NULL,%s,%s)""",
        (
            staff_no.strip(),
            name.strip(),
            password_hash,
            password_salt,
            role,
            role_name,
            status,
            scope_json,
            now_ms,
        ),
    )
    return True


def admin_reset_staff_password(staff_no: str, password_hash: str, password_salt: str) -> bool:
    """管理员重置账号密码并解锁账号。"""
    target = _safe_fetchone("SELECT id FROM sem_staff WHERE staff_no=%s", (staff_no.strip(),))
    if not target:
        return False
    _exec(
        """UPDATE sem_staff
           SET password_hash=%s, password_salt=%s, failed_login_count=0, locked_until_ms=NULL, status='ACTIVE'
           WHERE staff_no=%s""",
        (password_hash, password_salt, staff_no.strip()),
    )
    return True


def set_last_login(uid: int, ts_ms: int) -> None:
    _exec("UPDATE sem_staff SET last_login_ms=%s, failed_login_count=0 WHERE id=%s", (ts_ms, uid))


def mark_login_success(staff_id: int, now_ms: int, prev_status: str) -> None:
    """登录成功：清零失败次数、解锁时间，LOCKED 则恢复 ACTIVE，并记录最近登录时间。"""
    new_status = "ACTIVE" if prev_status == "LOCKED" else prev_status
    _exec(
        """UPDATE sem_staff SET failed_login_count=0, locked_until_ms=NULL,
        status=%s, last_login_ms=%s WHERE id=%s""",
        (new_status, now_ms, staff_id),
    )


def lock_staff_after_failed(staff_no: str, failed: int, lock_until_ms: int) -> None:
    _exec(
        "UPDATE sem_staff SET status=%s, locked_until_ms=%s, failed_login_count=%s WHERE staff_no=%s",
        ("LOCKED", lock_until_ms, failed, staff_no),
    )


def set_account_status(staff_no: str, status: str) -> None:
    """管理员设置账号状态；ACTIVE 时同时清除锁定与失败次数。"""
    if status == "ACTIVE":
        _exec(
            "UPDATE sem_staff SET status=%s, locked_until_ms=NULL, failed_login_count=0 WHERE staff_no=%s",
            (status, staff_no),
        )
    else:
        _exec("UPDATE sem_staff SET status=%s WHERE staff_no=%s", (status, staff_no))


def increment_failed_login(staff_no: str, count: int) -> None:
    _exec(
        "UPDATE sem_staff SET failed_login_count=%s WHERE staff_no=%s",
        (count, staff_no),
    )


def _build_student_row_from_core(row: dict) -> dict:
    student_no = (row.get("student_id") or "").strip()
    tail_digits = "".join([c for c in student_no if c.isdigit()])
    class_no = 1
    if tail_digits:
        class_no = 1 if int(tail_digits[-1]) % 2 == 1 else 2
    class_name = f"软工24{class_no:02d}班"
    return {
        "student_no": student_no,
        "name": (row.get("name") or "").strip() or student_no,
        # core student 表仅保存基础信息时，按“软件学院2024级软件工程”模拟学校档案信息。
        # college_id/class_id 保持可为空，避免与外部系统编码不一致导致可见范围误拦截。
        "college_id": row.get("college_id") or DEFAULT_SIM_COLLEGE_ID,
        "college_name": row.get("college_name") or DEFAULT_SIM_COLLEGE_NAME,
        "grade": row.get("grade") or DEFAULT_SIM_GRADE,
        "major": row.get("major") or DEFAULT_SIM_MAJOR,
        "class_id": row.get("class_id") or "",
        "class_name": row.get("class_name") or class_name,
        "phone": row.get("phone") or "",
        "id_card_no": row.get("id_card_no") or "",
    }


def _normalize_sem_student_row(sem: Optional[dict], core_built: dict) -> dict:
    base = sem or {}
    return {
        "student_no": core_built["student_no"],
        "name": (base.get("name") or "").strip() or core_built["name"],
        "college_id": (base.get("college_id") or "").strip() or core_built["college_id"],
        "college_name": (base.get("college_name") or "").strip() or core_built["college_name"],
        "grade": (base.get("grade") or "").strip() or core_built["grade"],
        "major": (base.get("major") or "").strip() or core_built["major"],
        "class_id": (base.get("class_id") or "").strip() or core_built["class_id"],
        "class_name": (base.get("class_name") or "").strip() or core_built["class_name"],
        "phone": (base.get("phone") or "").strip() or core_built["phone"],
        "id_card_no": (base.get("id_card_no") or "").strip() or core_built["id_card_no"],
    }


def backfill_sem_students_from_core() -> None:
    """将 core student 表补齐到 sem_student，模拟学校真实档案字段。"""
    if not _table_exists("student"):
        return
    core_rows = _safe_fetchall(
        """SELECT student_id, name
           FROM student
           WHERE (is_deleted = 0 OR is_deleted IS NULL) AND student_id IS NOT NULL""",
        (),
    )
    for core in core_rows:
        student_no = (core.get("student_id") or "").strip()
        if not student_no:
            continue
        sem = _safe_fetchone("SELECT * FROM sem_student WHERE student_no=%s", (student_no,))
        core_built = _build_student_row_from_core(core)
        row = _normalize_sem_student_row(sem, core_built)
        _exec(
            """INSERT INTO sem_student
               (student_no, name, college_id, college_name, grade, major, class_id, class_name, phone, id_card_no)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON DUPLICATE KEY UPDATE
                 name=VALUES(name),
                 college_id=VALUES(college_id),
                 college_name=VALUES(college_name),
                 grade=VALUES(grade),
                 major=VALUES(major),
                 class_id=VALUES(class_id),
                 class_name=VALUES(class_name),
                 phone=VALUES(phone),
                 id_card_no=VALUES(id_card_no)""",
            (
                row["student_no"],
                row["name"],
                row["college_id"],
                row["college_name"],
                row["grade"],
                row["major"],
                row["class_id"],
                row["class_name"],
                row["phone"],
                row["id_card_no"],
            ),
        )


def list_students_unified() -> list:
    merged: Dict[str, Dict] = {}

    sem_rows = _safe_fetchall("SELECT * FROM sem_student", ())
    for r in sem_rows:
        sno = (r.get("student_no") or "").strip()
        if not sno:
            continue
        merged[sno] = r

    core_rows: list = []
    if _table_exists("student"):
        core_rows = _safe_fetchall(
            """SELECT student_id, name
               FROM student
               WHERE (is_deleted = 0 OR is_deleted IS NULL) AND student_id IS NOT NULL""",
            (),
        )

    for r in core_rows:
        sno = (r.get("student_id") or "").strip()
        if not sno:
            continue
        if sno in merged:
            merged[sno]["name"] = (r.get("name") or "").strip() or merged[sno]["name"]
            continue
        merged[sno] = _build_student_row_from_core(r)

    return list(merged.values())


def list_students_for_search(
    keyword: str,
    student_no: str,
    name: str,
    staff: dict,
) -> list:
    rows = list_students_unified()
    kw = (keyword or "").strip()
    sno = (student_no or "").strip()
    nm = (name or "").strip()
    out = []
    for r in rows:
        hit = (
            (not kw or kw in r["student_no"] or kw in r["name"])
            and (not sno or sno in r["student_no"])
            and (not nm or nm in r["name"])
        )
        if not hit:
            continue
        if not within_scope(staff, r):
            continue
        out.append(student_row_public(r))
    return out


def get_student_by_no(student_no: str) -> Optional[dict]:
    target = (student_no or "").strip()
    if not target:
        return None

    if _table_exists("student"):
        core = _safe_fetchone(
            """SELECT student_id, name
               FROM student
               WHERE student_id = %s AND (is_deleted = 0 OR is_deleted IS NULL)
               LIMIT 1""",
            (target,),
        )
        if core:
            sem = _safe_fetchone("SELECT * FROM sem_student WHERE student_no = %s", (target,))
            row = sem if sem else _build_student_row_from_core(core)
            row["name"] = (core.get("name") or "").strip() or row.get("name")
            return row

    return _safe_fetchone("SELECT * FROM sem_student WHERE student_no = %s", (target,))


def get_emotion_timeline(student_no: str) -> list:
    target = (student_no or "").strip()
    if not target:
        return []

    face_points: list = []
    if _table_exists("emotion_record"):
        rows = _safe_fetchall(
            """SELECT timestamp, emotion_type, intensity
               FROM emotion_record
               WHERE student_id=%s AND (is_deleted=0 OR is_deleted IS NULL)
               ORDER BY timestamp ASC""",
            (target,),
        )
        if rows:
            face_points = [
                {
                    "ts": _to_ts_ms(r.get("timestamp")),
                    "score": _score_from_intensity(r.get("intensity")),
                    "mood": _mood_from_emotion_label(r.get("emotion_type")),
                    "source": "人脸识别",
                }
                for r in rows
            ]

    chat_points = _chat_activity_points_for_student(target)
    if face_points or chat_points:
        merged = face_points + chat_points
        merged.sort(key=lambda x: int(x.get("ts", 0)))
        return merged

    legacy_rows = _safe_fetchall(
        "SELECT ts_ms, score, mood, source FROM sem_emotion_point WHERE student_no=%s ORDER BY ts_ms ASC",
        (target,),
    )
    return [
        {
            "ts": int(r["ts_ms"]),
            "score": int(r["score"]),
            "mood": r["mood"],
            "source": r["source"],
        }
        for r in legacy_rows
    ]


def get_reports_for_student(student_no: str) -> list:
    def _sanitize_summary(s: str) -> str:
        txt = str(s or "")
        txt = re.sub(r"【小时滚动[｜|][^】]*】", "【小时分析】", txt)
        txt = re.sub(r"【日总结[｜|][^】]*】", "【日总结】", txt)
        txt = txt.replace("在无人脸情绪序列时，", "")
        txt = txt.replace("在无人脸情绪序列时", "")
        txt = txt.replace("系统仅按消息条数与时间分布聚合，未使用对话原文。", "")
        txt = txt.replace("本时段基于系统内情绪识别记录聚合分析，不包含对话原文或个人隐私细节。", "")
        txt = txt.replace("（本报告仅供辅导员参考，不构成医学诊断。）", "")
        txt = re.sub(r"\s+", " ", txt).strip()
        return txt

    def _normalize_tags(tags: List[str]) -> List[str]:
        out: List[str] = []
        for t in tags or []:
            x = str(t or "").strip()
            if not x:
                continue
            if "条数聚合" in x or "无原文" in x:
                x = "数字人对话活跃"
            if x not in out:
                out.append(x)
        return out

    def _normalize_modalities(mods: List[str]) -> List[str]:
        out: List[str] = []
        for m in mods or []:
            x = str(m or "").strip()
            if not x or x == "人脸识别":
                continue
            if x not in out:
                out.append(x)
        if not out:
            out = ["数字人交互"]
        return out

    rows = _fetchall(
        "SELECT * FROM sem_report WHERE student_no=%s ORDER BY created_at_ms DESC",
        (student_no,),
    )
    out = []
    for r in rows:
        tags = _normalize_tags(json.loads(r["tags_json"] or "[]"))
        modalities = _normalize_modalities(json.loads(r["modality_json"] or "[]"))
        out.append(
            {
                "id": r["id"],
                "studentNo": r["student_no"],
                "createdAt": int(r["created_at_ms"]),
                "summary": _sanitize_summary(r["summary"]),
                "riskLevel": r["risk_level"],
                "tags": tags,
                "modality": modalities,
                "reportKind": (r.get("report_kind") or "legacy"),
                "periodStartMs": int(r["period_start_ms"]) if r.get("period_start_ms") is not None else None,
                "periodEndMs": int(r["period_end_ms"]) if r.get("period_end_ms") is not None else None,
            }
        )
    return out


def _report_column_exists(col: str) -> bool:
    row = _fetchone(
        """SELECT COUNT(*) AS c FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA=%s AND TABLE_NAME='sem_report' AND COLUMN_NAME=%s""",
        (MYSQL_DATABASE, col),
    )
    return bool(row and int(row.get("c", 0)) > 0)


def _ensure_sem_report_columns() -> None:
    """旧库升级：为 sem_report 增加报告类型与时间窗字段。"""
    if not _table_exists("sem_report"):
        return
    if not _report_column_exists("report_kind"):
        try:
            _exec(
                "ALTER TABLE sem_report ADD COLUMN report_kind VARCHAR(16) NOT NULL DEFAULT 'legacy' COMMENT 'legacy|daily|hourly' AFTER modality_json",
                (),
            )
        except Exception:
            pass
    if not _report_column_exists("period_start_ms"):
        try:
            _exec("ALTER TABLE sem_report ADD COLUMN period_start_ms BIGINT NULL", ())
        except Exception:
            pass
    if not _report_column_exists("period_end_ms"):
        try:
            _exec("ALTER TABLE sem_report ADD COLUMN period_end_ms BIGINT NULL", ())
        except Exception:
            pass
    try:
        _exec(
            "CREATE INDEX idx_student_kind_period ON sem_report (student_no, report_kind, period_start_ms)",
            (),
        )
    except Exception:
        pass


def _cn_timezone():
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo("Asia/Shanghai")
    except Exception:
        return dt.timezone(dt.timedelta(hours=8))


def _cn_day_bounds_ms(day_offset: int) -> Tuple[int, int]:
    """day_offset=0 为当日中国日期，-1 为昨日；返回 [当天0点, 次日0点) 的毫秒时间戳。"""
    tz = _cn_timezone()
    now = dt.datetime.now(tz)
    d = (now.date() + dt.timedelta(days=day_offset))
    start = dt.datetime.combine(d, dt.time.min, tzinfo=tz)
    end = start + dt.timedelta(days=1)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def _cn_previous_hour_bounds_ms() -> Tuple[int, int]:
    """上一完整自然小时 [整点, 下一整点)（中国时区）。"""
    tz = _cn_timezone()
    now = dt.datetime.now(tz).replace(minute=0, second=0, microsecond=0)
    hour_end = now
    hour_start = hour_end - dt.timedelta(hours=1)
    return int(hour_start.timestamp() * 1000), int(hour_end.timestamp() * 1000)


def _parse_student_no_from_emodet_user(mail: str, username: str) -> str:
    """从 EmoDetect users.mail（学号或 学号_userId）/username 解析学号。"""
    m = (mail or "").strip()
    mm = _STUDENT_NO_IN_MAIL.match(m)
    if mm:
        return mm.group("sid")
    u = (username or "").strip()
    mu = _STUDENT_NO_IN_MAIL.match(u)
    if mu:
        return mu.group("sid")
    return ""


def _digital_man_chat_tables_ready() -> bool:
    return _table_exists("messages") and _table_exists("conversations") and _table_exists("users")


def _user_ids_for_student_login(student_no: str) -> List[int]:
    sn = (student_no or "").strip()
    if not sn or not _digital_man_chat_tables_ready():
        return []
    rows = _safe_fetchall(
        "SELECT id FROM users WHERE mail=%s OR mail LIKE CONCAT(%s, '_%%')",
        (sn, sn),
    )
    return [int(r["id"]) for r in (rows or []) if r.get("id") is not None]


def _chat_activity_points_in_window(student_no: str, t0: int, t1: int) -> List[dict]:
    """数字人对话：每条消息映射为中性占位点（仅条数/时间分布，不含原文）。"""
    uids = _user_ids_for_student_login(student_no)
    if not uids or t1 <= t0:
        return []
    t0d = dt.datetime.utcfromtimestamp(t0 / 1000.0)
    t1d = dt.datetime.utcfromtimestamp(t1 / 1000.0)
    ph = ",".join(["%s"] * len(uids))
    rows = _safe_fetchall(
        f"""SELECT m.created_at AS ts
            FROM messages m
            INNER JOIN conversations c ON c.id = m.conversation_id
            WHERE c.user_id IN ({ph})
              AND m.created_at >= %s AND m.created_at < %s
            ORDER BY m.created_at ASC
            LIMIT 400""",
        tuple(uids) + (t0d, t1d),
    )
    out: List[dict] = []
    for r in rows or []:
        out.append(
            {
                "ts": _to_ts_ms(r.get("ts")),
                "score": 55,
                "mood": "中性",
                "emotion_type": "chat_activity",
            }
        )
    return out


def _chat_activity_points_for_student(student_no: str, limit: int = 600) -> List[dict]:
    """数字人对话全量时间轴点（仅条数/时间分布，不含原文）。"""
    uids = _user_ids_for_student_login(student_no)
    if not uids:
        return []
    ph = ",".join(["%s"] * len(uids))
    rows = _safe_fetchall(
        f"""SELECT m.created_at AS ts
            FROM messages m
            INNER JOIN conversations c ON c.id = m.conversation_id
            WHERE c.user_id IN ({ph})
            ORDER BY m.created_at ASC
            LIMIT {max(1, int(limit))}""",
        tuple(uids),
    )
    out: List[dict] = []
    for r in rows or []:
        out.append(
            {
                "ts": _to_ts_ms(r.get("ts")),
                "score": 55,
                "mood": "中性",
                "source": "数字人交互",
            }
        )
    return out


def _distinct_student_nos_with_chat_in_window(t0: int, t1: int) -> List[str]:
    """时间窗内发过数字人消息的学号（依赖 users.mail 与学号对齐）。"""
    if not _digital_man_chat_tables_ready():
        return []
    t0d = dt.datetime.utcfromtimestamp(t0 / 1000.0)
    t1d = dt.datetime.utcfromtimestamp(t1 / 1000.0)
    rows = _safe_fetchall(
        """SELECT DISTINCT u.mail AS mail, u.username AS username
           FROM messages m
           INNER JOIN conversations c ON c.id = m.conversation_id
           INNER JOIN users u ON u.id = c.user_id
           WHERE m.created_at >= %s AND m.created_at < %s""",
        (t0d, t1d),
    )
    seen: Set[str] = set()
    out: List[str] = []
    for r in rows or []:
        s = _parse_student_no_from_emodet_user(r.get("mail") or "", r.get("username") or "")
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _emotion_points_in_window(student_no: str, t0: int, t1: int) -> List[dict]:
    """时间窗内报告信号：仅数字人 messages（仅条数/时间，无原文）。"""
    target = (student_no or "").strip()
    if not target or t1 <= t0:
        return []
    return _chat_activity_points_in_window(target, t0, t1)


def _distinct_students_with_emotion_in_window(t0: int, t1: int) -> List[str]:
    found: Set[str] = set()
    if _table_exists("emotion_record"):
        t0d = dt.datetime.utcfromtimestamp(t0 / 1000.0)
        t1d = dt.datetime.utcfromtimestamp(t1 / 1000.0)
        rows = _safe_fetchall(
            """SELECT DISTINCT student_id AS s FROM emotion_record
               WHERE (is_deleted=0 OR is_deleted IS NULL) AND timestamp >= %s AND timestamp < %s""",
            (t0d, t1d),
        )
        for r in rows or []:
            s = (r.get("s") or "").strip()
            if s:
                found.add(s)
    rows2 = _safe_fetchall(
        "SELECT DISTINCT student_no AS s FROM sem_emotion_point WHERE ts_ms>=%s AND ts_ms<%s",
        (t0, t1),
    )
    for r in rows2 or []:
        s = (r.get("s") or "").strip()
        if s:
            found.add(s)
    for sn in _distinct_student_nos_with_chat_in_window(t0, t1):
        found.add(sn)
    return sorted(found)


def _build_desensitized_assessment(
    points: List[dict],
    report_kind: str,
    period_start_ms: int,
    period_end_ms: int,
) -> Tuple[str, str, List[str], List[str]]:
    """基于数字人对话聚合信号（不含原文）生成摘要与风险等级。"""
    n = len(points)
    scores = [int(p["score"]) for p in points]
    avg = sum(scores) / n
    neg = sum(1 for p in points if p.get("mood") == "消极" or int(p.get("score", 50)) < 45)
    worst = min(scores)
    neg_ratio = neg / n if n else 0.0
    et = " ".join((p.get("emotion_type") or "").lower() for p in points)
    has_chat = any((p.get("emotion_type") == "chat_activity") for p in points)
    chat_only = bool(points) and all((p.get("emotion_type") == "chat_activity") for p in points)
    tags: List[str] = []
    if chat_only:
        tags.append("数字人对话活跃")
    elif has_chat:
        tags.append("含数字人对话时段")
    if neg_ratio > 0.25 or avg < 48:
        tags.append("负向情绪信号偏多")
    if any(k in et for k in ("fear", "sad", "悲伤", "焦虑", "恐惧", "depress", "angry", "生气")):
        tags.append("压力或紧张相关倾向（已脱敏）")
    if worst < 30 or neg_ratio > 0.45:
        risk = "高"
    elif worst < 45 or neg_ratio > 0.12 or avg < 52:
        risk = "中"
    else:
        risk = "低"
    if worst < 22:
        risk = "危"

    kind_cn = "日总结" if report_kind == "daily" else "小时分析" if report_kind == "hourly" else "总结"
    if chat_only:
        summary = (
            f"【{kind_cn}】本时段基于数字人对话记录进行统计。"
            f"共{n}条消息参与分析，综合参考分约{avg:.0f}/100。"
        )
    else:
        summary = (
            f"【{kind_cn}】本时段基于数字人对话记录进行统计分析。"
            f"共{n}条记录，综合得分约{avg:.0f}/100；消极倾向占比约{neg_ratio*100:.0f}%。"
        )
    if risk in ("高", "危"):
        summary += " 观察到较明显的情绪低落或压力相关信号，建议结合线下谈话与校内预案关注，必要时启动心理支持流程。"
    elif risk == "中":
        summary += " 存在一定情绪波动，建议适度关注学习与作息平衡。"
    else:
        summary += " 整体情绪相对平稳。"
    if report_kind == "legacy":
        modalities = ["数字人交互"]
    else:
        modalities = ["文本", "数字人交互"] if has_chat else ["数字人交互"]
    return summary, risk, tags[:6], modalities


def upsert_assessment_report(
    student_no: str,
    report_kind: str,
    period_start_ms: int,
    period_end_ms: int,
    summary: str,
    risk_level: str,
    tags: List[str],
    modalities: List[str],
) -> str:
    """按 student_no + kind + period 幂等写入。"""
    sn = (student_no or "").strip()
    rid = f"rpt_{sn}_{report_kind}_{period_start_ms}"[:64]
    now_ms = int(time.time() * 1000)
    _exec("DELETE FROM sem_report WHERE id=%s", (rid,))
    _exec(
        """INSERT INTO sem_report
           (id, student_no, created_at_ms, summary, risk_level, tags_json, modality_json, report_kind, period_start_ms, period_end_ms)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (
            rid,
            sn,
            now_ms,
            summary[:8000],
            risk_level[:10],
            json.dumps(tags, ensure_ascii=False),
            json.dumps(modalities, ensure_ascii=False),
            report_kind[:16],
            int(period_start_ms),
            int(period_end_ms),
        ),
    )
    return rid


def generate_assessment_reports_for_window(
    t0: int,
    t1: int,
    report_kind: str,
    *,
    log_high_risk_audit: bool = True,
) -> dict:
    """为时间窗内有情绪数据的学生各生成一条脱敏评估报告。"""
    students = _distinct_students_with_emotion_in_window(t0, t1)
    written = 0
    high = 0
    for sn in students:
        pts = _emotion_points_in_window(sn, t0, t1)
        if not pts:
            continue
        summary, risk, tags, mods = _build_desensitized_assessment(pts, report_kind, t0, t1)
        upsert_assessment_report(sn, report_kind, t0, t1, summary, risk, tags, mods)
        written += 1
        if risk in ("高", "危") and log_high_risk_audit:
            high += 1
            try:
                insert_audit(
                    "REPORT_HIGH",
                    f"{report_kind} 评估 risk={risk} period={t0}-{t1} student={sn}",
                    "127.0.0.1",
                    "report_scheduler",
                    actor_staff_no=None,
                    actor_name="system",
                    target_student_no=sn,
                )
            except Exception:
                pass
    return {"window": [t0, t1], "kind": report_kind, "studentsConsidered": len(students), "reportsWritten": written, "highRiskFlags": high}


def run_scheduled_daily_reports() -> dict:
    """中国时区：总结「昨天」全天。"""
    t0, t1 = _cn_day_bounds_ms(-1)
    return generate_assessment_reports_for_window(t0, t1, "daily")


def run_scheduled_hourly_reports() -> dict:
    """中国时区：总结「上一完整小时」。"""
    t0, t1 = _cn_previous_hour_bounds_ms()
    return generate_assessment_reports_for_window(t0, t1, "hourly")


def get_threshold() -> dict:
    row = _fetchone("SELECT * FROM sem_threshold WHERE id=1", ())
    if not row:
        return {
            "sensitivity": 70,
            "levelRules": [
                {"level": "低", "minScore": 60, "maxScore": 100},
                {"level": "中", "minScore": 45, "maxScore": 59.99},
                {"level": "高", "minScore": 30, "maxScore": 44.99},
                {"level": "危", "minScore": 0, "maxScore": 29.99},
            ],
            "updatedAt": int(time.time() * 1000),
            "updatedBy": None,
        }
    return {
        "sensitivity": int(row["sensitivity"]),
        "levelRules": json.loads(row["level_rules_json"] or "[]"),
        "updatedAt": int(row["updated_at_ms"]),
        "updatedBy": row.get("updated_by_staff_no"),
    }


def save_threshold(sensitivity: int, level_rules: list, staff_no: str) -> dict:
    now = int(time.time() * 1000)
    _exec(
        """INSERT INTO sem_threshold (id, sensitivity, level_rules_json, updated_at_ms, updated_by_staff_no)
        VALUES (1, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE sensitivity=VALUES(sensitivity), level_rules_json=VALUES(level_rules_json),
        updated_at_ms=VALUES(updated_at_ms), updated_by_staff_no=VALUES(updated_by_staff_no)""",
        (sensitivity, json.dumps(level_rules, ensure_ascii=False), now, staff_no),
    )
    return get_threshold()


def list_audit_logs(limit: int = 500) -> list:
    rows = _fetchall(
        "SELECT * FROM sem_audit_log ORDER BY ts_ms DESC LIMIT %s",
        (min(max(1, limit), 2000),),
    )
    return [
        {
            "id": str(r["id"]),
            "action": r["action"],
            "actorStaffNo": r["actor_staff_no"],
            "actorName": r["actor_name"],
            "targetStudentNo": r["target_student_no"],
            "targetStaffNo": r["target_staff_no"],
            "detail": r["detail"],
            "ts": int(r["ts_ms"]),
            "ip": r["ip"],
            "device": r["device"],
        }
        for r in rows
    ]


def add_sem_user_feedback(
    staff_id: int,
    staff_no: str,
    display_name: str,
    content: str,
    *,
    contact_email: str = "",
    screenshot_url: Optional[str] = None,
    allow_contact: int = 0,
) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO sem_user_feedback
                   (staff_id, staff_no, display_name, contact_email, content, screenshot_url, allow_contact)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (
                    int(staff_id),
                    (staff_no or "").strip()[:32],
                    (display_name or "").strip()[:100],
                    (contact_email or "").strip()[:255],
                    (content or "").strip()[:8000],
                    ((screenshot_url or "").strip()[:500] or None),
                    1 if allow_contact else 0,
                ),
            )
            conn.commit()
            return int(cur.lastrowid)


def list_sem_user_feedback(limit: int = 200) -> list:
    lim = max(1, min(int(limit or 200), 1000))
    return _fetchall(
        """SELECT id, staff_id, staff_no, display_name, contact_email, content, screenshot_url, allow_contact, created_at
           FROM sem_user_feedback ORDER BY created_at DESC LIMIT %s""",
        (lim,),
    )


def delete_sem_user_feedback(feedback_id: int) -> bool:
    """删除一条用户反馈，返回是否删除到行。"""
    fid = int(feedback_id)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM sem_user_feedback WHERE id=%s", (fid,))
            n = int(cur.rowcount or 0)
        conn.commit()
    return n > 0


def sem_feedback_row_api(row: dict) -> dict:
    ca = row.get("created_at")
    if hasattr(ca, "strftime"):
        created = ca.strftime("%Y-%m-%d %H:%M:%S")
    else:
        created = str(ca) if ca is not None else ""
    ce = (row.get("contact_email") or "").strip()
    staff_no = (row.get("staff_no") or "").strip()
    return {
        "id": int(row["id"]),
        "user_id": int(row["staff_id"]),
        "username": row.get("display_name") or "",
        "email": ce or staff_no or "-",
        "content": row.get("content") or "",
        "screenshot_url": row.get("screenshot_url"),
        "allow_contact": 1 if row.get("allow_contact") else 0,
        "created_at": created,
    }


def insert_audit(
    action: str,
    detail: str,
    ip: str,
    device: str,
    actor_staff_no: Optional[str] = None,
    actor_name: Optional[str] = None,
    target_student_no: Optional[str] = None,
    target_staff_no: Optional[str] = None,
) -> None:
    ts = int(time.time() * 1000)
    _exec(
        """INSERT INTO sem_audit_log
        (action, actor_staff_no, actor_name, target_student_no, target_staff_no, detail, ts_ms, ip, device)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (action, actor_staff_no, actor_name, target_student_no, target_staff_no, detail, ts, ip, device),
    )


def _obsolete_runtime_split_alert_id(aid: str) -> bool:
    """旧版拆开的 runtime-chat-* / runtime-*-xN 列表不再展示（合并为 runtime-{学号}）。"""
    s = (aid or "").strip()
    if s.startswith("runtime-chat-"):
        return True
    return bool(re.match(r"^runtime-20\d{8}-x\d+$", s))


def _unified_signal_counts(student_no: str) -> Tuple[int, int, int, list, list]:
    """近7天：人脸时间线消极条数、聊天异常条数、合计、negatives 列表、chat 行列表。"""
    sid = (student_no or "").strip()
    now_ms = int(time.time() * 1000)
    seven_ms = now_ms - 7 * 24 * 3600 * 1000
    timeline = get_emotion_timeline(sid) if sid else []
    recent = [p for p in timeline if int(p.get("ts", 0)) >= seven_ms]
    face_negs = [p for p in recent if p.get("mood") == "消极"]
    n_face = len(face_negs)
    chat_rows = _list_chat_emotion_anomalies_recent(sid, days=7) if sid else []
    n_chat = len(chat_rows)
    return n_face, n_chat, n_face + n_chat, face_negs, chat_rows


def _unified_alert_level_from_gear(k: int) -> str:
    """合并预警「等级」与 reason 中「第 k 档」一致，避免仅聊天时用固定分套区间误显示为高/危。"""
    if k <= 1:
        return "低"
    if k == 2:
        return "中"
    if k == 3:
        return "高"
    return "危"


def _unified_runtime_alert_item(staff: dict, stu: dict) -> Optional[dict]:
    """每人一条合并预警：id 固定 runtime-{学号}，合计满3升一档，档=k=total//3。"""
    sno = (stu.get("student_no") or "").strip()
    if not sno:
        return None
    n_face, n_chat, total, face_negs, chat_rows = _unified_signal_counts(sno)
    if total < 3:
        return None
    now_ms = int(time.time() * 1000)
    k = total // 3
    level = _unified_alert_level_from_gear(k)
    ts_face = int(face_negs[-1].get("ts", 0)) if face_negs else 0
    ts_chat = _to_ts_ms(chat_rows[-1].get("created_at")) if chat_rows else 0
    created_at = max(ts_face, ts_chat, now_ms)
    aid = f"runtime-{sno}"
    reason = (
        f"近7天累计：人脸/时间线消极 {n_face} 条，聊天情绪异常 {n_chat} 条，合计 {total} 条；"
        f"当前第 {k} 档，建议跟进"
    )
    return {
        "id": aid,
        "studentNo": sno,
        "studentName": stu.get("name") or sno,
        "createdAt": created_at,
        "level": level,
        "reason": reason,
        "assignedCounselorStaffNo": staff["staff_no"] if staff["role"] != "ADMIN" else "SYSTEM",
        "status": "NEW",
        "note": None,
        "updatedAt": None,
    }


def is_canonical_unified_runtime_alert_id(aid: str) -> bool:
    """合并预警在库中的标准 id：runtime-{8位入学年级学号}。"""
    return bool(re.match(r"^runtime-20\d{8}$", (aid or "").strip()))


def purge_unified_alert_sources_for_student(student_no: str) -> None:
    """消除合并预警时：清空近 7 天内计入合并口径的来源（非监控聊天异常 + 人脸时间线 + 旧 sem 点）。"""
    sid = (student_no or "").strip()
    if not sid:
        return

    if _table_exists("emotion_anomalies") and _table_exists("users"):
        urows = _safe_fetchall(
            """SELECT DISTINCT u.id AS uid FROM users u
               WHERE u.mail = %s OR u.username = %s OR SUBSTRING_INDEX(IFNULL(u.mail, ''), '_', 1) = %s""",
            (sid, sid, sid),
        )
        uids = [int(r["uid"]) for r in urows if r.get("uid") is not None]
        if uids:
            ph = ",".join(["%s"] * len(uids))
            _exec(
                f"""DELETE FROM emotion_anomalies
                    WHERE user_id IN ({ph})
                      AND IFNULL(from_monitoring, 0) = 0
                      AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)""",
                tuple(uids),
            )

    if _table_exists("emotion_record"):
        _exec(
            """UPDATE emotion_record SET is_deleted=1, deleted_at=NOW()
               WHERE student_id=%s AND IFNULL(is_deleted, 0) = 0
                 AND `timestamp` >= DATE_SUB(NOW(), INTERVAL 7 DAY)""",
            (sid,),
        )

    if _table_exists("sem_emotion_point"):
        seven_ms = int(time.time() * 1000) - 7 * 24 * 3600 * 1000
        _exec(
            "DELETE FROM sem_emotion_point WHERE student_no=%s AND ts_ms >= %s",
            (sid, seven_ms),
        )


def delete_sem_alert(aid: str) -> None:
    _exec("DELETE FROM sem_alert WHERE id=%s", (aid,))


def _sync_persisted_unified_runtime_row(aid: str, snap: dict, student_name: str) -> None:
    """已落库的合并预警在 NEW/FOLLOWED 时随档更新文案与等级。"""
    now_ms = int(time.time() * 1000)
    _exec(
        """UPDATE sem_alert SET level=%s, reason=%s, created_at_ms=%s, student_name=%s, updated_at_ms=%s
           WHERE id=%s AND status IN ('NEW','FOLLOWED')""",
        (
            snap["level"],
            snap["reason"],
            int(snap["createdAt"]),
            (student_name or "").strip() or snap.get("studentName") or "",
            now_ms,
            aid,
        ),
    )


def list_alerts_for_staff(staff: dict) -> list:
    vs = visible_students(staff)
    if staff["role"] == "ADMIN":
        rows = _safe_fetchall("SELECT * FROM sem_alert ORDER BY created_at_ms DESC", ())
    else:
        nos: List[str] = []
        seen_nos = set()
        for s in vs:
            sn = (s.get("student_no") or "").strip()
            if sn and sn not in seen_nos:
                seen_nos.add(sn)
                nos.append(sn)
        if nos:
            ph = ",".join(["%s"] * len(nos))
            rows = _safe_fetchall(
                f"""SELECT * FROM sem_alert
                    WHERE assigned_counselor_staff_no=%s OR student_no IN ({ph})
                    ORDER BY created_at_ms DESC""",
                (staff["staff_no"],) + tuple(nos),
            )
        else:
            rows = _safe_fetchall(
                "SELECT * FROM sem_alert WHERE assigned_counselor_staff_no=%s ORDER BY created_at_ms DESC",
                (staff["staff_no"],),
            )

    persisted = [_alert_to_json(r) for r in rows]
    persisted = [p for p in persisted if not _obsolete_runtime_split_alert_id(p["id"])]
    id_to_idx = {p["id"]: i for i, p in enumerate(persisted)}

    vis_nos = {(s.get("student_no") or "").strip() for s in vs if (s.get("student_no") or "").strip()}
    mine_no = str(staff.get("staff_no") or "").strip() if staff.get("role") == "COUNSELOR" else ""

    for stu in vs:
        snap = _unified_runtime_alert_item(staff, stu)
        if not snap:
            continue
        aid = snap["id"]
        if aid in id_to_idx:
            p = persisted[id_to_idx[aid]]
            # 仅「待处理」随信号升档刷新文案；已跟进保留当时展示，避免误覆盖辅导员已填状态。
            if p.get("status") == "NEW":
                _sync_persisted_unified_runtime_row(
                    aid,
                    snap,
                    (stu.get("name") or "").strip() or p.get("studentName") or "",
                )
                persisted[id_to_idx[aid]] = {
                    **p,
                    "level": snap["level"],
                    "reason": snap["reason"],
                    "createdAt": snap["createdAt"],
                }
        else:
            # 列表 SELECT 可能因归属字段与库不一致漏掉行，但 POST 已更新库：用主键再读一行，避免永远叠虚拟「待处理」。
            db_row = get_alert_by_id(aid)
            pjson: Optional[dict] = None
            use_db = False
            if db_row and not _obsolete_runtime_split_alert_id(str(db_row.get("id") or "")):
                pjson = _alert_to_json(db_row)
                if staff["role"] == "ADMIN":
                    use_db = True
                elif staff["role"] == "COUNSELOR":
                    asn_raw = db_row.get("assigned_counselor_staff_no")
                    asn = (str(asn_raw).strip() if asn_raw is not None else "") or ""
                    sno = str(db_row.get("student_no") or "").strip()
                    if asn == mine_no or sno in vis_nos:
                        use_db = True
            if use_db and pjson is not None:
                persisted.append(pjson)
                idx = len(persisted) - 1
                id_to_idx[aid] = idx
                if pjson.get("status") == "NEW":
                    _sync_persisted_unified_runtime_row(
                        aid,
                        snap,
                        (stu.get("name") or "").strip() or pjson.get("studentName") or "",
                    )
                    persisted[idx] = {
                        **persisted[idx],
                        "level": snap["level"],
                        "reason": snap["reason"],
                        "createdAt": snap["createdAt"],
                    }
                continue
            persisted.append(snap)
            id_to_idx[aid] = len(persisted) - 1

    persisted.sort(key=lambda x: x.get("createdAt", 0), reverse=True)
    return [p for p in persisted if p.get("status") != "CLEARED"]


def _alert_to_json(r: dict) -> dict:
    reason = str(r.get("reason") or "")
    reason = reason.replace("（每满3条升一档）", "")
    return {
        "id": r["id"],
        "studentNo": r["student_no"],
        "studentName": r["student_name"],
        "createdAt": int(r["created_at_ms"]),
        "level": r["level"],
        "reason": reason,
        "assignedCounselorStaffNo": r["assigned_counselor_staff_no"],
        "status": r["status"],
        "note": r["note"],
        "updatedAt": int(r["updated_at_ms"]) if r.get("updated_at_ms") else None,
    }


def get_alert_by_id(aid: str) -> Optional[dict]:
    return _fetchone("SELECT * FROM sem_alert WHERE id=%s", (aid,))


def _canonical_student_no_from_runtime_id(aid: str) -> Optional[str]:
    """从 runtime-{学号} 或旧版 runtime-*-x* / runtime-chat-* 解析学号。"""
    a = (aid or "").strip()
    m = re.match(r"^runtime-(20\d{8})$", a)
    if m:
        return m.group(1)
    m = re.match(r"^runtime-chat-(20\d{8})-x\d+$", a)
    if m:
        return m.group(1)
    m = re.match(r"^runtime-(20\d{8})-x\d+$", a)
    if m:
        return m.group(1)
    return None


def _list_chat_emotion_anomalies_recent(student_no: str, days: int = 7) -> list:
    """与 EmoDetect 同源：users.mail/username 对齐学号，取近 N 天聊天侧情绪异常（非监控）。"""
    sid = (student_no or "").strip()
    if not sid or not _table_exists("emotion_anomalies") or not _table_exists("users"):
        return []
    # mail 可能为学号或「学号_userId」形式
    return _safe_fetchall(
        """SELECT ea.id, ea.created_at, ea.emotion_label
           FROM emotion_anomalies ea
           INNER JOIN users u ON u.id = ea.user_id
           WHERE (u.mail = %s OR u.username = %s OR SUBSTRING_INDEX(IFNULL(u.mail, ''), '_', 1) = %s)
             AND IFNULL(ea.from_monitoring, 0) = 0
             AND ea.created_at >= DATE_SUB(NOW(), INTERVAL %s DAY)
           ORDER BY ea.created_at ASC""",
        (sid, sid, sid, max(1, int(days))),
    )


def materialize_runtime_alert(aid: str, staff: dict) -> Optional[dict]:
    """将合并 runtime 写入 sem_alert；id 统一为 runtime-{学号}（兼容旧 URL 中的 runtime-chat-* / *-xN）。"""
    student_no = _canonical_student_no_from_runtime_id(aid)
    if not student_no:
        return None
    canonical = f"runtime-{student_no}"

    student = get_student_by_no(student_no)
    if not student or not within_scope(staff, student):
        return None

    existing = get_alert_by_id(canonical)
    if existing:
        return existing

    n_face, n_chat, total, _, _ = _unified_signal_counts(student_no)
    if total < 3:
        return None

    snap = _unified_runtime_alert_item(staff, student)
    if not snap:
        return None

    assigned = staff["staff_no"] if staff["role"] != "ADMIN" else _resolve_counselor_assignee(student)
    _exec(
        """INSERT INTO sem_alert
           (id, student_no, student_name, created_at_ms, level, reason, assigned_counselor_staff_no, status, note, updated_at_ms)
           VALUES (%s,%s,%s,%s,%s,%s,%s,'NEW',NULL,NULL)""",
        (
            canonical,
            student_no,
            student["name"],
            int(snap["createdAt"]),
            snap["level"],
            snap["reason"],
            assigned,
        ),
    )
    return get_alert_by_id(canonical)


def _resolve_counselor_assignee(student: dict) -> str:
    """为管理员触发的运行时预警匹配一个辅导员工号。"""
    counselors = _safe_fetchall(
        "SELECT * FROM sem_staff WHERE role='COUNSELOR' AND status='ACTIVE' ORDER BY id ASC",
        (),
    )
    for counselor in counselors:
        if within_scope(counselor, student):
            return counselor["staff_no"]
    return "SYSTEM"


def is_alert_counselor_unclaimed(assigned: Any) -> bool:
    """SYSTEM、NULL、空串视为未明确归属到某位辅导员（与仅按工号列表查询时的缺口一致）。"""
    if assigned is None:
        return True
    s = str(assigned).strip()
    return s == "" or s == "SYSTEM"


def claim_system_assigned_alert_for_counselor(aid: str, counselor_staff_no: str) -> None:
    """辅导员处理未认领/SYSTEM 预警后写入本人工号，否则列表只查自己工号时看不到已更新状态。"""
    sid = (counselor_staff_no or "").strip()
    if not sid:
        return
    now = int(time.time() * 1000)
    _exec(
        """UPDATE sem_alert SET assigned_counselor_staff_no=%s, updated_at_ms=%s
           WHERE id=%s AND (
             assigned_counselor_staff_no='SYSTEM'
             OR assigned_counselor_staff_no IS NULL
             OR assigned_counselor_staff_no=''
           )""",
        (sid, now, aid),
    )


def update_alert(aid: str, status: str, note: Optional[str]) -> bool:
    now = int(time.time() * 1000)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE sem_alert SET status=%s, note=%s, updated_at_ms=%s WHERE id=%s",
                (status, note, now, aid),
            )
            ok = int(cur.rowcount or 0) > 0
        conn.commit()
        return ok


def visible_students(staff: dict) -> list:
    rows = list_students_unified()
    return [r for r in rows if within_scope(staff, r)]


def _risk_level_from_score(score: float, level_rules: list) -> str:
    for rule in level_rules or []:
        try:
            lo = float(rule.get("minScore"))
            hi = float(rule.get("maxScore"))
        except (TypeError, ValueError):
            continue
        if lo <= score <= hi:
            return str(rule.get("level") or "中")
    return "中"


def _evaluation_display_tz():
    """趋势图按自然日分桶时使用的时区（与文档「评估体系」一致，可覆盖）。"""
    tz_name = (os.environ.get("SEM_DISPLAY_TZ") or "Asia/Shanghai").strip() or "Asia/Shanghai"
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(tz_name)
    except Exception:
        # Python 3.8 等环境可能无 zoneinfo；上海业务日默认东八区固定偏移
        if tz_name in ("Asia/Shanghai", "Asia/Chongqing", "Asia/Harbin", "PRC") or "shanghai" in tz_name.lower():
            return dt.timezone(dt.timedelta(hours=8))
        return dt.timezone.utc


def _local_calendar_day_bounds_ms(day: dt.date, tz) -> Tuple[int, int]:
    start = dt.datetime.combine(day, dt.time.min, tzinfo=tz)
    end = start + dt.timedelta(days=1)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def compute_visualization(staff: dict, range_key: str) -> dict:
    """按当前可见学生聚合情绪可视化指标。"""
    vs = visible_students(staff)
    now = int(time.time() * 1000)

    today_scores = []
    latest_points = {}
    for s in vs:
        points = get_emotion_timeline(s["student_no"])
        latest = points[-1] if points else None
        latest_points[s["student_no"]] = (points, latest)
        sc = int(latest["score"]) if latest else 50
        today_scores.append(sc)
    avg = sum(today_scores) / len(today_scores) if today_scores else 0.0

    dist = {"积极": 0, "中性": 0, "消极": 0}
    mood_students: Dict[str, List[dict]] = {"积极": [], "中性": [], "消极": []}
    for s in vs:
        _, latest = latest_points.get(s["student_no"], ([], None))
        mood = latest["mood"] if latest else "中性"
        if mood in dist:
            dist[mood] += 1
        if mood in mood_students:
            mood_students[mood].append(
                {
                    "studentNo": s["student_no"],
                    "name": ((s.get("name") or "").strip() or s["student_no"]),
                }
            )
    for k in mood_students:
        mood_students[k].sort(key=lambda x: str(x.get("studentNo") or ""))

    days = 7 if range_key == "week" else 30 if range_key == "month" else 120
    tz = _evaluation_display_tz()
    today_local = dt.datetime.fromtimestamp(now / 1000, tz=tz).date()
    series = []
    for i in range(days):
        d = today_local - dt.timedelta(days=days - 1 - i)
        t0, t1 = _local_calendar_day_bounds_ms(d, tz)
        day_scores: List[float] = []
        for s in vs:
            points, _ = latest_points.get(s["student_no"], ([], None))
            if not points:
                continue
            in_day = [int(p["score"]) for p in points if t0 <= int(p.get("ts", 0)) < t1]
            if not in_day:
                continue
            day_scores.append(sum(in_day) / len(in_day))
        series.append({"ts": t0, "avg": sum(day_scores) / len(day_scores) if day_scores else 0.0})

    if staff["role"] == "ADMIN":
        sc = effective_admin_scope(staff)
        if _scope_has_college_constraint(sc):
            cn = (sc.get("collegeName") or "").strip() or (sc.get("collegeId") or "").strip()
            scope_label = f"{cn}（学院）"
        else:
            scope_label = "全校"
    else:
        entries = counselor_scope_entries(staff)
        if len(entries) > 1:
            parts = [
                f"{(e.get('collegeName') or '').strip()}/{(e.get('grade') or '').strip()}/{(e.get('major') or '').strip()}"
                for e in entries
            ]
            scope_label = " + ".join([p for p in parts if p.strip("/")]) or "多辖区"
        elif len(entries) == 1:
            sc = entries[0]
            scope_label = f"{sc.get('collegeName', '')}/{sc.get('grade', '')}/{sc.get('major', '')}" or "-"
        else:
            scope_label = "-"

    return {
        "scopeLabel": scope_label,
        "todayAvg": avg,
        "distribution": dist,
        "distributionStudents": mood_students,
        "trend": series,
        "visibleCount": len(vs),
    }


def init_db() -> None:
    init_schema()
    _ensure_sem_report_columns()
    backfill_sem_students_from_core()
    _collapse_known_duplicate_zhuyan_staff_if_present()
    # 默认关闭示例数据灌入，避免生产环境被演示数据污染。
    # 如需快速演示，可显式设置 SEM_ENABLE_DEMO_SEED=true。
    if (os.environ.get("SEM_ENABLE_DEMO_SEED", "false").strip().lower() in ("1", "true", "yes", "on")):
        seed_demo_data()
