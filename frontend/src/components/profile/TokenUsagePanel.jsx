import React, { useState } from 'react';
import { TrendingUp, Activity, Cpu, Layers } from 'lucide-react';

const T = {
  zh: {
    title: 'Token 统计',
    today: '今日消耗',
    month: '本月消耗',
    total: '总计消耗',
    remaining: '剩余额度',
    trend7d: '近 7 天趋势',
    trend30d: '近 30 天趋势',
    featureShare: '功能消耗占比',
    recentCalls: '最近调用记录',
    model: '模型',
    feature: '功能',
    inputTokens: '输入',
    outputTokens: '输出',
    status: '状态',
    emptyCalls: '暂无调用记录',
    emptyTrend: '暂无趋势数据',
    emptyFeatures: '暂无功能占比数据',
    success: '成功',
    estimated: '估算',
  },
  en: {
    title: 'Token Usage',
    today: 'Today',
    month: 'This Month',
    total: 'Total',
    remaining: 'Remaining',
    trend7d: 'Last 7 Days',
    trend30d: 'Last 30 Days',
    featureShare: 'Feature Usage',
    recentCalls: 'Recent Calls',
    model: 'Model',
    feature: 'Feature',
    inputTokens: 'Input',
    outputTokens: 'Output',
    status: 'Status',
    emptyCalls: 'No recent calls',
    emptyTrend: 'No trend data',
    emptyFeatures: 'No feature usage data',
    success: 'Success',
    estimated: 'Estimated',
  },
};

const FEATURE_COLORS = {
  paper_summary: '#10b981',
  paper_qa: '#0ea5e9',
  translate: '#f59e0b',
  citation: '#8b5cf6',
  recommend: '#ec4899',
};

function lang(text) {
  return text?.common?.language === 'English' ? 'en' : 'zh';
}

function formatNumber(n) {
  if (n === undefined || n === null) return '0';
  return n.toLocaleString();
}

function StatCard({ label, value, color }) {
  return (
    <div
      style={{
        flex: '1 1 140px',
        padding: '14px',
        borderRadius: '8px',
        background: '#fff',
        border: '2px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontSize: '20px', fontWeight: 900, color }}>{formatNumber(value)}</span>
    </div>
  );
}

function ProgressBar({ used, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
        <span style={{ color: 'var(--muted)' }}>{pct}%</span>
        <span style={{ color: 'var(--muted)' }}>
          {formatNumber(used)} / {formatNumber(total)}
        </span>
      </div>
      <div style={{ height: '8px', borderRadius: '4px', background: '#e5e7eb', overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: '4px',
            background: pct > 90 ? '#ef4444' : '#0ea5e9',
            transition: 'width 0.4s ease',
          }}
        />
      </div>
    </div>
  );
}

function TrendChart({ data, l }) {
  if (!data || data.length === 0) {
    return <div style={{ color: 'var(--muted)', fontSize: '13px' }}>{l === 'en' ? T.en.emptyTrend : T.zh.emptyTrend}</div>;
  }
  const max = Math.max(...data.map((d) => d.tokens || 0), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '120px', paddingTop: '10px' }}>
      {data.map((d, i) => {
        const h = Math.max(4, Math.round(((d.tokens || 0) / max) * 100));
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <div
              style={{
                width: '100%',
                maxWidth: '32px',
                height: `${h}%`,
                minHeight: '4px',
                borderRadius: '4px 4px 0 0',
                background: '#0ea5e9',
                opacity: 0.7 + (h / 200),
              }}
              title={`${d.date}: ${d.tokens}`}
            />
            <span style={{ fontSize: '10px', color: 'var(--muted)' }}>{d.date?.slice(5) || ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function FeatureShare({ data }) {
  if (!data || data.length === 0) {
    return <div style={{ color: 'var(--muted)', fontSize: '13px' }}>{T.zh.emptyFeatures}</div>;
  }
  const total = data.reduce((sum, d) => sum + (d.tokens || 0), 0) || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {data.map((d, i) => {
        const pct = Math.round(((d.tokens || 0) / total) * 100);
        const color = FEATURE_COLORS[d.feature] || '#94a3b8';
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span>{d.label || d.feature}</span>
              <span style={{ color: 'var(--muted)' }}>{pct}% · {formatNumber(d.tokens)}</span>
            </div>
            <div style={{ height: '6px', borderRadius: '3px', background: '#e5e7eb', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  borderRadius: '3px',
                  background: color,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TokenUsagePanel({ text, growth }) {
  const l = lang(text);
  const t = T[l];
  const usage = growth?.usage || {};
  const trend = growth?.token_trend || [];
  const features = growth?.feature_usage || [];
  const calls = growth?.recent_calls || [];
  const quota = growth?.profile?.quota_monthly_tokens || 100000;

  const [range, setRange] = useState('7d');
  const displayTrend = range === '7d' ? trend.slice(-7) : trend.slice(-30);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h2 style={{ margin: 0 }}>{t.title}</h2>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <StatCard label={t.today} value={usage.tokens_today || 0} color="#10b981" />
        <StatCard label={t.month} value={usage.tokens_month || 0} color="#0ea5e9" />
        <StatCard label={t.total} value={usage.tokens_total || 0} color="#8b5cf6" />
        <StatCard label={t.remaining} value={usage.tokens_remaining ?? Math.max(0, quota - (usage.tokens_month || 0))} color="#f59e0b" />
      </div>

      <div className="account-card">
        <ProgressBar used={usage.tokens_month || 0} total={quota} />
      </div>

      <div className="account-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '13px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <TrendingUp size={14} /> {range === '7d' ? t.trend7d : t.trend30d}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              className={`secondary-button ${range === '7d' ? 'active' : ''}`}
              style={{ padding: '4px 8px', fontSize: '12px' }}
              onClick={() => setRange('7d')}
            >
              7d
            </button>
            <button
              className={`secondary-button ${range === '30d' ? 'active' : ''}`}
              style={{ padding: '4px 8px', fontSize: '12px' }}
              onClick={() => setRange('30d')}
            >
              30d
            </button>
          </div>
        </div>
        <TrendChart data={displayTrend} l={l} />
      </div>

      <div className="account-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ fontSize: '13px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Layers size={14} /> {t.featureShare}
        </div>
        <FeatureShare data={features} />
      </div>

      <div className="account-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ fontSize: '13px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Activity size={14} /> {t.recentCalls}
        </div>
        {calls.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: '13px' }}>{t.emptyCalls}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{t.feature}</th>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{t.model}</th>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{t.inputTokens}</th>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{t.outputTokens}</th>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Total</th>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{t.status}</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id}>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line-soft)' }}>{c.feature_label || c.feature}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line-soft)' }}>{c.model}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line-soft)' }}>{formatNumber(c.input_tokens)}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line-soft)' }}>{formatNumber(c.output_tokens)}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line-soft)', fontWeight: 800 }}>{formatNumber(c.total_tokens)}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line-soft)' }}>
                      <span style={{ color: c.status === 'success' ? '#10b981' : '#ef4444', fontSize: '12px' }}>
                        {c.status === 'success' ? t.success : c.status}
                      </span>
                      {c.estimated && <span style={{ fontSize: '11px', color: 'var(--muted)', marginLeft: '4px' }}>({t.estimated})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export { TokenUsagePanel };
