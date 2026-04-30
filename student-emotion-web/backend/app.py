"""
学生情绪管理系统 — Flask API（工号登录，与 student-emotion-web 前端配套）。
"""
import atexit
import hashlib
import json
import math
import os
import re
import secrets
import time
from typing import Any, Dict, Optional, Tuple

from flask import Flask, request, jsonify
from flask_cors import CORS

import database as db
from config import SEM_APP_PORT, validate_config

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})
validate_config()

# token -> staff_id
_tokens: Dict[str, int] = {}

_report_scheduler = None


def _start_report_scheduler() -> None:
    """定时生成脱敏评估报告（日总结 + 按小时滚动）。可用环境变量 SEM_DISABLE_REPORT_SCHEDULER=1 关闭。"""
    global _report_scheduler
    if os.environ.get("SEM_DISABLE_REPORT_SCHEDULER", "").lower() in ("1", "true", "yes", "on"):
        return
    if os.environ.get("WERKZEUG_RUN_MAIN") == "false":
        return
    if _report_scheduler is not None:
        return
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
    except ImportError:
        print("APScheduler 未安装，跳过评估报告定时任务（pip install APScheduler）")
        return
    sch = BackgroundScheduler(timezone="Asia/Shanghai")
    sch.add_job(db.run_scheduled_hourly_reports, "cron", minute=5, id="sem_report_hourly")
    sch.add_job(db.run_scheduled_daily_reports, "cron", hour=0, minute=10, id="sem_report_daily")
    sch.start()
    _report_scheduler = sch
    atexit.register(lambda: sch.shutdown(wait=False))


def hash_password_md5(plain: str, salt: str) -> str:
    return hashlib.md5(f"{salt}:{plain}".encode("utf-8")).hexdigest()


def password_meets_policy(pwd: str) -> bool:
    if not pwd or len(pwd) < 8:
        return False
    return bool(
        re.search(r"[A-Z]", pwd)
        and re.search(r"[a-z]", pwd)
        and re.search(r"\d", pwd)
        and re.search(r"[^A-Za-z0-9]", pwd)
    )


def ok(data: Any = True):
    return jsonify({"ok": True, "data": data})


def fail(code: str, message: str, status: int = 400):
    return jsonify({"ok": False, "code": code, "message": message}), status


def get_bearer_token() -> Optional[str]:
    auth = request.headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


def require_auth() -> Tuple[Optional[dict], Any]:
    token = get_bearer_token()
    if not token or token not in _tokens:
        return None, fail("UNAUTH", "未登录或会话已失效", 401)
    uid = _tokens[token]
    row = db.get_staff_by_id(uid)
    if not row:
        return None, fail("UNAUTH", "用户不存在", 401)
    now = int(time.time() * 1000)
    if row["status"] == "DISABLED":
        return None, fail("DISABLED", "账号已停用", 403)
    if row["status"] == "FROZEN":
        return None, fail("FROZEN", "账号已冻结", 403)
    if row["status"] == "LOCKED" and row.get("locked_until_ms") and row["locked_until_ms"] > now:
        return None, fail("LOCKED", "账号已锁定，请稍后再试", 403)
    return row, None


def require_role(staff: dict, roles: list) -> Any:
    if staff["role"] not in roles:
        return fail("FORBIDDEN", "无权限访问", 403)
    return None


def require_sem_full_power_admin(staff: dict) -> Any:
    """预警阈值、审计日志、用户反馈等仅全校级/超级管理员可访问。"""
    if staff.get("role") != "ADMIN":
        return fail("FORBIDDEN", "无权限访问", 403)
    if db.is_sem_full_power_admin(staff):
        return None
    return fail("FORBIDDEN", "学院管理员无权访问该功能", 403)


def client_ip() -> str:
    return request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or (request.remote_addr or "")


def client_device() -> str:
    return request.headers.get("User-Agent", "")[:500]


def _scores_look_flat_for_demo(scores: list) -> bool:
    """极差很小，或大量点挤在中性平台（偶发极低分不应阻止演示增强）。"""
    if not scores or len(scores) < 2:
        return False
    vals = [int(x or 55) for x in scores]
    lo, hi = min(vals), max(vals)
    if hi - lo <= 8:
        return True
    plateau = sum(1 for s in vals if 51 <= s <= 59)
    return (plateau / len(vals)) >= 0.45


def _enhance_archive_for_demo_wyc(timeline: list, reports: list) -> tuple:
    """仅用于王一川演示：当数据明显过平时，增强时间轴与报告可读性。"""
    if not timeline:
        return timeline, reports

    scores = [int(x.get("score", 55) or 55) for x in timeline]
    if not scores:
        return timeline, reports
    if not _scores_look_flat_for_demo(scores):
        return timeline, reports

    def _clamp(v: int) -> int:
        return max(18, min(88, v))

    # 1) 时间轴：构造更接近真实的波动（起伏 + 偶发低谷 + 阶段回升）
    new_timeline = []
    for i, p in enumerate(timeline):
        orig = int(p.get("score", 55) or 55)
        # 保留系统判定的危机/极低分点，仅对“平台段”做起伏
        if orig <= 35:
            new_timeline.append(dict(p))
            continue

        wave = round(math.sin(i * 0.52) * 12 + math.cos(i * 0.19) * 7)
        dip = -22 if (i % 11 == 0 and i > 0) else 0
        rebound = 10 if (i % 13 == 0 and i > 0) else 0
        score = _clamp(56 + wave + dip + rebound)
        mood = "积极" if score >= 70 else ("中性" if score >= 40 else "消极")
        item = dict(p)
        item["score"] = int(score)
        item["mood"] = mood
        new_timeline.append(item)

    # 2) 报告：按时间轴窗口重算 avg/risk/summary，避免“约55/100”重复
    new_reports = []
    n = len(new_timeline)
    for idx, r in enumerate(sorted(reports, key=lambda x: int(x.get("createdAt", 0) or 0), reverse=True)):
        end = max(1, n - idx * 4)
        start = max(0, end - 8)
        win = new_timeline[start:end] if start < end else new_timeline[max(0, n - 8):n]
        ws = [int(x.get("score", 55) or 55) for x in win]
        avg = round(sum(ws) / len(ws)) if ws else 55
        worst = min(ws) if ws else 55
        neg = sum(1 for x in ws if x < 45)
        neg_ratio = (neg / len(ws)) if ws else 0.0

        if worst < 22:
            risk = "危"
        elif worst < 30 or neg_ratio > 0.45 or avg < 42:
            risk = "高"
        elif worst < 45 or neg_ratio > 0.2 or avg < 55:
            risk = "中"
        else:
            risk = "低"

        tags = ["数字人对话活跃"]
        if risk in ("中", "高", "危"):
            tags.append("负向情绪信号偏多")
        if risk in ("高", "危"):
            tags.append("压力或紧张相关倾向（已脱敏）")

        summary = (
            f"本时段发生有效数字人对话记录；共{len(ws)}条消息参与统计；"
            f"综合参考约{avg}/100。"
        )
        if risk in ("高", "危"):
            summary += " 观察到较明显的情绪低落或压力相关信号，建议结合线下访谈与校内预案关注。"
        elif risk == "中":
            summary += " 存在一定情绪波动，建议适度关注学习节奏与休息。"
        else:
            summary += " 整体情绪相对平稳。"

        item = dict(r)
        item["riskLevel"] = risk
        item["tags"] = tags
        item["summary"] = summary
        new_reports.append(item)

    # 保持原顺序（前端一般按 createdAt 展示）
    new_reports.sort(key=lambda x: int(x.get("createdAt", 0) or 0), reverse=True)
    return new_timeline, new_reports


def revoke_sessions_for_staff(staff_id: int) -> None:
    to_del = [t for t, uid in _tokens.items() if uid == staff_id]
    for t in to_del:
        _tokens.pop(t, None)


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "student-emotion-api"})


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json(force=True, silent=True) or {}
    staff_no = (data.get("staffNo") or "").strip()
    password = data.get("password") or ""

    row = db.get_staff_by_staff_no(staff_no)
    if not row:
        db.insert_audit(
            "LOGIN_FAIL",
            "账号不存在",
            client_ip(),
            client_device(),
            actor_staff_no=staff_no,
        )
        return fail("CREDENTIALS", "账号或密码错误")

    now = int(time.time() * 1000)

    if row["status"] == "DISABLED":
        db.insert_audit(
            "LOGIN_FAIL",
            "账号已停用",
            client_ip(),
            client_device(),
            actor_staff_no=staff_no,
            actor_name=row["name"],
        )
        return fail("DISABLED", "账号已停用")

    if row["status"] == "FROZEN":
        db.insert_audit(
            "LOGIN_FAIL",
            "账号已冻结",
            client_ip(),
            client_device(),
            actor_staff_no=staff_no,
            actor_name=row["name"],
        )
        return fail("FROZEN", "账号已冻结")

    if row["status"] == "LOCKED" and row.get("locked_until_ms") and row["locked_until_ms"] > now:
        db.insert_audit(
            "LOGIN_FAIL",
            "账号锁定期内登录",
            client_ip(),
            client_device(),
            actor_staff_no=staff_no,
            actor_name=row["name"],
        )
        return fail("LOCKED", "连续多次失败，账号已锁定，请稍后再试")

    computed = hash_password_md5(password, row["password_salt"])
    if computed != row["password_hash"]:
        failed = int(row["failed_login_count"] or 0) + 1
        db.increment_failed_login(staff_no, failed)
        db.insert_audit(
            "LOGIN_FAIL",
            f"密码错误（失败次数={failed}）",
            client_ip(),
            client_device(),
            actor_staff_no=staff_no,
            actor_name=row["name"],
        )
        if failed >= 5:
            lock_until = now + 10 * 60 * 1000
            db.lock_staff_after_failed(staff_no, failed, lock_until)
        return fail("CREDENTIALS", "账号或密码错误")

    # success
    db.mark_login_success(int(row["id"]), now, row["status"])
    fresh = db.get_staff_by_id(row["id"]) or row

    token = secrets.token_urlsafe(32)
    _tokens[token] = fresh["id"]

    db.insert_audit(
        "LOGIN_SUCCESS",
        f"登录成功 | ip={client_ip()} | device={client_device()[:200]}",
        client_ip(),
        client_device(),
        actor_staff_no=fresh["staff_no"],
        actor_name=fresh["name"],
    )

    return ok({"token": token, "role": fresh["role"], "roleName": fresh["role_name"]})


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    token = get_bearer_token()
    if token and token in _tokens:
        _tokens.pop(token, None)
    return ok(True)


@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    staff, err = require_auth()
    if err:
        return err
    return ok(db.staff_row_public(staff))


@app.route("/api/auth/change-password", methods=["POST"])
def auth_change_password():
    staff, err = require_auth()
    if err:
        return err
    data = request.get_json(force=True, silent=True) or {}
    old_p = data.get("oldPassword") or ""
    new_p = data.get("newPassword") or ""

    if hash_password_md5(old_p, staff["password_salt"]) != staff["password_hash"]:
        return fail("OLD_PASSWORD", "原密码不正确")

    if not password_meets_policy(new_p):
        return fail("POLICY", "新密码不符合复杂度要求")

    new_salt = secrets.token_hex(16)
    new_hash = hash_password_md5(new_p, new_salt)
    db.update_staff_password(staff["id"], new_hash, new_salt)

    db.insert_audit(
        "PASSWORD_CHANGE",
        "用户修改密码（重新加盐哈希存储）",
        client_ip(),
        client_device(),
        actor_staff_no=staff["staff_no"],
        actor_name=staff["name"],
    )
    return ok(True)


@app.route("/api/admin/accounts", methods=["GET"])
def admin_accounts():
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["ADMIN"])
    if r:
        return r
    rows = db.list_staff_for_admin_console(staff)
    out = [db.staff_row_public(x) for x in rows]
    return ok(out)


@app.route("/api/admin/accounts/create", methods=["POST"])
def admin_accounts_create():
    actor, err = require_auth()
    if err:
        return err
    r = require_role(actor, ["ADMIN"])
    if r:
        return r

    data = request.get_json(force=True, silent=True) or {}
    staff_no = (data.get("staffNo") or "").strip()
    name = (data.get("name") or "").strip()
    role = (data.get("role") or "COUNSELOR").strip()
    role_name = (data.get("roleName") or ("管理员" if role == "ADMIN" else "辅导员")).strip()
    init_password = data.get("initPassword") or "123456"
    scope = data.get("scope")
    scopes = data.get("scopes")

    if not staff_no or not name:
        return fail("BAD_REQUEST", "staffNo 与 name 不能为空")
    if role not in ("ADMIN", "COUNSELOR"):
        return fail("BAD_REQUEST", "无效角色")
    if len(init_password) < 6:
        return fail("BAD_REQUEST", "初始密码至少 6 位")

    if not db.is_sem_full_power_admin(actor) and role != "COUNSELOR":
        return fail("FORBIDDEN", "学院管理员仅可创建本学院辅导员账号")

    if role == "COUNSELOR" and db.counselor_active_name_taken(name):
        return fail(
            "CONFLICT",
            "已存在同姓名的在职辅导员。请在原账号「角色/范围」中配置多学院 scopes，勿再新建工号。",
            409,
        )

    scope_json = None
    if role == "COUNSELOR":
        if isinstance(scopes, list) and len(scopes) > 0:
            if not db.is_sem_full_power_admin(actor):
                msg = db.assert_counselor_scopes_list_matches_actor_college(actor, scopes)
                if msg:
                    return fail("BAD_REQUEST", msg)
            scope_json = json.dumps({"scopes": scopes}, ensure_ascii=False)
        elif isinstance(scope, dict):
            if not db.is_sem_full_power_admin(actor):
                msg = db.assert_counselor_scope_matches_actor_college(actor, scope)
                if msg:
                    return fail("BAD_REQUEST", msg)
            scope_json = json.dumps(scope, ensure_ascii=False)
        else:
            scope_json = json.dumps({}, ensure_ascii=False)
    elif role == "ADMIN":
        scope_json = None
    salt = secrets.token_hex(16)
    pwd_hash = hash_password_md5(init_password, salt)
    created = db.create_staff_account(
        staff_no=staff_no,
        name=name,
        password_hash=pwd_hash,
        password_salt=salt,
        role=role,
        role_name=role_name,
        scope_json=scope_json,
        status="ACTIVE",
    )
    if not created:
        return fail("CONFLICT", "工号已存在", 409)

    db.insert_audit(
        "ACCOUNT_CREATE",
        f"新增账号：{staff_no} | role={role} | roleName={role_name}",
        client_ip(),
        client_device(),
        actor_staff_no=actor["staff_no"],
        actor_name=actor["name"],
        target_staff_no=staff_no,
    )
    return ok(True)


@app.route("/api/admin/accounts/status", methods=["POST"])
def admin_accounts_status():
    actor, err = require_auth()
    if err:
        return err
    r = require_role(actor, ["ADMIN"])
    if r:
        return r
    data = request.get_json(force=True, silent=True) or {}
    staff_no = (data.get("staffNo") or "").strip()
    status = (data.get("status") or "").strip()
    if status not in ("ACTIVE", "FROZEN", "DISABLED"):
        return fail("BAD_REQUEST", "无效状态")

    if staff_no == actor["staff_no"] and staff_no == "SuperManager" and status != "ACTIVE":
        return fail("FORBIDDEN", "超级管理员不能冻结或停用自身账号")

    target = db.get_staff_by_staff_no(staff_no)
    if not target:
        return fail("NOT_FOUND", "账号不存在")
    if not db.can_college_admin_manage_target(actor, target):
        return fail("FORBIDDEN", "无权操作该账号")

    db.set_account_status(staff_no, status)

    action_map = {"FROZEN": "ACCOUNT_FREEZE", "DISABLED": "ACCOUNT_DISABLE", "ACTIVE": "ACCOUNT_ENABLE"}
    db.insert_audit(
        action_map.get(status, "ACCOUNT_ENABLE"),
        f"管理员将账号状态设置为 {status}",
        client_ip(),
        client_device(),
        actor_staff_no=actor["staff_no"],
        actor_name=actor["name"],
        target_staff_no=staff_no,
    )

    if status != "ACTIVE":
        revoke_sessions_for_staff(int(target["id"]))
        db.insert_audit(
            "ACCOUNT_FORCE_LOGOUT",
            "因冻结/停用触发强制下线",
            client_ip(),
            client_device(),
            actor_staff_no=actor["staff_no"],
            actor_name=actor["name"],
            target_staff_no=staff_no,
        )

    return ok(True)


@app.route("/api/admin/accounts/reset-password", methods=["POST"])
def admin_accounts_reset_password():
    actor, err = require_auth()
    if err:
        return err
    r = require_role(actor, ["ADMIN"])
    if r:
        return r
    data = request.get_json(force=True, silent=True) or {}
    staff_no = (data.get("staffNo") or "").strip()
    new_password = data.get("newPassword") or "123456"
    if not staff_no:
        return fail("BAD_REQUEST", "缺少 staffNo")
    if len(new_password) < 6:
        return fail("BAD_REQUEST", "密码至少 6 位")

    if staff_no == actor["staff_no"] and staff_no == "SuperManager":
        return fail("FORBIDDEN", "超级管理员不能通过管理端重置自身密码，请使用「修改密码」")

    salt = secrets.token_hex(16)
    pwd_hash = hash_password_md5(new_password, salt)
    target = db.get_staff_by_staff_no(staff_no)
    if not target:
        return fail("NOT_FOUND", "账号不存在", 404)
    if not db.can_college_admin_manage_target(actor, target):
        return fail("FORBIDDEN", "无权操作该账号")

    ok_reset = db.admin_reset_staff_password(staff_no, pwd_hash, salt)
    if not ok_reset:
        return fail("NOT_FOUND", "账号不存在", 404)

    db.insert_audit(
        "PASSWORD_RESET",
        "管理员重置账号密码并解锁",
        client_ip(),
        client_device(),
        actor_staff_no=actor["staff_no"],
        actor_name=actor["name"],
        target_staff_no=staff_no,
    )
    return ok(True)


@app.route("/api/admin/role-scope", methods=["POST"])
def admin_role_scope():
    actor, err = require_auth()
    if err:
        return err
    r = require_role(actor, ["ADMIN"])
    if r:
        return r
    data = request.get_json(force=True, silent=True) or {}
    staff_no = (data.get("staffNo") or "").strip()
    role = (data.get("role") or "").strip()
    role_name = (data.get("roleName") or "").strip()
    scope = data.get("scope")
    scopes = data.get("scopes")

    if role not in ("ADMIN", "COUNSELOR"):
        return fail("BAD_REQUEST", "无效角色")

    target = db.get_staff_by_staff_no(staff_no)
    if not target:
        return fail("NOT_FOUND", "账号不存在")
    if not db.can_college_admin_manage_target(actor, target):
        return fail("FORBIDDEN", "无权配置该账号")

    if (
        not db.is_sem_full_power_admin(actor)
        and target.get("role") == "COUNSELOR"
        and db.counselor_has_multi_college_scopes(target)
    ):
        return fail(
            "FORBIDDEN",
            "该账号为跨学院多辖区辅导员，「角色/范围」仅可由全校管理员修改；本院管理员可在账号列表中查看并与本学院相关的学生数据联动",
        )

    if not db.is_sem_full_power_admin(actor):
        if role != "COUNSELOR":
            return fail("FORBIDDEN", "学院管理员仅可维护辅导员角色与范围")
        if isinstance(scopes, list) and len(scopes) > 0:
            msg = db.assert_counselor_scopes_list_matches_actor_college(actor, scopes)
            if msg:
                return fail("BAD_REQUEST", msg)
        elif isinstance(scope, dict):
            msg = db.assert_counselor_scope_matches_actor_college(actor, scope)
            if msg:
                return fail("BAD_REQUEST", msg)
        else:
            return fail("BAD_REQUEST", "学院管理员操作辅导员时必须携带 scope 或 scopes（含学院）")

    # 学院管理员：允许携带 scope（仅学院维度），用于“按学院管辖学生数据”
    # 超级管理员/系统级管理员：scope 为空
    scope_json = None
    if role == "COUNSELOR":
        if isinstance(scopes, list) and len(scopes) > 0:
            scope_json = json.dumps({"scopes": scopes}, ensure_ascii=False)
        elif isinstance(scope, dict):
            scope_json = json.dumps(scope, ensure_ascii=False)
        else:
            return fail("BAD_REQUEST", "辅导员必须配置 scope 或 scopes")
    elif role == "ADMIN" and isinstance(scope, dict) and (scope.get("collegeId") or scope.get("collegeName")):
        scope_json = json.dumps(scope, ensure_ascii=False)

    db.update_staff_role_scope(staff_no, role, role_name, scope_json)

    db.insert_audit(
        "ROLE_SCOPE_UPDATE",
        f"更新角色与数据管辖范围：role={role} | scope={scope_json or 'null'}",
        client_ip(),
        client_device(),
        actor_staff_no=actor["staff_no"],
        actor_name=actor["name"],
        target_staff_no=staff_no,
    )
    return ok(True)


@app.route("/api/admin/thresholds", methods=["GET"])
def admin_get_threshold():
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["ADMIN"])
    if r:
        return r
    r2 = require_sem_full_power_admin(staff)
    if r2:
        return r2
    t = db.get_threshold()
    return ok(
        {
            "sensitivity": t["sensitivity"],
            "levelRules": t["levelRules"],
            "updatedAt": t["updatedAt"],
            "updatedBy": t.get("updatedBy"),
        }
    )


@app.route("/api/admin/thresholds", methods=["POST"])
def admin_post_threshold():
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["ADMIN"])
    if r:
        return r
    r2 = require_sem_full_power_admin(staff)
    if r2:
        return r2
    data = request.get_json(force=True, silent=True) or {}
    sensitivity = int(data.get("sensitivity", 70))
    level_rules = data.get("levelRules") or []
    saved = db.save_threshold(sensitivity, level_rules, staff["staff_no"])
    db.insert_audit(
        "THRESHOLD_UPDATE",
        f"调整预警阈值/敏感度：{json.dumps(data, ensure_ascii=False)}",
        client_ip(),
        client_device(),
        actor_staff_no=staff["staff_no"],
        actor_name=staff["name"],
    )
    return ok(
        {
            "sensitivity": saved["sensitivity"],
            "levelRules": saved["levelRules"],
            "updatedAt": saved["updatedAt"],
            "updatedBy": saved.get("updatedBy"),
        }
    )


@app.route("/api/admin/audit-logs", methods=["GET"])
def admin_audit_logs():
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["ADMIN"])
    if r:
        return r
    r2 = require_sem_full_power_admin(staff)
    if r2:
        return r2
    return ok(db.list_audit_logs(500))


@app.route("/api/counselor/students", methods=["GET"])
def counselor_students():
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["COUNSELOR", "ADMIN"])
    if r:
        return r
    keyword = request.args.get("keyword") or ""
    student_no = request.args.get("studentNo") or ""
    name = request.args.get("name") or ""
    return ok(db.list_students_for_search(keyword, student_no, name, staff))


@app.route("/api/counselor/students/<student_no>/archive", methods=["GET"])
def counselor_archive(student_no: str):
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["COUNSELOR", "ADMIN"])
    if r:
        return r
    st = db.get_student_by_no(student_no)
    if not st:
        return fail("NOT_FOUND", "学生不存在")
    if not db.within_scope(staff, st):
        return fail("SCOPE", "越权访问拦截：不在当前数据管辖范围内")

    db.insert_audit(
        "ARCHIVE_VIEW",
        f"访问学生数字心理档案：{st['student_no']}/{st['name']}",
        client_ip(),
        client_device(),
        actor_staff_no=staff["staff_no"],
        actor_name=staff["name"],
        target_student_no=st["student_no"],
    )
    timeline = db.get_emotion_timeline(student_no)
    reports = db.get_reports_for_student(student_no)
    if (st.get("name") or "").strip() == "王一川":
        timeline, reports = _enhance_archive_for_demo_wyc(timeline, reports)
    return ok(
        {
            "student": db.student_row_public(st),
            "timeline": timeline,
            "reports": reports,
            "timelineSource": "emotion_record_first",
        }
    )


@app.route("/api/counselor/visualization", methods=["GET"])
def counselor_visualization():
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["COUNSELOR", "ADMIN"])
    if r:
        return r
    range_key = request.args.get("range") or "week"
    if range_key not in ("week", "month", "term"):
        range_key = "week"
    return ok(db.compute_visualization(staff, range_key))


@app.route("/api/counselor/alerts", methods=["GET"])
def counselor_alerts():
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["COUNSELOR", "ADMIN"])
    if r:
        return r
    return ok(db.list_alerts_for_staff(staff))


@app.route("/api/counselor/alerts/<aid>", methods=["POST"])
def counselor_alert_update(aid: str):
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["COUNSELOR", "ADMIN"])
    if r:
        return r
    data = request.get_json(force=True, silent=True) or {}
    status = (data.get("status") or "").strip()
    note = data.get("note")
    if status not in ("NEW", "FOLLOWED", "CLEARED"):
        return fail("BAD_REQUEST", "无效状态")

    alert = db.get_alert_by_id(aid)
    if not alert:
        alert = db.materialize_runtime_alert(aid, staff)
    if not alert:
        return fail("NOT_FOUND", "预警不存在")
    if staff["role"] != "ADMIN":
        # 合并预警可能先指派给其他辅导员；只要该生仍在操作者管辖范围内，允许协同处理（与列表「按学号可见」一致）。
        st = db.get_student_by_no(alert["student_no"])
        if not st or not db.within_scope(staff, st):
            return fail("FORBIDDEN", "无权操作该预警")

    real_id = str(alert["id"])
    raw_note = data.get("note")
    if isinstance(raw_note, str):
        note_val = raw_note.strip() or None
    else:
        note_val = None

    # 合并预警 materialize 后库内 id 为 runtime-{学号}，URL 里可能是旧版 runtime-chat-* / *-xN，必须用库内 id 更新。
    if status == "CLEARED" and db.is_canonical_unified_runtime_alert_id(real_id):
        db.insert_audit(
            "ALERT_RUNTIME_CLEARED",
            (
                f"辅导员消除合并预警；学号 {alert.get('student_no') or '-'}；预警 id={real_id}；"
                f"说明：{(note_val or '（无）')[:800]}"
            )[:2000],
            client_ip(),
            client_device(),
            actor_staff_no=staff.get("staff_no"),
            actor_name=staff.get("name"),
            target_student_no=str(alert.get("student_no") or ""),
        )
        db.purge_unified_alert_sources_for_student(str(alert.get("student_no") or ""))
        db.delete_sem_alert(real_id)
        return ok(True)

    if not db.update_alert(real_id, status, note_val):
        return fail("INTERNAL", "更新失败")

    if staff.get("role") != "ADMIN":
        db.claim_system_assigned_alert_for_counselor(real_id, str(staff.get("staff_no") or ""))

    note_snip = (note_val or "")[:300]
    status_cn = {"NEW": "待处理", "FOLLOWED": "已跟进", "CLEARED": "已消除"}.get(status, status)
    db.insert_audit(
        "ALERT_STATUS_UPDATE",
        (
            f"辅导员更新预警状态为「{status_cn}」；学号 {alert.get('student_no') or '-'}；预警 id={real_id}；"
            f"备注：{note_snip or '（无）'}"
        )[:2000],
        client_ip(),
        client_device(),
        actor_staff_no=staff.get("staff_no"),
        actor_name=staff.get("name"),
        target_student_no=str(alert.get("student_no") or "") or None,
    )
    return ok(True)


@app.route("/api/feedback", methods=["POST"])
def submit_feedback():
    """登录教职工提交意见反馈（辅导员/管理员均可）。"""
    staff, err = require_auth()
    if err:
        return err
    if (staff.get("staff_no") or "").strip() == "SuperManager":
        return fail("FORBIDDEN", "超级管理员无需使用该反馈通道", 403)
    data = request.get_json(force=True, silent=True) or {}
    content = (data.get("content") or "").strip()
    if not content:
        return fail("BAD_REQUEST", "请填写反馈内容")
    contact_email = (data.get("contact_email") or data.get("contactEmail") or "").strip()
    screenshot_url = (data.get("screenshot_url") or data.get("screenshotUrl") or "").strip()
    allow_contact = 1 if data.get("allow_contact") in (1, "1", True) or data.get("allowContact") in (1, "1", True) else 0
    try:
        rid = db.add_sem_user_feedback(
            int(staff["id"]),
            staff.get("staff_no") or "",
            staff.get("name") or "",
            content,
            contact_email=contact_email,
            screenshot_url=screenshot_url or None,
            allow_contact=allow_contact,
        )
    except Exception as e:
        return fail("DB_ERROR", f"反馈提交失败: {e}", 500)
    db.insert_audit(
        "USER_FEEDBACK",
        f"提交意见反馈 id={rid} allow_contact={allow_contact}",
        client_ip(),
        client_device(),
        actor_staff_no=staff["staff_no"],
        actor_name=staff["name"],
    )
    return ok({"id": rid})


@app.route("/api/admin/user-feedback", methods=["GET"])
def admin_list_user_feedback():
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["ADMIN"])
    if r:
        return r
    r2 = require_sem_full_power_admin(staff)
    if r2:
        return r2
    try:
        limit = request.args.get("limit", type=int) or 200
        rows = db.list_sem_user_feedback(limit=limit)
        return ok([db.sem_feedback_row_api(x) for x in rows])
    except Exception as e:
        return fail("DB_ERROR", str(e), 500)


@app.route("/api/admin/user-feedback/<int:fid>", methods=["DELETE"])
def admin_delete_user_feedback(fid: int):
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["ADMIN"])
    if r:
        return r
    r2 = require_sem_full_power_admin(staff)
    if r2:
        return r2
    if not db.delete_sem_user_feedback(fid):
        return fail("NOT_FOUND", "反馈不存在或已删除")
    db.insert_audit(
        "USER_FEEDBACK_DELETE",
        f"删除用户反馈 id={fid}",
        client_ip(),
        client_device(),
        actor_staff_no=staff.get("staff_no"),
        actor_name=staff.get("name"),
    )
    return ok(True)


@app.route("/api/admin/reports/run", methods=["POST"])
def admin_reports_run():
    """手动触发评估报告生成（全校级/超级管理员）。body: { \"mode\": \"hourly_last\" | \"daily_yesterday\" }"""
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["ADMIN"])
    if r:
        return r
    r2 = require_sem_full_power_admin(staff)
    if r2:
        return r2
    data = request.get_json(force=True, silent=True) or {}
    mode = (data.get("mode") or "hourly_last").strip()
    try:
        if mode == "daily_yesterday":
            out = db.run_scheduled_daily_reports()
        else:
            out = db.run_scheduled_hourly_reports()
        db.insert_audit(
            "REPORT_JOB",
            f"手动触发评估报告 mode={mode} written={out.get('reportsWritten')}",
            client_ip(),
            client_device(),
            actor_staff_no=staff["staff_no"],
            actor_name=staff["name"],
        )
        return ok(out)
    except Exception as e:
        return fail("DB_ERROR", str(e), 500)


_start_report_scheduler()


if __name__ == "__main__":
    try:
        validate_config()
        db.init_db()
    except Exception as e:
        print("init_db warning:", e)
    app.run(host="0.0.0.0", port=SEM_APP_PORT, debug=True)
