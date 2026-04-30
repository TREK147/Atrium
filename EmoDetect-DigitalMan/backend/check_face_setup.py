#!/usr/bin/env python3
"""
检查人脸模块依赖与磁盘上的模型文件（不加载大模型到内存）。

用法（在 backend 目录，务必使用已安装依赖的解释器）:
  source .venv/bin/activate && python3 check_face_setup.py
  # 或一行:
  .venv/bin/python3 check_face_setup.py

仅下载权重（约百兆，需能访问 GitHub；不加载引擎到内存）:
  python3 check_face_setup.py --download-models
"""
import argparse
import os
import sys

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_VENV_PYTHON = os.path.join(_BACKEND_DIR, ".venv", "bin", "python3")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--try-engine",
        action="store_true",
        help="调用 get_engine() 做一次真实加载（可能数分钟并占用大量内存）",
    )
    parser.add_argument(
        "--download-models",
        action="store_true",
        help="只下载 FaceNet .pt 与情绪 .onnx 到缓存目录，不加载完整引擎",
    )
    args = parser.parse_args()

    print("=== Python 依赖 ===")
    deps_ok = True
    for mod in (
        "torch",
        "cv2",
        "numpy",
        "requests",
        "facenet_pytorch",
        "emotiefflib",
        "onnx",
        "onnxruntime",
    ):
        try:
            __import__(mod)
            print(f"  [ok] {mod}")
        except ImportError as e:
            deps_ok = False
            print(f"  [缺] {mod}: {e}")

    if not deps_ok:
        print("\n请先安装依赖: pip install -r requirements.txt")
        if os.path.isfile(_VENV_PYTHON):
            print(
                "\n检测到本目录下有 .venv（依赖通常装在这里）。"
                "你当前用的是「系统 python」，所以看不到 torch 等包。请改用其一：\n"
                "  source .venv/bin/activate && python3 check_face_setup.py\n"
                "  " + _VENV_PYTHON + " check_face_setup.py"
            )
        return 1

    print("\n=== 磁盘上的模型文件（未加载到内存）===")
    from face_engine import report_face_model_disk_status

    status = report_face_model_disk_status()
    for key, block in status.items():
        ok = block.get("ok")
        mark = "ok" if ok else "缺或损坏"
        print(f"  [{mark}] {key}")
        for k, v in block.items():
            if k != "ok":
                print(f"       {k}: {v}")

    all_disk = all(
        status[k].get("ok")
        for k in ("facenet_vggface2", "emotion_onnx", "mtcnn_pnet_bundled")
    )
    if not all_disk:
        print(
            "\n说明: 上述两项尚未落盘属正常（还没第一次识别/注册）。"
            "可执行: python3 check_face_setup.py --download-models  （需能访问 GitHub）"
            "\n或启动后端后访问一次人脸识别，也会自动下载。"
        )

    if args.download_models:
        print("\n=== 正在下载 FaceNet + 情绪 ONNX（仅写磁盘，不加载引擎）===")
        print(
            "提示: 终端会先打印 [face] 连接/进度；若长期停在「正在连接」多为网络到 GitHub/镜像慢，"
            "可 Ctrl+C 后设置环境变量 FACENET_VGGFACE2_URL / EMOTION_ONNX_URL 为可访问的直链再试。"
        )
        try:
            from face_engine import download_face_weight_files

            download_face_weight_files()
            print("  [ok] 下载流程结束，复查磁盘状态：\n")
            status = report_face_model_disk_status()
            for key, block in status.items():
                ok = block.get("ok")
                mark = "ok" if ok else "缺或损坏"
                print(f"  [{mark}] {key}")
                for k, v in block.items():
                    if k != "ok":
                        print(f"       {k}: {v}")
            all_disk = all(
                status[k].get("ok")
                for k in ("facenet_vggface2", "emotion_onnx", "mtcnn_pnet_bundled")
            )
            return 0 if all_disk else 2
        except Exception as e:
            print(f"  [失败] {e}")
            return 1

    if args.try_engine:
        print("\n=== 尝试初始化引擎（get_engine）===")
        try:
            from face_engine import get_engine

            eng = get_engine()
            print(f"  [ok] 引擎已就绪 device={eng.device}")
        except Exception as e:
            print(f"  [失败] {e}")
            return 1

    return 0 if all_disk else 2


if __name__ == "__main__":
    sys.exit(main())
