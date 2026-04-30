# 大模型 API 配置（阿里云 DashScope 兼容模式）
# MySQL 数据库配置（emo_system）
# 格式：mysql+pymysql://用户名:密码@服务器公网IP:3306/数据库名
import os

try:
    from dotenv import load_dotenv

    _here = os.path.dirname(os.path.abspath(__file__))
    # 强制使用 .env 覆盖空环境变量，避免 MYSQL_PASSWORD 被外部空值污染。
    load_dotenv(os.path.join(_here, "..", "..", ".env"), override=True)
    load_dotenv(os.path.join(_here, ".env"), override=True)
except ImportError:
    pass

# SQLAlchemy 连接 URI（供 Flask-SQLAlchemy 等使用）
SQLALCHEMY_DATABASE_URI = os.environ.get(
    "SQLALCHEMY_DATABASE_URI",
    "mysql+pymysql://root:e1f2340ca88560a0@106.14.184.202:3306/emo_system",
)

# 数据库：默认连本机；宝塔创建的库一般为 emo_system / emo_system，密码以 .env 为准
MYSQL_HOST = os.environ.get("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.environ.get("MYSQL_PORT", "3306"))
MYSQL_DATABASE = os.environ.get("MYSQL_DATABASE", "emo_system")
MYSQL_USER = os.environ.get("MYSQL_USER", "emo_system")
MYSQL_PASSWORD = os.environ.get("MYSQL_PASSWORD", "")

# 用于生成/验证 token（生产环境请用环境变量设置随机字符串）
SECRET_KEY = os.environ.get("SECRET_KEY", "emo-system-secret-change-in-production")

# 阿里云 DashScope：仅认环境变量 DASHSCOPE_API_KEY（文本 HTTP 与实时 WebSocket 共用）
DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
API_KEY = DASHSCOPE_API_KEY
CHAT_API_URL = os.environ.get(
    "CHAT_API_URL",
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
)
CHAT_MODEL = os.environ.get("CHAT_MODEL", "qwen3-omni-flash")
MAX_TOKENS = int(os.environ.get("CHAT_MAX_TOKENS", "1024"))

# qwen3-omni-flash 等 Omni 模型：流式对话可同时输出文本 + 音频（保存为 wav 供前端喇叭播放）
CHAT_OMNI_VOICE = os.environ.get("CHAT_OMNI_VOICE", "Cherry")
CHAT_OMNI_AUDIO_FORMAT = os.environ.get("CHAT_OMNI_AUDIO_FORMAT", "wav")
# 流式接口返回的常为原始 PCM16（非 RIFF），封装 WAV 头时使用该采样率（与阿里云文档示例 24kHz 一致）
CHAT_OMNI_SAMPLE_RATE = int(os.environ.get("CHAT_OMNI_SAMPLE_RATE", "24000"))

# 对话人设（HTTP /api/chat、/api/chat/stream；可通过 CHAT_SYSTEM_PROMPT 覆盖）
CHAT_SYSTEM_PROMPT = os.environ.get(
    "CHAT_SYSTEM_PROMPT",
    """你的设定：你是同学们的好朋友小Q。
你的聊天对象：在校大学生
语言风格：
1.简短优先（最重要）
每次回复控制在 1~2句话，最多不超过50字
不主动展开背景、故事或额外信息
不说与用户问题无关的内容
2.自然亲切但不过度表达
语气像朋友，但不要刻意卖萌或表演
避免使用括号补充说明（如“（悄悄说…）”）
不自言自语，不主动讲自己的经历，除非用户问
3.聚焦用户当前输入
用户说什么，就只回应那一件事
不主动引出新话题（除非用于简单追问）
4.建议表达方式（如需要）
用一句简单经验或建议即可
不展开长故事或详细过程
5.禁止行为
禁止编造生活细节（如“刚在图书馆…”）
禁止过度拟人或表演型表达
禁止输出冗长、多段内容
""",
)

# qwen3-omni-flash-realtime：session.update 的 instructions（与上方人设一致；可用 REALTIME_SYSTEM_PROMPT 单独覆盖）
REALTIME_SYSTEM_PROMPT = os.environ.get(
    "REALTIME_SYSTEM_PROMPT",
    CHAT_SYSTEM_PROMPT,
)

# 实时对话（数字人）：WebSocket qwen3-omni-flash-realtime，与聊天框同步输出文本+语音
REALTIME_WS_URL = os.environ.get(
    "REALTIME_WS_URL",
    "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
)
REALTIME_API_KEY = DASHSCOPE_API_KEY
REALTIME_MODEL = os.environ.get("REALTIME_MODEL", "qwen3-omni-flash-realtime")
