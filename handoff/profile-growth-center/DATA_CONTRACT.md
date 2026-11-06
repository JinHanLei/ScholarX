# Data Contract

这个功能必须接真实后端数据。前端可以在接口失败或空数据时展示 fallback 空状态，但统计值、徽章进度、年度报告应由后端接口返回。

## API 建议

### GET `/api/user-growth/summary`

请求参数：

```text
user_key=用户邮箱或 local
year=2026
range=30d
```

返回：

```json
{
  "profile": {
    "user_key": "demo@example.com",
    "plan": "free",
    "plan_label": "Free",
    "quota_monthly_tokens": 100000,
    "quota_reset_at": "2026-08-01T00:00:00Z"
  },
  "usage": {
    "tokens_today": 3200,
    "tokens_month": 48200,
    "tokens_total": 391200,
    "tokens_remaining": 51800,
    "input_tokens_month": 21200,
    "output_tokens_month": 27000
  },
  "activity": {
    "papers_read_total": 28,
    "papers_read_year": 19,
    "ai_questions_year": 86,
    "summaries_year": 14,
    "citations_year": 22,
    "active_days_30d": 11,
    "current_streak_days": 3
  },
  "token_trend": [
    { "date": "2026-07-02", "tokens": 4100 },
    { "date": "2026-07-03", "tokens": 2600 }
  ],
  "feature_usage": [
    { "feature": "paper_summary", "label": "论文总结", "tokens": 18000 },
    { "feature": "paper_qa", "label": "论文问答", "tokens": 20500 }
  ],
  "recent_calls": [
    {
      "id": "call_1",
      "created_at": "2026-07-08T10:30:00Z",
      "feature": "paper_qa",
      "feature_label": "论文问答",
      "model": "gpt-4.1",
      "input_tokens": 1200,
      "output_tokens": 900,
      "total_tokens": 2100,
      "status": "success"
    }
  ],
  "achievements": [
    {
      "id": "paper_reader_10",
      "name": "文献猎人",
      "description": "累计阅读 10 篇论文",
      "category": "reading",
      "icon": "book-open",
      "metric": "papers_read_total",
      "threshold": 10,
      "progress": 7,
      "unlocked": false,
      "unlocked_at": null
    }
  ],
  "research_profile": {
    "top_fields": [
      { "name": "Natural Language Processing", "count": 12 },
      { "name": "Human-Computer Interaction", "count": 5 }
    ],
    "keywords": ["RAG", "citation", "LLM", "retrieval"],
    "recent_papers": [
      {
        "id": 123,
        "title": "Example Paper",
        "venue": "ACL",
        "year": 2026,
        "read_at": "2026-07-07T12:00:00Z"
      }
    ],
    "heatmap_30d": [
      { "date": "2026-07-01", "count": 0 },
      { "date": "2026-07-02", "count": 3 }
    ]
  },
  "yearly_report": {
    "year": 2026,
    "papers_read": 19,
    "ai_questions": 86,
    "tokens_used": 391200,
    "top_field": "Natural Language Processing",
    "top_feature": "论文问答",
    "top_month": "June",
    "badges_unlocked": 5,
    "persona": "深度钻研型",
    "persona_reason": "你在少量核心论文上进行了高密度追问和总结。"
  }
}
```

## 数据表建议

### `user_usage_logs`

记录每一次 AI 调用，为 token 计费和审计做准备。

```sql
CREATE TABLE IF NOT EXISTS public.user_usage_logs (
    id BIGSERIAL PRIMARY KEY,
    user_key VARCHAR(240) NOT NULL,
    feature VARCHAR(80) NOT NULL,
    model VARCHAR(160),
    input_tokens INT DEFAULT 0,
    output_tokens INT DEFAULT 0,
    total_tokens INT DEFAULT 0,
    status VARCHAR(40) DEFAULT 'success',
    metadata_json JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_usage_logs_user_time
ON public.user_usage_logs(user_key, created_at DESC);
```

### `user_daily_stats`

按天聚合用户行为，便于快速展示趋势和年度报告。

```sql
CREATE TABLE IF NOT EXISTS public.user_daily_stats (
    id BIGSERIAL PRIMARY KEY,
    user_key VARCHAR(240) NOT NULL,
    date DATE NOT NULL,
    papers_read INT DEFAULT 0,
    ai_questions INT DEFAULT 0,
    summaries_generated INT DEFAULT 0,
    citations_generated INT DEFAULT 0,
    tokens_used INT DEFAULT 0,
    active_score INT DEFAULT 0,
    metadata_json JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_key, date)
);
```

### `achievement_definitions`

徽章定义表。第一版也可以直接写在前端常量中。

```sql
CREATE TABLE IF NOT EXISTS public.achievement_definitions (
    id VARCHAR(120) PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(80) NOT NULL,
    metric VARCHAR(120) NOT NULL,
    threshold INT NOT NULL,
    icon VARCHAR(80),
    level VARCHAR(40) DEFAULT 'bronze',
    sort_order INT DEFAULT 0,
    enabled BOOLEAN DEFAULT TRUE
);
```

### `user_achievements`

用户徽章解锁记录。

```sql
CREATE TABLE IF NOT EXISTS public.user_achievements (
    id BIGSERIAL PRIMARY KEY,
    user_key VARCHAR(240) NOT NULL,
    achievement_id VARCHAR(120) NOT NULL REFERENCES public.achievement_definitions(id),
    progress INT DEFAULT 0,
    unlocked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_key, achievement_id)
);
```

## 前端 fallback 建议

不允许用静态 mock 冒充真实数据。接口失败或后端暂时没有统计数据时，前端应显示空状态，例如：

```js
const emptyGrowthSummary = {
  profile: null,
  usage: null,
  activity: null,
  token_trend: [],
  feature_usage: [],
  recent_calls: [],
  achievements: [],
  research_profile: {
    top_fields: [],
    keywords: [],
    recent_papers: [],
    heatmap_30d: [],
  },
  yearly_report: null,
};
```

页面可以提示「暂无统计数据，使用论文问答和总结后会自动生成」。

## Token 来源建议

优先在调用 LLM 的统一封装处记录 token。如果当前模型返回 usage 字段，就使用返回值；如果没有返回 usage，第一版可以估算：

```text
input_tokens ~= prompt.length / 4
output_tokens ~= answer.length / 4
```

估算值必须在返回字段或 metadata 中标记为 fallback，例如 `estimated: true`，后续可替换为真实 provider usage。
