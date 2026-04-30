"""MySQL 与运行配置（与 EmoDetect-DigitalMan 同库时可共用环境变量）。"""
import os

try:
    from dotenv import load_dotenv

    _here = os.path.dirname(os.path.abspath(__file__))
    # 优先读取 student-emotion-web 项目根目录 .env（backend 的上一级）。
    load_dotenv(os.path.join(_here, "..", ".env"))
    # 兼容 backend 目录下单独放置 .env 的场景。
    load_dotenv(os.path.join(_here, ".env"))
except ImportError:
    pass

MYSQL_HOST = os.environ.get("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.environ.get("MYSQL_PORT", "3306"))
MYSQL_DATABASE = os.environ.get("MYSQL_DATABASE", "emo_system")
MYSQL_USER = os.environ.get("MYSQL_USER", "emo_system")
MYSQL_PASSWORD = os.environ.get("MYSQL_PASSWORD", "")
MYSQL_CONNECT_TIMEOUT = int(os.environ.get("MYSQL_CONNECT_TIMEOUT", "5"))
MYSQL_READ_TIMEOUT = int(os.environ.get("MYSQL_READ_TIMEOUT", "10"))
MYSQL_WRITE_TIMEOUT = int(os.environ.get("MYSQL_WRITE_TIMEOUT", "10"))

# 本服务监听端口（与 EmoDetect 默认 5000 区分，可分别部署）
SEM_APP_PORT = int(os.environ.get("SEM_APP_PORT", "5001"))


def validate_config() -> None:
    missing = []
    if not MYSQL_HOST:
        missing.append("MYSQL_HOST")
    if not MYSQL_DATABASE:
        missing.append("MYSQL_DATABASE")
    if not MYSQL_USER:
        missing.append("MYSQL_USER")
    if not MYSQL_PASSWORD:
        missing.append("MYSQL_PASSWORD")
    if missing:
        raise RuntimeError(
            "student-emotion-web 后端缺少必要数据库配置："
            + ", ".join(missing)
            + "。请在项目根 .env 或进程环境变量中补齐后再启动。"
        )
