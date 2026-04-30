#!/usr/bin/env bash
# 使用 Miniconda 中的 Python 3.11 + numpy 1.26.4（系统 python3 为 3.6，无法安装 numpy 1.26）
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONDA_SH="/root/miniconda3/etc/profile.d/conda.sh"
if [[ -f "$CONDA_SH" ]]; then
  # shellcheck source=/dev/null
  source "$CONDA_SH"
  conda activate emo_backend
else
  echo "未找到 $CONDA_SH，请先安装 Miniconda 并创建环境: conda create -n emo_backend python=3.11 -y" >&2
  exit 1
fi
cd "$ROOT"
exec python app.py "$@"
