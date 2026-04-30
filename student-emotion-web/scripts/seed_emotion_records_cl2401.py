#!/usr/bin/env python3
"""
向「软件工程」CL2401 班（sem_student.class_id = CL2401）学生随机插入 30 条 emotion_record。
需在可连 MySQL 的环境运行；读取与后端相同的 .env / config。
"""
import os
import random
import sys
from datetime import timedelta

# 与后端同目录，便于加载 config / database
_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, _BACKEND)
os.chdir(_BACKEND)

import database as db  # noqa: E402

# 与人脸识别词表一致，覆盖积极 / 消极 / 中性（未命中词表则中性）
_EMOTION_POOL = [
    ("happy", 0.82),
    ("happiness", 0.78),
    ("joy", 0.85),
    ("高兴", 0.8),
    ("surprise", 0.77),
    ("excited", 0.86),
    ("positive", 0.88),
    ("开心", 0.9),
    ("愉快", 0.84),
    ("惊喜", 0.81),
    ("sad", 0.72),
    ("sadness", 0.68),
    ("悲伤", 0.75),
    ("焦虑", 0.7),
    ("生气", 0.65),
    ("angry", 0.62),
    ("anger", 0.64),
    ("愤怒", 0.67),
    ("fear", 0.55),
    ("恐惧", 0.52),
    ("disgust", 0.58),
    ("negative", 0.6),
    ("难过", 0.73),
    ("depressed", 0.66),
    ("neutral", 0.45),
    ("平静", 0.48),
    ("calm", 0.47),
    ("neutral_face", 0.5),
    ("中性", 0.46),
    ("unknown_label_xyz", 0.5),
]


def main() -> None:
    if not db._table_exists("emotion_record"):
        print("emotion_record 表不存在，跳过。")
        sys.exit(1)
    if not db._table_exists("sem_student"):
        print("sem_student 表不存在，跳过。")
        sys.exit(1)

    rows = db._safe_fetchall(
        """SELECT student_no, name, class_id, class_name, major
           FROM sem_student
           WHERE class_id = %s
             AND major LIKE %s
             AND (class_name LIKE %s OR class_name LIKE %s)
             AND IFNULL(class_name, '') NOT LIKE %s
             AND IFNULL(class_name, '') NOT LIKE %s
           ORDER BY student_no""",
        ("CL2401", "%软件%", "%2401%", "%软工2401%", "%2402%", "%软工2402%"),
    )
    if not rows:
        print("未找到「软件工程 + CL2401 + 班级名含2401且不含2402」的学生，请核对 sem_student。")
        sys.exit(1)

    students = rows
    n_stu = len(students)
    random.shuffle(_EMOTION_POOL)
    pairs = list(_EMOTION_POOL[:30])
    while len(pairs) < 30:
        pairs.append(random.choice(_EMOTION_POOL))

    now = db.dt.datetime.now()
    inserted = 0
    with db.get_connection() as conn:
        with conn.cursor() as cur:
            for i in range(30):
                et, base_int = pairs[i % len(pairs)]
                intensity = round(min(0.99, max(0.05, base_int + random.uniform(-0.08, 0.08))), 2)
                stu = students[i % n_stu]
                sid = str(stu["student_no"]).strip()
                # 近 14 天内随机时刻，避免全挤在同一天
                delta_days = random.uniform(0, 14)
                delta_hours = random.uniform(0, 23)
                ts = now - timedelta(days=delta_days, hours=delta_hours, minutes=random.randint(0, 59))
                cur.execute(
                    """INSERT INTO emotion_record
                       (student_id, emotion_type, intensity, timestamp, is_deleted, deleted_at)
                       VALUES (%s, %s, %s, %s, 0, NULL)""",
                    (sid, et[:64], intensity, ts.strftime("%Y-%m-%d %H:%M:%S")),
                )
                inserted += int(cur.rowcount or 0)
        conn.commit()

    print(f"已为 CL2401（软件工程）共 {n_stu} 名学生插入 {inserted} 条 emotion_record。")
    for r in students[:5]:
        print(f"  - {r['student_no']} {r.get('name')} | {r.get('major')} | {r.get('class_name')}")
    if n_stu > 5:
        print(f"  ... 共 {n_stu} 人")


if __name__ == "__main__":
    main()
