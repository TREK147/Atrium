# 人脸情绪模块改动说明 + 云服务器部署手册（新手版）

这份文档给第一次接手项目的人使用，目标是：

- 看懂最近代码改了什么、实现了哪些功能
- 能把代码从本地搬到云服务器并跑起来
- 能正确准备数据库并验证接口

---

## 1. 最近代码改动了什么

### 1.1 后端新增能力

- `backend/face_engine.py`
  - 新增人脸 + 情绪识别引擎 `FaceEmotionEngine`
  - 人脸检测：`MTCNN`
  - 人脸特征：`InceptionResnetV1(vggface2)`
  - 情绪识别：`EmotiEffLibRecognizer(enet_b0_8_best_vgaf)`
  - 通过 `get_engine()` 使用单例，避免重复加载模型

- `backend/app.py`
  - 新增人脸相关接口 `/api/face/*`
    - `GET /api/face/students`：查学生
    - `POST /api/face/students`：注册学生（可同时采集人脸）
    - `PATCH /api/face/students/<student_id>`：改名
    - `DELETE /api/face/students/<student_id>`：逻辑删除学生
    - `POST /api/face/recognize`：单帧识别（人脸 + 情绪）
    - `GET /api/face/records`：查识别记录
    - `DELETE /api/face/records/<record_id>`：逻辑删除记录
  - 识别到已注册学生后，自动把识别结果写入 `emotion_record`

- `backend/database.py`
  - 新增 `student`、`emotion_record` 两张表
  - 新增逻辑删除字段：`is_deleted`、`deleted_at`
  - 在 `init_db()` 中自动建表并补齐旧表缺失字段

- `backend/requirements.txt`
  - 新增模型依赖：`numpy`、`opencv-python-headless`、`torch`、`facenet-pytorch`、`emotiefflib`

### 1.2 前端新增能力

- `frontend/src/pages/FaceMonitorPage.tsx`
  - 新增“人脸情绪监控页”
  - 支持摄像头实时抓帧、调用识别接口、框选显示结果
  - 支持“采集当前画面并注册学生”
  - 显示已注册学生和当前识别结果

- `frontend/src/App.tsx`
  - 新增路由 `/chat/face-monitor`

- `frontend/src/components/Header.tsx`
  - 新增导航入口“人脸情绪”

- `frontend/src/utils/api.ts`
  - 新增 face 模块 API 与类型定义

---

## 2. 数据库设计说明（和代码对齐）

当前后端代码依赖以下核心字段（请不要删）：

- `student`：`id`、`student_id`、`name`、`face_feature`、`is_deleted`、`deleted_at`、`created_at`、`updated_at`
- `emotion_record`：`id`、`student_id`、`emotion_type`、`intensity`、`timestamp`、`is_deleted`、`deleted_at`

如果你有旧版表结构（例如 `record_id` 主键、无 `is_deleted`），请执行迁移脚本：

- `backend/sql/migration_legacy_to_v2.sql`

---

## 3. 上传到 GitHub 前建议

1. 先本地自测接口可用
2. 确认不要提交敏感信息（数据库密码、密钥）
3. 推送前至少看一次：
   - `git status`
   - `git diff`

---

## 4. 云服务器部署步骤（最稳流程）

以下以 Linux 云服务器 + MySQL 为例。

### 第一步：准备服务器环境

安装：

- Python 3.10+（建议）
- MySQL 8+
- Git

### 第二步：拉取代码

```bash
git clone <你的仓库地址>
cd EmoDetect-DigitalMan
```

### 第三步：创建 Python 虚拟环境并安装依赖

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 第四步：创建云数据库

在云 MySQL 中先创建数据库（例如 `emotion_prod`），然后为应用账号授权。

注意：`database.py` 会自动建表，但前提是“数据库本身已经存在”。

### 第五步：配置后端数据库连接

按你的项目配置方式修改数据库连接参数（通常在 `backend/config.py` 或环境变量）。

确认以下值正确：

- host
- port
- user
- password
- db_name

### 第六步：初始化数据库

启动后端时，`init_db()` 会自动创建所需表。

如果你是旧表迁移场景，执行：

```bash
mysql -h <host> -P <port> -u <user> -p <db_name> < backend/sql/migration_legacy_to_v2.sql
```

### 第七步：启动后端

示例（按你的实际启动命令）：

```bash
python app.py
```

### 第八步：启动前端

```bash
cd ../frontend
npm install
npm run build
# 或开发模式 npm run dev
```

---

## 5. 模型文件为什么仓库里没有 `.pt`

这是正常现象。`EmotiEffLibRecognizer` 会在首次运行时自动下载模型权重到本机缓存目录（例如 `~/.emotiefflib`）。

因此：

- 首次识别会慢（下载 + 加载模型）
- 服务器必须能联网访问模型来源
- 离线环境需要提前把模型文件放到缓存目录

---

## 6. 上线后最小验证清单

建议按顺序验证：

1. `GET /api/health` 返回 `ok`
2. 登录后请求 `GET /api/face/students` 返回 200
3. 用页面注册一个学生（带人脸图像）
4. 调 `POST /api/face/recognize` 能返回 `detections`
5. `GET /api/face/records` 能看到新记录

---

## 7. 常见问题排查

### Q1: 首次识别很慢，是否异常？

不是异常。首次会下载并加载模型，后续会快很多。

### Q2: 报数据库权限错误（1045）怎么办？

先执行 `backend/sql/init_mysql_user.sql` 或联系 DBA 开权限。

### Q3: 能识别情绪但学生一直是 `unknown`？

通常是人脸库没有有效特征，重新采集清晰正脸并注册。

### Q4: 云上跑不起来 Torch 依赖？

检查 Python 版本、CPU/GPU 环境，必要时按服务器环境重新安装 torch。

---

## 8. 建议后续优化（可选）

- 为 `/api/face/recognize` 增加限流
- 对人脸库 embedding 加缓存，避免每次识别都查全表
- 识别记录按时间窗口去重，减少数据库压力

