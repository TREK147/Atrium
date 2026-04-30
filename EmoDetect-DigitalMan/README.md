# EmoDetect-DigitalMan 项目总说明（新手上手版）

本 README 面向第一次接手项目的同学，目标是：

- 快速看懂项目做了什么
- 明确最近改动了哪些代码
- 在本地和云服务器都能成功跑起来
- 知道数据库该怎么建、怎么迁移

---

## 1. 项目简介

EmoDetect-DigitalMan 是一个前后端分离项目，核心能力包括：

- 聊天/情绪相关业务
- 新增的人脸识别 + 情绪识别能力（本次重点）
- 识别结果落库与查询

目录结构（核心）：

- `backend/`：Flask 后端、数据库访问、AI/识别能力
- `frontend/`：React 前端页面
- `backend/sql/`：数据库脚本

---

## 2. 最近改动总览（你最关心）

这次改动是一次完整的“人脸情绪模块”接入，前后端都改了。

### 2.1 后端改动

- `backend/face_engine.py`（新增）
  - 封装人脸与情绪识别引擎 `FaceEmotionEngine`
  - 人脸检测：`MTCNN`
  - 人脸特征：`InceptionResnetV1(vggface2)`
  - 情绪识别：`EmotiEffLibRecognizer(enet_b0_8_best_vgaf)`
  - 使用 `get_engine()` 单例减少重复加载

- `backend/app.py`（修改）
  - 新增 `/api/face/*` 接口：
    - `GET /api/face/students`：学生列表
    - `POST /api/face/students`：创建/更新学生（可注册人脸）
    - `PATCH /api/face/students/<student_id>`：更新姓名
    - `DELETE /api/face/students/<student_id>`：逻辑删除学生
    - `POST /api/face/recognize`：识别图像中的人脸与情绪
    - `GET /api/face/records`：识别记录列表
    - `DELETE /api/face/records/<record_id>`：逻辑删除记录
  - 识别命中学生后自动写入 `emotion_record`

- `backend/database.py`（修改）
  - 新增数据表：
    - `student`
    - `emotion_record`
  - 新增逻辑删除字段与处理：
    - `is_deleted`
    - `deleted_at`
  - `init_db()` 中自动建表，并兼容补字段

- `backend/requirements.txt`（修改）
  - 增加依赖：`numpy`、`opencv-python-headless`、`torch`、`facenet-pytorch`、`emotiefflib`

- `backend/FACE_MODULE_README.md`（新增）
  - 模块概览文档

### 2.2 前端改动

- `frontend/src/pages/FaceMonitorPage.tsx`（新增）
  - 新增“人脸情绪监控页”
  - 支持摄像头实时抓帧识别
  - 支持叠框显示（学号、情绪、置信度）
  - 支持采集当前画面注册学生
  - 支持查看已注册学生列表

- `frontend/src/App.tsx`（修改）
  - 新增路由：`/chat/face-monitor`

- `frontend/src/components/Header.tsx`（修改）
  - 新增导航入口“人脸情绪”

- `frontend/src/utils/api.ts`（修改）
  - 新增人脸模块 API 与类型定义

---

## 3. 模型文件为什么不在仓库里

你可能会问：`enet_b0_8_best_vgaf.pt` 不在项目里，为什么还能跑？

原因：

- `emotiefflib` 在首次调用时会自动下载模型权重到本地缓存目录（如 `~/.emotiefflib`）
- `facenet-pytorch` 的预训练权重也会走本地缓存机制

这意味着：

- 首次识别会慢一些（下载 + 加载）
- 云服务器需要有外网访问能力（至少首次需要）
- 离线环境要提前准备模型缓存

---

## 4. 本地运行（新手最短路径）

> 以下命令按常见流程写，Windows 可用 PowerShell，Linux/macOS 用 bash。

### 4.1 后端

```bash
cd backend
python -m venv .venv
```

激活虚拟环境：

- Windows PowerShell:
```powershell
.\.venv\Scripts\Activate.ps1
```

- Linux/macOS:
```bash
source .venv/bin/activate
```

安装依赖：

```bash
pip install -r requirements.txt
```

启动后端（按项目实际命令）：

```bash
python app.py
```

### 4.2 前端

```bash
cd frontend
npm install
npm run dev
```

---

## 5. 云服务器部署手册（推荐流程）

### 第一步：上传代码到 GitHub

先在本地把改动提交并推送到仓库，再到云服务器拉取。

### 第二步：云服务器拉取代码

```bash
git clone <你的仓库地址>
cd EmoDetect-DigitalMan
```

### 第三步：部署后端

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 第四步：准备数据库

- 先在云 MySQL 中创建数据库（例如 `emotion_prod`）
- 配置后端连接参数（host/port/user/password/db_name）
- 启动后端时会自动执行建表逻辑（`init_db()`）

### 第五步：启动服务并验证

```bash
python app.py
```

验证接口：

- `GET /api/health` 返回 `{"status":"ok"}`
- 登录后请求 `GET /api/face/students` 返回 200

### 第六步：部署前端

```bash
cd ../frontend
npm install
npm run build
```

---

## 6. 数据库设计建议（与代码对齐）

请以代码为准，不建议继续沿用早期简化版 DDL。

当前后端依赖的关键字段：

- `student`：
  - `id`, `student_id`, `name`, `face_feature`, `is_deleted`, `deleted_at`, `created_at`, `updated_at`
- `emotion_record`：
  - `id`, `student_id`, `emotion_type`, `intensity`, `timestamp`, `is_deleted`, `deleted_at`

如果你有历史旧表，使用迁移脚本：

- `backend/sql/migration_legacy_to_v2.sql`

执行示例：

```bash
mysql -h <host> -P <port> -u <user> -p <db_name> < backend/sql/migration_legacy_to_v2.sql
```

更多脚本说明见：

- `backend/sql/README.md`

---

## 7. 新手常见问题（FAQ）

### Q1：只上传代码到云服务器就可以了吗？

不够。你还需要：

- 安装依赖
- 配置数据库连接
- 确保数据库存在且账号有权限
- 首次调用时可联网下载模型

### Q2：要不要新建数据库？

建议新建一个云数据库/新库名，和本地隔离，避免互相影响。

### Q3：这次是不是只改了后端？

不是，前端也改了（新增监控页、路由、导航入口、API 封装）。

### Q4：为什么识别很慢？

首次加载模型正常会慢，后续会快很多。

### Q5：识别结果里学生总是 `unknown` 怎么办？

通常是人脸库没有有效特征：

- 重新用清晰正脸注册学生
- 确认光线和角度正常

---

## 8. 上线前检查清单（建议打印）

- [ ] 后端依赖安装成功
- [ ] 前端依赖安装成功
- [ ] 数据库连接参数正确
- [ ] `init_db()` 执行成功
- [ ] `GET /api/health` 正常
- [ ] 能注册学生并成功识别
- [ ] `emotion_record` 有新增数据
- [ ] 无敏感信息提交到 GitHub

---

## 9. 相关文档

- 人脸模块简要说明：`backend/FACE_MODULE_README.md`
- 云部署详细手册：`backend/FACE_CLOUD_DEPLOY_README.md`
- SQL 脚本说明：`backend/sql/README.md`
- 旧表迁移脚本：`backend/sql/migration_legacy_to_v2.sql`

