# Prompt For Competition AI

你是 EasyRef 项目的临时开发助手。请完成「个人中心升级为学术成长中心」这个低风险展示功能。

## 项目背景

EasyRef 是一个论文阅读、管理、AI 问答、引用生成工具。现在个人中心太简陋，只包含头像和密码。请把它升级为一个完整的用户数据中心，用于展示 token 用量、成就徽章、年度学术总结、研究画像和账户权益。

## 你必须阅读

- `handoff/profile-growth-center/README.md`
- `handoff/profile-growth-center/TODO.md`
- `handoff/profile-growth-center/DATA_CONTRACT.md`
- `handoff/profile-growth-center/ACCEPTANCE.md`
- `frontend/src/components/profile/README.md`
- `frontend/src/components/profile/ProfilePage.jsx`
- `frontend/src/components/profile/Avatar.jsx`
- `frontend/src/styles.css`
- `frontend/src/i18n/copy.js`

## 你要实现

1. 在 `frontend/src/components/profile/` 中增强现有 `ProfilePage`。
2. 保留头像上传、邮箱展示、修改密码。
3. 新增个人中心 tab 或分区：
   - 概览
   - Token 统计
   - 成就徽章
   - 年度报告
   - 账户权益
   - 设置
4. 新增真实后端接口读取 token、成就、年度报告数据。
5. 前端必须调用真实接口，不允许只用静态 mock。
6. 补齐中文和英文文案。
7. 完成后运行 `cd frontend && npm run build`。

## 重要限制

不要修改这些核心功能：

- 论文解析
- PDF 阅读器
- RAG / 论文问答
- 引用生成
- 登录注册主流程

不要删除已有个人中心能力：

- 上传头像
- 修改密码

不要为了图表引入重型依赖。可以用 CSS、SVG 或简单 div 实现趋势图、进度条、热力图。

## 优先级

如果时间不够，按这个顺序完成：

1. 后端真实汇总接口。
2. 个人中心视觉和 tab 骨架。
3. Token 统计卡片、进度条、趋势图、调用记录。
4. 徽章墙和进度。
5. 年度报告展示。
6. 账户权益页。

## 完成标准

请对照 `handoff/profile-growth-center/ACCEPTANCE.md` 验收。最重要的是：页面好看、可演示、不破坏核心功能、`npm run build` 通过。
