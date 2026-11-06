# Profile Components

这个目录承载个人中心 / 学术成长中心相关前端代码。

## 当前文件

- `Avatar.jsx`
  - 用户头像组件。
  - 被侧边栏和个人中心复用。
- `ProfilePage.jsx`
  - 当前个人中心页面。
  - 已保留原有头像上传、密码修改、本地用户提示能力。
- `index.js`
  - 统一导出入口。

## 后续扩展建议

后续 token 统计、徽章、年度报告、账户权益都应优先放在这个目录下，避免继续堆进 `frontend/src/components/Pages.jsx`。

推荐拆分：

```text
frontend/src/components/profile/
├─ Avatar.jsx
├─ ProfilePage.jsx
├─ ProfileOverview.jsx
├─ TokenUsagePanel.jsx
├─ AchievementPanel.jsx
├─ YearlyReportPanel.jsx
├─ PlanBenefitsPanel.jsx
├─ profileApi.js
├─ profileMetrics.js
└─ index.js
```

## 真实接入要求

这个模块后续必须接真实后端数据，不接受只做静态 mock。

允许在接口失败时显示 fallback 空状态，但页面中的 token、徽章、年度报告数据应来自后端接口，例如：

```text
GET /api/user-growth/summary?user_key=<email>&year=2026&range=30d
```

前端只负责展示和轻量派生，token 统计、年度聚合、徽章进度应以后端返回为准。

