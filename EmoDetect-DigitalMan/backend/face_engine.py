import base64
import gc
import json
import os
import threading
import time
import zipfile
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

# 与 config 一致加载 .env，便于单独运行 check_face_setup / download 时读取 FACENET_* 等
try:
    from dotenv import load_dotenv

    _HERE = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(_HERE, "..", "..", ".env"))
    load_dotenv(os.path.join(_HERE, ".env"))
except ImportError:
    pass

# 小内存机器上限制 BLAS / PyTorch 线程，降低并行分配导致的 OOM 风险
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
# 情绪 ONNX 在部分版本会读这些变量，降低多线程争抢（双核小内存机更稳）
os.environ.setdefault("ORT_INTRA_OP_NUM_THREADS", "1")
os.environ.setdefault("ORT_INTER_OP_NUM_THREADS", "1")

import cv2
import numpy as np
import requests
import torch
from facenet_pytorch import InceptionResnetV1, MTCNN
from emotiefflib.facial_analysis import EmotiEffLibRecognizer

torch.set_num_threads(1)
torch.set_num_interop_threads(1)

# 与 facenet_pytorch InceptionResnetV1(load_weights) 中 vggface2 的 URL 一致
_VGGFACE2_URL = (
    "https://github.com/timesler/facenet-pytorch/releases/download/v2.2.9/20180402-114759-vggface2.pt"
)
_VGGFACE2_NAME = "20180402-114759-vggface2.pt"
# 官方权重约 107MB，用于判断下载是否完整
_MIN_VGGFACE2_BYTES = 95 * 1024 * 1024

# EmotiEffLib 情绪模型：使用 ONNX + onnxruntime，避免再加载一份 PyTorch 情绪网络，降低峰值内存（易 OOM）
_EMOTION_MODEL = "enet_b0_8_best_vgaf"
_EMOTION_ONNX_URL = (
    "https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/"
    "models/affectnet_emotions/onnx/enet_b0_8_best_vgaf.onnx"
)
_MIN_EMOTION_ONNX_BYTES = 256 * 1024


def _download_timeouts() -> Tuple[int, int]:
    """(connect, read)；连接 github 慢时可加大 FACE_MODEL_DOWNLOAD_CONNECT_TIMEOUT。"""
    c = int(os.environ.get("FACE_MODEL_DOWNLOAD_CONNECT_TIMEOUT", "120"))
    r = int(os.environ.get("FACE_MODEL_DOWNLOAD_READ_TIMEOUT", "900"))
    return (c, r)


def _dedupe_urls(urls: List[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for u in urls:
        u = (u or "").strip()
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _vggface2_urls() -> List[str]:
    """优先环境变量 FACENET_VGGFACE2_URL；否则先 ghproxy 再直连 GitHub（国内直连 releases 常极慢或像卡住）。"""
    custom = os.environ.get("FACENET_VGGFACE2_URL", "").strip()
    official = _VGGFACE2_URL
    mirror = (
        "https://ghproxy.net/https://github.com/timesler/facenet-pytorch/releases/download/v2.2.9/"
        "20180402-114759-vggface2.pt"
    )
    return _dedupe_urls([custom, mirror, official])


def _emotion_onnx_urls() -> List[str]:
    """优先 EMOTION_ONNX_URL；否则先 ghproxy 再 raw.githubusercontent.com。"""
    custom = os.environ.get("EMOTION_ONNX_URL", "").strip()
    official = _EMOTION_ONNX_URL
    mirror = (
        "https://ghproxy.net/https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/"
        "models/affectnet_emotions/onnx/enet_b0_8_best_vgaf.onnx"
    )
    return _dedupe_urls([custom, mirror, official])


def _stream_download_to_tmp(url: str, tmp: str, label: str = "下载") -> None:
    timeouts = _download_timeouts()
    print(f"[face] {label}：正在连接… {url[:96]}{'…' if len(url) > 96 else ''}", flush=True)
    downloaded = 0
    report_every = 5 * 1024 * 1024
    last_report = 0
    with requests.get(
        url,
        stream=True,
        timeout=timeouts,
        headers={"User-Agent": "torch.hub/EmoDetect-backend"},
    ) as r:
        r.raise_for_status()
        total = r.headers.get("Content-Length")
        if total:
            print(f"[face] {label}：预计大小 {int(total) / (1024 * 1024):.1f} MiB", flush=True)
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(chunk_size=512 * 1024):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    if downloaded - last_report >= report_every:
                        print(
                            f"[face] {label}：已下载 {downloaded / (1024 * 1024):.1f} MiB …",
                            flush=True,
                        )
                        last_report = downloaded
    print(f"[face] {label}：共写入 {downloaded / (1024 * 1024):.1f} MiB", flush=True)


def _verify_torch_checkpoint(path: str) -> bool:
    """检查 .pt 是否为可读 PyTorch 文件。损坏或不完整时常见：PytorchStreamReader failed finding central directory。"""
    if not os.path.isfile(path) or os.path.getsize(path) < 1024:
        return False
    try:
        with zipfile.ZipFile(path, "r") as zf:
            if zf.testzip() is not None:
                return False
    except zipfile.BadZipFile:
        try:
            torch.load(path, map_location=torch.device("cpu"), weights_only=False)
            return True
        except Exception:
            return False
    except Exception:
        return False
    return True


def _vggface2_checkpoint_path() -> str:
    torch_home = os.path.expanduser(
        os.getenv("TORCH_HOME", os.path.join(os.getenv("XDG_CACHE_HOME", "~/.cache"), "torch"))
    )
    d = os.path.join(torch_home, "checkpoints")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, _VGGFACE2_NAME)


def _ensure_vggface2_weights() -> None:
    """预下载 FaceNet 权重。facenet-pytorch 内置 urllib 下载在弱网下易 RemoteDisconnected。"""
    dest = _vggface2_checkpoint_path()
    if os.path.isfile(dest) and os.path.getsize(dest) >= _MIN_VGGFACE2_BYTES:
        if _verify_torch_checkpoint(dest):
            return
        try:
            os.remove(dest)
        except OSError:
            pass
    elif os.path.isfile(dest):
        try:
            os.remove(dest)
        except OSError:
            pass

    tmp = dest + ".part"
    urls = _vggface2_urls()
    last_err: Optional[Exception] = None
    print(
        f"[face] FaceNet 权重将保存到: {dest}（约 107MB，无进度时请等待连接或换镜像 URL）",
        flush=True,
    )
    for url in urls:
        for attempt in range(5):
            try:
                if attempt > 0:
                    print(f"[face] FaceNet 权重 第 {attempt + 1} 次重试…", flush=True)
                if os.path.isfile(tmp):
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
                _stream_download_to_tmp(url, tmp, label="FaceNet 权重")
                if not os.path.isfile(tmp) or os.path.getsize(tmp) < _MIN_VGGFACE2_BYTES:
                    raise OSError(f"下载不完整（{os.path.getsize(tmp) if os.path.isfile(tmp) else 0} 字节）")
                os.replace(tmp, dest)
                if not _verify_torch_checkpoint(dest):
                    try:
                        os.remove(dest)
                    except OSError:
                        pass
                    raise OSError("下载文件校验失败（可能损坏），将重试")
                return
            except Exception as e:
                last_err = e
                if os.path.isfile(tmp):
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
                if attempt < 4:
                    time.sleep(min(2**attempt, 30))
    raise RuntimeError(
        "无法下载 FaceNet 预训练权重（约 107MB）。github.com 不可达时可设置环境变量 FACENET_VGGFACE2_URL 为镜像直链，"
        "或手动下载到: "
        f"{_vggface2_checkpoint_path()} —— 已尝试 URL 数={len(urls)}，最后错误: {last_err!r}"
    ) from last_err


def _emotion_onnx_path() -> str:
    d = os.path.join(os.path.expanduser("~"), ".emotiefflib")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, f"{_EMOTION_MODEL}.onnx")


def _ensure_emotion_onnx_weights() -> None:
    """情绪 ONNX：预下载到 ~/.emotiefflib，供 EmotiEffLibRecognizer(engine='onnx') 使用。"""
    dest = _emotion_onnx_path()
    if os.path.isfile(dest) and os.path.getsize(dest) >= _MIN_EMOTION_ONNX_BYTES:
        return
    if os.path.isfile(dest):
        try:
            os.remove(dest)
        except OSError:
            pass

    tmp = dest + ".part"
    urls = _emotion_onnx_urls()
    last_err: Optional[Exception] = None
    print(f"[face] 情绪 ONNX 将保存到: {dest}", flush=True)
    for url in urls:
        for attempt in range(5):
            try:
                if attempt > 0:
                    print(f"[face] 情绪 ONNX 第 {attempt + 1} 次重试…", flush=True)
                if os.path.isfile(tmp):
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
                _stream_download_to_tmp(url, tmp, label="情绪 ONNX")
                if not os.path.isfile(tmp) or os.path.getsize(tmp) < _MIN_EMOTION_ONNX_BYTES:
                    raise OSError(f"情绪 ONNX 下载不完整（{os.path.getsize(tmp) if os.path.isfile(tmp) else 0} 字节）")
                os.replace(tmp, dest)
                return
            except Exception as e:
                last_err = e
                if os.path.isfile(tmp):
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
                if attempt < 4:
                    time.sleep(min(2**attempt, 30))
    raise RuntimeError(
        "无法下载情绪识别 ONNX。可设置 EMOTION_ONNX_URL 为可访问的直链，或手动下载到: "
        f"{dest} —— 已尝试 URL 数={len(urls)}，最后错误: {last_err!r}"
    ) from last_err


@dataclass
class DetectionResult:
    student_id: str
    emotion: str
    confidence: float
    box: List[int]


def limit_bgr_frame(frame: np.ndarray) -> np.ndarray:
    """
    缩小过大的输入，降低 MTCNN / FaceNet / 情绪的峰值内存（低配机易被 OOM Kill）。
    环境变量 FACE_MAX_FRAME_SIDE：最长边像素上限，默认 480；设为 0 表示不缩放。
    """
    max_side = int(os.environ.get("FACE_MAX_FRAME_SIDE", "480"))
    if max_side <= 0 or frame is None or frame.size == 0:
        return frame
    h, w = int(frame.shape[0]), int(frame.shape[1])
    m = max(h, w)
    if m <= max_side:
        return frame
    scale = max_side / float(m)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    return cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_AREA)


class FaceEmotionEngine:
    """后端人脸识别 + 情绪识别引擎（延续 gui_app2.py 的主流程）。"""

    def __init__(self) -> None:
        print(
            "[face] 开始初始化 FaceEmotionEngine（首次需下载 FaceNet/情绪 ONNX 并加载 MTCNN，可能数分钟；"
            "完成前 Flask 访问日志可能暂不出现「200」行，属正常）",
            flush=True,
        )
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        # 先落盘权重再加载网络，分段 gc，减轻峰值内存（低配机易被 OOM Killer 直接杀掉）
        _ensure_vggface2_weights()
        _ensure_emotion_onnx_weights()
        gc.collect()

        self.mtcnn = MTCNN(keep_all=True, device=self.device)
        gc.collect()

        self.face_model = InceptionResnetV1(pretrained="vggface2").eval().to(self.device)
        gc.collect()

        # ONNX 情绪：避免再驻留一份 PyTorch EfficientNet 情绪权重，显著降低 RAM 峰值
        self.emotion_model = EmotiEffLibRecognizer(engine="onnx", model_name="enet_b0_8_best_vgaf")
        gc.collect()
        self._lock = threading.Lock()
        print("[face] FaceEmotionEngine 初始化完成，可正常推理。", flush=True)

    @staticmethod
    def decode_base64_image(image_base64: str) -> Optional[np.ndarray]:
        if not image_base64:
            return None
        raw = image_base64.strip()
        if "," in raw and raw.startswith("data:"):
            raw = raw.split(",", 1)[-1]
        try:
            img_bytes = base64.b64decode(raw)
            arr = np.frombuffer(img_bytes, dtype=np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            return frame
        except Exception:
            return None

    @staticmethod
    def _match_face(embedding: np.ndarray, face_db: Dict[str, np.ndarray], threshold: float = 0.6) -> str:
        best_id = "unknown"
        min_dist = float("inf")
        for sid, db_emb in face_db.items():
            dist = np.linalg.norm(embedding - db_emb)
            if dist < min_dist:
                min_dist = dist
                best_id = sid
        return best_id if min_dist < threshold else "unknown"

    def extract_embedding(self, frame: np.ndarray) -> Optional[np.ndarray]:
        frame = limit_bgr_frame(frame)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        with self._lock:
            face = self.mtcnn(rgb)
            if face is None:
                return None
            # MTCNN 在 keep_all=True 时，可能返回 [N, 3, 160, 160]。
            # 此处注册只需要取第一张对齐人脸的 embedding，避免出现 [1, 1, 3, 160, 160] 维度不匹配。
            # 兼容不同版本 MTCNN 返回类型（有的版本会返回 (faces, probs)）。
            if isinstance(face, tuple):
                face = face[0]

            if not isinstance(face, torch.Tensor):
                return None
            if face.dim() == 4:
                face_tensor = face[0]  # -> [3, 160, 160]
            elif face.dim() == 3:
                face_tensor = face  # -> [3, 160, 160]
            else:
                return None

            emb = self.face_model(face_tensor.unsqueeze(0).to(self.device)).detach().cpu().numpy()[0]
            return emb

    def detect(self, frame: np.ndarray, face_db: Dict[str, np.ndarray], threshold: float = 0.6) -> List[DetectionResult]:
        """检测人脸、情绪并与库比对。对 MTCNN 输出张量维度做统一，避免单脸/多脸时迭代错误。"""
        frame = limit_bgr_frame(frame)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        with self._lock:
            boxes, _ = self.mtcnn.detect(rgb)
            if boxes is None:
                return []
            boxes = np.asarray(boxes, dtype=np.float32)
            if boxes.ndim == 1:
                boxes = boxes.reshape(1, -1)
            if boxes.size == 0:
                return []

            faces = self.mtcnn(rgb)
            if faces is None:
                return []

            if isinstance(faces, torch.Tensor):
                if faces.dim() == 3:
                    faces = faces.unsqueeze(0)
                if faces.dim() != 4:
                    return []
                n_faces = int(faces.shape[0])
            else:
                return []

            n_box = int(boxes.shape[0])
            n = min(n_faces, n_box)
            if n <= 0:
                return []

            imgs: List[np.ndarray] = []
            for i in range(n):
                f = faces[i]
                img = f.permute(1, 2, 0).cpu().numpy()
                img = (img * 128 + 127.5).clip(0, 255).astype(np.uint8)
                imgs.append(img)

            try:
                emotions, confs = self.emotion_model.predict_emotions(imgs, logits=True)
            except Exception as exc:
                raise RuntimeError(f"情绪模型推理失败: {exc}") from exc

            if isinstance(emotions, str):
                emotions = [emotions]
            if not isinstance(emotions, list):
                emotions = list(emotions)

            results: List[DetectionResult] = []
            for i in range(n):
                face_t = faces[i]
                emb = self.face_model(face_t.unsqueeze(0).to(self.device)).detach().cpu().numpy()[0]
                sid = self._match_face(emb, face_db, threshold=threshold)
                emo = emotions[i] if i < len(emotions) else "neutral"
                conf = 0.0
                if confs is not None:
                    row = np.asarray(confs[i])
                    conf = round(float(np.max(row)), 2)
                x1, y1, x2, y2 = [int(v) for v in boxes[i]]
                results.append(
                    DetectionResult(
                        student_id=sid,
                        emotion=emo,
                        confidence=conf,
                        box=[x1, y1, x2, y2],
                    )
                )
            return results


_ENGINE: Optional[FaceEmotionEngine] = None
_ENGINE_LOCK = threading.Lock()


def report_face_model_disk_status() -> dict:
    """
    不加载神经网络，仅检查「缺了哪份文件」。
    MTCNN 的 pnet/rnet/onnet 随 facenet-pytorch 包安装到 site-packages，一般无需单独下载。
    """
    vgg = _vggface2_checkpoint_path()
    onnx_p = _emotion_onnx_path()
    vgg_bytes = os.path.getsize(vgg) if os.path.isfile(vgg) else 0
    vgg_ok = vgg_bytes >= _MIN_VGGFACE2_BYTES and _verify_torch_checkpoint(vgg) if os.path.isfile(vgg) else False
    emo_bytes = os.path.getsize(onnx_p) if os.path.isfile(onnx_p) else 0
    emo_ok = emo_bytes >= _MIN_EMOTION_ONNX_BYTES if os.path.isfile(onnx_p) else False

    mtcnn_pnet: Optional[str] = None
    mtcnn_ok = False
    try:
        from facenet_pytorch.models import mtcnn as mtcnn_mod

        mtcnn_dir = os.path.dirname(mtcnn_mod.__file__)
        mtcnn_pnet = os.path.normpath(os.path.join(mtcnn_dir, "..", "data", "pnet.pt"))
        mtcnn_ok = os.path.isfile(mtcnn_pnet) and os.path.getsize(mtcnn_pnet) > 1000
    except Exception as exc:
        mtcnn_pnet = f"(import facenet_pytorch 失败: {exc})"

    return {
        "facenet_vggface2": {
            "path": vgg,
            "ok": vgg_ok,
            "min_bytes": _MIN_VGGFACE2_BYTES,
            "bytes": vgg_bytes,
            "hint": "首次由 face_engine 从 GitHub releases 下载；可手动放到上述路径",
        },
        "emotion_onnx": {
            "path": onnx_p,
            "ok": emo_ok,
            "min_bytes": _MIN_EMOTION_ONNX_BYTES,
            "bytes": emo_bytes,
            "hint": "首次由 face_engine 从 raw.githubusercontent.com 下载；可手动放到上述路径",
        },
        "mtcnn_pnet_bundled": {
            "path": mtcnn_pnet,
            "ok": mtcnn_ok,
            "hint": "应随 pip install facenet-pytorch 自带；若 ok=false 请重装该包",
        },
    }


def download_face_weight_files() -> None:
    """仅下载 FaceNet 与情绪 ONNX 到本地缓存，不加载神经网络（省内存，可单独跑完再启动服务）。"""
    _ensure_vggface2_weights()
    _ensure_emotion_onnx_weights()


def get_engine() -> FaceEmotionEngine:
    global _ENGINE
    with _ENGINE_LOCK:
        if _ENGINE is None:
            try:
                _ENGINE = FaceEmotionEngine()
            except Exception as e:
                raise RuntimeError(
                    "人脸引擎初始化失败。首次使用需下载模型（FaceNet 约 107MB + 情绪 ONNX），"
                    "请保持网络稳定；内存过小会被系统 Kill，可尝试增加 swap。"
                    f" 原因: {e}"
                ) from e
        return _ENGINE
