#!/usr/bin/env python3
"""
为几名「软工2401 / 软件工程」学生各插入多条近 7 天内、emotion_type 映射为「消极」的 emotion_record，
使近 7 天人脸消极条数 ≥4（合并预警阈值 total≥3），便于验证首页预警与列表。

用法：在可连 MySQL 的环境执行
  python3 scripts/seed_force_alert_threshold_students.py
"""
import os
import sys
from datetime import timedelta

_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, _BACKEND)
os.chdir(_BACKEND)

import database as db  # noqa: E402

# 均映射为「消极」心境（与 database._mood_from_emotion_label 一致）
NEG_LABELS = ("sad", "悲伤", "焦虑", "anger", "难过")

# 取前 N 名该班学生（可按需改 student_no 列表）
COUNT_STUDENTS = 4
# 每人插入条数（≥3 即触发合并预警）
ROWS_PER_STUDENT = 5


def _pick_students():
    rows = db._safe_fetchall(
        """SELECT student_no, name, class_name, major
           FROM sem_student
           WHERE class_id = %s
             AND major LIKE %s
             AND (class_name LIKE %s OR class_name LIKE %s)
             AND IFNULL(class_name, '') NOT LIKE %s
             AND IFNULL(class_name, '') NOT LIKE %s
           ORDER BY student_no
           LIMIT %s""",
        ("CL2401", "%软件%", "%2401%", "%软工2401%", "%2402%", "%软工2402%", COUNT_STUDENTS),
    )
    return rows or []


def main() -> None:
    if not db._table_exists("emotion_record"):
        print("emotion_record 不存在")
        sys.exit(1)
    students = _pick_students()
    if len(students) < 1:
        print("未找到学生")
        sys.exit(1)

    now = db.dt.datetime.now()
    total_ins = 0
    with db.get_connection() as conn:
        with conn.cursor() as cur:
            for si, stu in enumerate(students):
                sid = str(stu["student_no"]).strip()
                for j in range(ROWS_PER_STUDENT):
                    et = NEG_LABELS[j % len(NEG_LABELS)]
                    intensity = round(0.62 + (j * 0.03) + si * 0.01, 2)
                    intensity = min(0.92, max(0.55, intensity))
                    hours_ago = j * 18 + si * 3
                    ts = now - timedelta(hours=hours_ago, minutes=j * 7 + si)
                    cur.execute(
                        """INSERT INTO emotion_record
                           (student_id, emotion_type, intensity, timestamp, is_deleted, deleted_at)
                           VALUES (%s, %s, %s, %s, 0, NULL)""",
                        (sid, et, intensity, ts.strftime("%Y-%m-%d %H:%M:%S")),
                    )
                    total_ins += int(cur.rowcount or 0)
        conn.commit()

    print(f"已为 {len(students)} 名学生各插入 {ROWS_PER_STUDENT} 条「消极」人脸记录（共 {total_ins} 条）。")
    for stu in students:
        print(f"  - {stu['student_no']} {stu.get('name')} {stu.get('class_name')}")
    print("请刷新辅导员「主页总览」与「预警与干预」查看合并预警是否出现/更新。")


if __name__ == "__main__":
    main()
