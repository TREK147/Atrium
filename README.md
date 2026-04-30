# 心房（双系统）项目说明

本仓库包含两个协同系统：

- `EmoDetect-DigitalMan`：学生侧数字人陪伴与多模态情绪识别系统
- `student-emotion-web`：管理侧风险预警、工单流转与审计治理系统

## 一、方案摘要

本系统是一款多模态大模型驱动的校园心理健康预防与疏导平台。针对传统筛查滞后、显性干预易引发抗拒、师资不足导致跟进断层等痛点，项目以“超级私人助理”为产品形态，把心理关怀融入学生的日常学习和生活中，形成：

- 陪伴式交互
- 主动干预预防
- 无感化评估
- 动态化调节
- 分级化预警

的全链路闭环。

学生端强调“日常可用、长期陪伴、隐秘评估”；管理端强调“全局洞察、分级预警、闭环处置、合规审计”。

## 二、项目背景与需求分析（精简版）

### 2.1 高校情绪关怀痛点

- **离散筛查滞后**：传统量表是点状采样，缺乏跨周期连续观测，难以及时发现风险演进。
- **显性干预阻抗**：直接约谈或生硬测评容易引发防备心理，学生不愿持续配合。
- **师资跟踪断层**：咨询资源有限，离开咨询场景后缺乏持续证据与状态追踪。

### 2.2 目标用户与场景

- **学生端**：数字人助手承担日程规划、任务提醒、陪伴式对话与情绪支持，减少认知负担，降低负面情绪发生概率。
- **辅导员端**：通过结构化风险报告与预警工单快速发现重点学生，执行“发现-跟进-反馈-复盘”闭环。
- **校级管理端**：通过多维可视化看板进行全局态势治理与策略阈值调整，实现数据驱动决策。

### 2.3 相对传统方案的改进

- 从“定期问卷”升级为“日常无感、跨周期评估”。
- 从“异常发现”升级为“主动减负与前置干预”。
- 从“单通道反馈”升级为“双通道输出”：
  - 面向学生：可读、温和、可执行的疏导建议
  - 面向管理：可追溯、可复盘、可审计的证据链

## 三、仓库结构

```text
.
├── EmoDetect-DigitalMan
├── student-emotion-web
├── .gitignore
└── README.md
```

## 四、启动项目

### 4.1 EmoDetect-DigitalMan（主系统）

#### 第一次装环境（后端）

```bash
cd /你的项目路径/EmoDetect-DigitalMan/backend
bash setup_venv.sh
```

脚本结束后按提示启动：

```bash
source .venv/bin/activate
python app.py
```

#### 以后每次启动后端

```bash
cd /root/emo_detect/EmoDetect-DigitalMan/backend
source .venv/bin/activate
unset MYSQL_HOST MYSQL_PORT MYSQL_DATABASE MYSQL_USER MYSQL_PASSWORD
FLASK_DEBUG=0 python app.py
```

后端默认运行在：`http://127.0.0.1:5000`

#### 启动前端

```bash
cd /root/emo_detect/EmoDetect-DigitalMan/frontend
export NODE_OPTIONS=--max-old-space-size=384
npm run dev -- --host 0.0.0.0
```

### 4.2 student-emotion-web（管理端）

#### 安装依赖（后端）

```bash
cd /root/emo_detect/student-emotion-web/backend
python3 -m pip install -r requirements.txt
```

#### 启动后端

```bash
cd /root/emo_detect/student-emotion-web/backend
python app.py
```

#### 启动前端

```bash
cd /root/emo_detect/student-emotion-web
npm install
npm run dev -- --host 0.0.0.0 --port 5175
```

## 五、配置与安全

- 两个系统都依赖 MySQL，请在各自 `.env` 中配置数据库连接。
- 仓库仅保留 `.env.example`，不要提交真实密码或敏感密钥。
- 建议生产环境启用最小权限账号、访问审计与日志留痕策略。

## 六、作品说明书

- 详细文档参考：`/root/test/”心房“-作品说明书.docx`

