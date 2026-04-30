# 数据库脚本说明（宝塔 `emo_system`）

## 后端实际连哪张表？

应用通过 **`config.py` 读取环境变量 `MYSQL_*`**（建议在项目根目录 `/root/emo_detect/.env` 配置），与宝塔里创建的数据库名、用户名一致即可，例如：

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=emo_system
MYSQL_USER=emo_system
MYSQL_PASSWORD=你的密码
```

**无需改 Python 业务代码**，`database.py` 已按上述表名读写。

---

## 一键建表（推荐，与代码完全一致）

在服务器上：

```bash
cd /root/emo_detect/EmoDetect-DigitalMan/backend
python3 -c "import database; database.init_db()"
```

或在宝塔 **phpMyAdmin** 选中数据库 `emo_system` → **导入**：

- `apply_emo_system_full_schema.sql`（**推荐**：与 `database.py` 中 `init_db()` 一致，含全部业务表）

---

## 各文件用途

| 文件 | 用途 |
|------|------|
| **apply_emo_system_full_schema.sql** | 在已有 `emo_system` 库中创建全部表（`CREATE TABLE IF NOT EXISTS`），与当前后端一致。 |
| create_users.sql / create_emotion_labels.sql | 历史拆分脚本，仅含部分表；已被 `apply_emo_system_full_schema.sql` 覆盖。 |
| init_mysql_user.sql | **需 root 执行**：创建库、用户 `emo_system` 及密码。宝塔已建好库时一般**不必再执行**。 |
| init_mysql_db_emo_system2.sql | 创建**另一个库** `emo_system2`，主项目默认**不用**。 |
| migration_legacy_to_v2.sql | **仅在有旧版 student/emotion_record 数据需迁移时**手工执行；新环境不要跑。 |

---

## 命令行导入示例

```bash
mysql -h127.0.0.1 -u emo_system -p emo_system < backend/sql/apply_emo_system_full_schema.sql
```

或使用项目内脚本（会读 `.env`）：

```bash
bash EmoDetect-DigitalMan/scripts/apply_schema_mysql.sh
```

---

## 出现 1045 Access denied

确认 `.env` 里 `MYSQL_USER` / `MYSQL_PASSWORD` 与宝塔面板中该数据库账号一致，且 `MYSQL_DATABASE=emo_system`。
