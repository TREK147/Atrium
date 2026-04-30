# 人脸 + 七类情绪（后端）

## 流水线

| 组件 | 来源 | 是否需单独下载 |
|------|------|------------------|
| **MTCNN**（检测/对齐） | `facenet-pytorch` 包内 `site-packages/facenet_pytorch/data/{pnet,rnet,onet}.pt` | **否**，随 `pip install facenet-pytorch` |
| **FaceNet 特征** | `InceptionResnetV1(pretrained='vggface2')` | **是**，约 107MB → `TORCH_HOME/checkpoints/20180402-114759-vggface2.pt`（默认 `~/.cache/torch/checkpoints/`） |
| **情绪** | `EmotiEffLibRecognizer(engine='onnx', …)` | **是**，→ `~/.emotiefflib/enet_b0_8_best_vgaf.onnx` |

首次调用 **`POST /api/face/recognize`** 或 **带人脸图的注册** 时，`face_engine.get_engine()` 会按顺序下载缺失文件并加载；**不需要**单独「初始化接口」。

## 依赖（勿漏装）

```bash
cd EmoDetect-DigitalMan/backend
pip install -r requirements.txt
```

其中 **`onnx` + `onnxruntime`** 用于情绪 ONNX；若漏装会在 import 或推理时报错。

## 自检脚本（推荐）

不占用大量内存，只检查 **pip 依赖是否齐**、**磁盘上两类权重是否存在**、**MTCNN 自带文件是否在**：

```bash
python3 check_face_setup.py
```

仅下载权重到磁盘（不写内存里的神经网络，约百兆，需能访问 GitHub）：

```bash
python3 check_face_setup.py --download-models
```

可选（会真实加载模型，慢且吃内存）：

```bash
python3 check_face_setup.py --try-engine
```

## 网络与手动放置

- 自动下载默认访问 **github.com** / **raw.githubusercontent.com**；国内常超时。
- **已内置**：同一文件会再尝试 **ghproxy.net** 前缀镜像（第三方服务可能变更）。
- **环境变量**（写在项目根 `.env`）：`FACENET_VGGFACE2_URL`、`EMOTION_ONNX_URL` 可设为任意可访问的直链；`FACE_MODEL_DOWNLOAD_CONNECT_TIMEOUT` 默认 120 秒。
- 离线环境：按 `face_engine.py` 中 URL 手动下载到 `check_face_setup.py` 输出的 `path`。

## 数据库

注册/比对依赖 MySQL 中 **`student`** 表（含 `face_feature`）。表由 `database.init_db()` / `create_students_table()` 创建；`.env` 中 **`MYSQL_*`** 须正确，否则列表/注册会失败（与「有没有模型文件」是两类问题）。

## 其它说明

- 进程被系统 **`Killed`**：多为 **内存不足（OOM）**，需加 swap 或更大内存，与缺模型文件不同。
- 可选接口 `POST /api/face/warmup` 仅用于**提前**后台加载，业务不依赖。
