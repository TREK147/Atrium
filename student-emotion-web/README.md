# 学生情绪管理系统（Web 演示版）

> 2026-04 对齐说明：本项目已从“纯 mock 演示”升级为“可联调后端”的管理员/辅导员端，默认与 `EmoDetect-DigitalMan` 共库协作。
> 当前后端读取策略为：优先读取学生端核心表 `student`、`emotion_record`，若无数据再回退 `sem_*` 兼容表。

## 与 EmoDetect-DigitalMan 的对齐结果

- 学生端继续负责采集与写入（人脸识别、情绪识别）。
- 管理员端负责查询、可视化、预警处置，但数据来源与学生端保持同口径。
- 档案时间线、趋势图和自动预警优先基于 `emotion_record` 计算，不再依赖独立 mock 数据链。

## 后端启动（管理员端）

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

默认端口：`5001`（可通过 `SEM_APP_PORT` 覆盖）。

## 必要环境变量

管理员端后端会读取项目根 `.env`（与学生端一致），至少需要：

- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`

如果缺失，启动时会给出友好报错并拒绝继续启动。

## 最小联调验收清单（建议按顺序）

1. 启动 `EmoDetect-DigitalMan/backend`（默认 `5000`），确认学生端可写入 `emotion_record`。
2. 启动 `student-emotion-web/backend`（默认 `5001`）与前端。
3. 在学生端触发一条新的识别记录（确保 `student_id` 对应学生存在）。
4. 在管理员端进入“学生档案”，确认时间线出现该记录（来源显示“人脸识别”）。
5. 在“情绪可视化”中确认均值/分布/趋势随新记录变化。
6. 在“预警中心”确认近 7 天累计消极记录达到阈值后会出现自动预警（可继续跟进/消除）。

## 迁移建议（可选）

- 历史项目如果只有 `sem_*` 数据，也可先继续使用；新逻辑会自动回退读取，不会阻塞上线。
- 若要彻底统一数据，建议后续把 `sem_emotion_point` 历史数据归档迁移到 `emotion_record`，再逐步下线回退逻辑。

本项目用于**管理员/辅导员端业务演示与联调**：支持连接真实后端与数据库，且已对齐到学生端核心数据表；保留少量兼容逻辑用于平滑迁移历史 `sem_*` 数据。

## 运行方式

```bash
npm install
npm run dev
```

浏览器打开终端提示的本地地址。

## 演示账号

- 管理员：`SuperManager / 123456`
- 教师：`2011800051（孙晓）/ 123456`
- 教师：`1999800037（徐本柱）/ 123456`

## 已实现的核心业务点（对应需求）

### 1) 身份认证与权限管理

- 工号 + 密码登录。
- 密码复杂度校验：长度 ≥ 8 且包含 **大写/小写/数字/特殊字符**。
- 登录成功后返回安全令牌（演示：LocalStorage 保存 token），并按角色跳转。
- 修改密码：验证原密码，新密码符合策略；“后端”重新加盐并 MD5 动态加盐哈希存储（演示：见 `src/mock/api.ts`）。
- 管理员账号管理：查看列表、冻结/停用账号；若在线则强制切断会话（令牌失效）。
- 细粒度权限校验：RBAC + 数据管辖范围（scope）在“接口层”校验，拦截横向越权（演示：档案检索/查看会拦截不在 scope 内学生）。

### 2) 学生数字心理档案查询

- 辅导员按学号/姓名/关键词检索学生。
- 查看基础信息：手机号/身份证号前端脱敏显示。
- 查看历史情绪波动时间轴 + 数字人交互评估报告。
- 每次档案访问触发安全审计：记录操作人、学生、时间、IP、设备信息（演示：写入审计日志列表）。

### 3) 情绪数据可视化

- 维度：全校/学院/班级（演示：随角色与 scope 变化）。
- 今日情绪均值、积极/消极占比、情绪分布图。
- 周/月/学期情绪波动曲线（群体趋势）。

### 4) 异常情绪预警与干预

- 预警等级与阈值配置（管理员可调整阈值与算法敏感度）。
- 辅导员实时预警推送（演示：页面顶部通知 + 预警中心列表）。
- 预警处置：标记“已跟进/干预”“已消除”，并填写备注。

### 5) 系统安全与审计日志

- 自动记录关键操作（登录成功/失败、冻结账号、阈值修改、档案访问等）。
- 连续多次失败触发账号锁定机制（演示：5 次失败锁定 10 分钟）。
- 所有接口使用模拟“接口层”进行权限校验；真实后端应使用 ORM/预编译防 SQL 注入。
- 真实部署应使用 HTTPS；演示版不具备真实传输加密能力（仅展示流程与约束点）。
- 优雅降级/抗 DoS：演示版通过“核心能力提示”展示要求；真实实现建议见下方。

## 建议的数据库设计（后端落地参考）

> 仅给出关键表结构（MySQL/PostgreSQL 皆可），字段可按实际扩展。

### `sys_user`（教职工账号）

- `id` (PK)
- `staff_no` (UK) 工号
- `name`
- `password_hash`（MD5 动态加盐哈希）
- `password_salt`
- `status`（ACTIVE/FROZEN/DISABLED/LOCKED）
- `failed_login_count`
- `locked_until`
- `created_at` `updated_at` `last_login_at`

### `sys_role` / `sys_user_role`

- `sys_role`: `id`, `code`(ADMIN/COUNSELOR), `name`
- `sys_user_role`: `user_id`, `role_id`

### `sys_data_scope`（数据管辖范围）

- `id` (PK)
- `user_id`（辅导员）
- `college_id` `grade` `major`
- `class_id`（可一对多：也可拆成 `sys_data_scope_class`）

### `stu_student`（学生基础信息）

- `student_no` (PK)
- `name`
- `college_id` `grade` `major` `class_id`
- `phone` `id_card_no`（存储需加密/脱敏策略）

### `emo_emotion_record`（情绪记录）

- `id` (PK)
- `student_no`
- `ts`
- `score`（0-100）
- `mood`（积极/中性/消极）
- `source`（自评/数字人/辅导员）
- 索引：`(student_no, ts)`

### `emo_assessment_report`（多模态评估报告）

- `id` (PK)
- `student_no`
- `created_at`
- `risk_level`（低/中/高/危）
- `summary`
- `tags`（JSON 或拆表）
- `modality`（JSON）

### `alert_alert`（预警）

- `id` (PK)
- `student_no`
- `created_at`
- `level`
- `reason`
- `assigned_counselor_staff_no`
- `status`（NEW/FOLLOWED/CLEARED）
- `note`
- `updated_at`

### `sys_threshold_config`（阈值与敏感度）

- `id` (PK)
- `sensitivity`（0-100）
- `rules_json`（各等级区间）
- `updated_at` `updated_by`

### `sys_audit_log`（审计日志）

- `id` (PK)
- `action`
- `actor_staff_no` `actor_name`
- `target_student_no` `target_staff_no`
- `detail`
- `ts` `ip` `device`
- 索引：`(action, ts)`, `(actor_staff_no, ts)`, `(target_student_no, ts)`

## 建议的后端接口设计（落地参考）

### 认证

- `POST /api/auth/login`（工号/密码）→ token
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/change-password`

### 管理员

- `GET /api/admin/accounts`
- `POST /api/admin/accounts/{staffNo}/status`（冻结/停用/启用 + 强制下线）
- `POST /api/admin/role-scope`（设置角色 + scope）
- `GET /api/admin/thresholds`
- `POST /api/admin/thresholds`
- `GET /api/admin/audit-logs`

### 辅导员

- `GET /api/counselor/students`（按 scope 拦截）
- `GET /api/counselor/students/{studentNo}/archive`（按 scope 拦截 + 审计）
- `GET /api/counselor/visualization`（按 scope 聚合）
- `GET /api/counselor/alerts`
- `POST /api/counselor/alerts/{id}`（状态/备注）

## 抗 DoS / 优雅降级建议（后端落地）

- 登录与核心报警独立部署（或至少独立依赖链路），必要时关闭非核心报表导出/大查询接口。
- 关键接口限流（IP/账号维度）、失败锁定。
- 预警推送可采用：消息队列 + WebSocket/SSE；非核心服务异常时预警仍可落库并在后台告警列表可见。

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
