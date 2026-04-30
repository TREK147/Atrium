# 智慧星

基于 Vite + React + TypeScript 的项目，已集成 Tailwind CSS、React Router、Zustand、Axios、Lucide React、date-fns、clsx。

## 环境要求

- Node.js 18+
- npm 或 pnpm

## 安装与运行

在项目根目录执行：

```bash
# 安装依赖
npm install

# 开发
npm run dev

# 构建
npm run build

# 预览构建结果
npm run preview

# 代码检查
npm run lint
```

## 目录说明

- `src/components` - 通用组件
- `src/layouts` - 布局组件
- `src/pages` - 页面组件
- `src/stores` - Zustand 状态
- `src/hooks` - 自定义 Hooks
- `src/utils` - 工具函数
- `src/types` - TypeScript 类型
- `src/assets` - 静态资源

## 路径别名

在 `tsconfig` 和 Vite 中配置了 `@` 指向 `src`，例如：

```ts
import { Button } from '@/components/Button'
```
