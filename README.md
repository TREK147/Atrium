# 心房（Campus Emotional Health Platform）

“心房”是一套面向高校场景的心理健康预防与疏导平台，采用“双系统协同”架构：

- `EmoDetect-DigitalMan`：学生侧，提供数字人陪伴、日常协作与多模态情绪识别能力
- `student-emotion-web`：管理侧，提供预警看板、工单流转、档案追踪与审计治理

---

## 项目背景与意义

传统高校心理工作普遍存在三个痛点：

- **筛查离散且滞后**：依赖周期性问卷，缺乏跨周期、连续化状态跟踪
- **显性干预易引发抵触**：学生在高压阶段对直接心理干预接受度低
- **跟进链路易断层**：师资有限，难以持续追踪并形成可复盘证据

本项目的价值是将“心理关怀”前置并融入日常：通过陪伴式交互、无感评估、主动减负与分级预警，实现从“被动响应”向“主动预防”的升级。

---

## 核心能力

- **学生侧**
  - 数字人对话与主动提醒
  - 日程管理与任务协作
  - 人脸 + 情绪识别（授权场景）
  - 情绪波动的隐秘评估与温和干预
- **管理侧**
  - 多维情绪趋势可视化
  - 低/中/高风险分级预警
  - 工单闭环处置（发现-跟进-反馈-复盘）
  - 角色权限、范围管控与审计留痕

---

## 仓库结构

```text
.
├── EmoDetect-DigitalMan
├── student-emotion-web
├── .gitignore
└── README.md
```

---

## 运行环境

- Linux / macOS（Windows 建议 WSL）
- Python 3.11（推荐）
- Node.js 18+（建议 20）
- MySQL 5.7+/8.0

---

## 快速开始（克隆后可直接执行）

先克隆仓库并进入目录：

```bash
git clone <your-repo-url>
cd <your-repo-folder>
```

### 1) 启动 EmoDetect-DigitalMan（主系统）

#### 第一次安装后端环境

```bash
cd EmoDetect-DigitalMan/backend
bash setup_venv.sh
```

脚本结束后按提示启动：

```bash
source .venv/bin/activate
python app.py
```

#### 以后每次启动后端

```bash
cd EmoDetect-DigitalMan/backend
source .venv/bin/activate
unset MYSQL_HOST MYSQL_PORT MYSQL_DATABASE MYSQL_USER MYSQL_PASSWORD
FLASK_DEBUG=0 python app.py
```

后端默认地址：`http://127.0.0.1:5000`

#### 启动前端

```bash
cd EmoDetect-DigitalMan/frontend
export NODE_OPTIONS=--max-old-space-size=384
npm install
npm run dev -- --host 0.0.0.0
```

### 2) 启动 student-emotion-web（管理端）

#### 安装并启动后端

```bash
cd student-emotion-web/backend
python3 -m pip install -r requirements.txt
python app.py
```

#### 启动前端

```bash
cd student-emotion-web
npm install
npm run dev -- --host 0.0.0.0 --port 5175
```

---

## 配置说明

- 两个系统都依赖 MySQL，请在各自项目目录配置 `.env`
- 推荐保留 `.env.example` 作为模板，复制后填写真实值：
  - `cp .env.example .env`
- 关键变量示例：
  - `MYSQL_HOST`
  - `MYSQL_PORT`
  - `MYSQL_DATABASE`
  - `MYSQL_USER`
  - `MYSQL_PASSWORD`

---

## 安全说明

- 请勿将真实 `.env`、密钥、数据库密码提交到 Git
- 生产环境建议：
  - 使用最小权限数据库账号
  - 启用访问审计与操作留痕
  - 定期轮换敏感凭据

---

## 常见问题（FAQ）

- **启动时报 `No module named xxx`**  
  说明后端依赖未完整安装，请在对应系统目录重新安装依赖并重启

- **管理端报缺少 `MYSQL_PASSWORD`**  
  说明 `.env` 未生效或缺失，请检查 `student-emotion-web/.env`

- **前端 `vite: command not found`**  
  说明 `node_modules` 未安装，请先执行 `npm install`

