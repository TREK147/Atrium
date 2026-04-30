#!/usr/bin/env bash
# 在 backend 目录创建 .venv 并安装依赖（需已安装 python3.9+，推荐 3.11）
set -euo pipefail
cd "$(dirname "$0")"

pick_python() {
  for cmd in python3.11 python3.10 python3.9; do
    if command -v "$cmd" &>/dev/null; then
      echo "$cmd"
      return 0
    fi
  done
  echo ""
  return 1
}

PY="$(pick_python || true)"
if [[ -z "${PY}" ]]; then
  echo "错误: 未找到 python3.9+，请先安装（例如 yum/dnf install python3.11 或用 pyenv）。"
  exit 1
fi

echo "使用: $(${PY} --version)"
"${PY}" -m venv .venv
# shellcheck source=/dev/null
source .venv/bin/activate
python -m pip install -U pip
pip install -r requirements.txt
echo ""
echo "完成。启动后端:"
echo "  source .venv/bin/activate && python app.py"
