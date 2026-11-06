import React from 'react';
import { Check, Sparkles, Zap } from 'lucide-react';

const T = {
  zh: {
    title: '账户权益',
    currentPlan: '当前套餐',
    free: 'Free',
    pro: 'Pro',
    proPlus: 'Pro Plus',
    monthlyTokens: '月 Token 额度',
    dailySummaries: '每日论文总结',
    advancedCompare: '高级文献对比',
    yearlyReport: '年度报告',
    batchExport: '批量导出',
    upgrade: '升级套餐',
    comingSoon: '敬请期待',
    planFreeDesc: '适合轻度使用者',
    planProDesc: '适合进阶研究者',
    planProPlusDesc: '适合团队与高产学者',
    unlimited: '不限',
    included: '包含',
    notIncluded: '—',
    resetAt: '额度重置时间',
  },
  en: {
    title: 'Plan Benefits',
    currentPlan: 'Current Plan',
    free: 'Free',
    pro: 'Pro',
    proPlus: 'Pro Plus',
    monthlyTokens: 'Monthly Tokens',
    dailySummaries: 'Daily Summaries',
    advancedCompare: 'Advanced Compare',
    yearlyReport: 'Yearly Report',
    batchExport: 'Batch Export',
    upgrade: 'Upgrade',
    comingSoon: 'Coming Soon',
    planFreeDesc: 'For light users',
    planProDesc: 'For advanced researchers',
    planProPlusDesc: 'For teams and power users',
    unlimited: 'Unlimited',
    included: 'Included',
    notIncluded: '—',
    resetAt: 'Quota resets at',
  },
};

function lang(text) {
  return text?.common?.language === 'English' ? 'en' : 'zh';
}

function PlanCard({ name, desc, price, features, active, t }) {
  return (
    <div
      style={{
        flex: '1 1 220px',
        padding: '18px',
        borderRadius: '8px',
        border: active ? '2px solid #0ea5e9' : '2px solid #e5e7eb',
        background: '#fff',
        boxShadow: active ? '0 4px 12px rgba(14,165,233,0.12)' : 'var(--shadow-hard)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {name === 'Pro' && <Zap size={18} color="#f59e0b" />}
        {name === 'Pro Plus' && <Sparkles size={18} color="#8b5cf6" />}
        <strong style={{ fontSize: '16px' }}>{name}</strong>
        {active && (
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#0ea5e9', fontWeight: 800 }}>
            {t.currentPlan}
          </span>
        )}
      </div>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: '13px' }}>{desc}</p>
      <div style={{ fontSize: '22px', fontWeight: 900 }}>{price}</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {features.map((f, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            {f.included ? <Check size={14} color="#10b981" /> : <span style={{ width: '14px' }} />}
            <span style={{ color: f.included ? 'var(--ink)' : 'var(--muted)' }}>{f.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanBenefitsPanel({ text, growth }) {
  const l = lang(text);
  const t = T[l];
  const plan = growth?.profile?.plan || 'free';
  const planLabel = growth?.profile?.plan_label || t.free;
  const resetAt = growth?.profile?.quota_reset_at || '';

  const plans = [
    {
      key: 'free',
      name: t.free,
      desc: t.planFreeDesc,
      price: '¥0',
      features: [
        { label: `${t.monthlyTokens}: 100K`, included: true },
        { label: `${t.dailySummaries}: 5`, included: true },
        { label: `${t.advancedCompare}: ${t.notIncluded}`, included: false },
        { label: `${t.yearlyReport}: ${t.notIncluded}`, included: false },
        { label: `${t.batchExport}: ${t.notIncluded}`, included: false },
      ],
    },
    {
      key: 'pro',
      name: t.pro,
      desc: t.planProDesc,
      price: '¥29',
      features: [
        { label: `${t.monthlyTokens}: 500K`, included: true },
        { label: `${t.dailySummaries}: 20`, included: true },
        { label: `${t.advancedCompare}: ${t.included}`, included: true },
        { label: `${t.yearlyReport}: ${t.included}`, included: true },
        { label: `${t.batchExport}: ${t.included}`, included: true },
      ],
    },
    {
      key: 'pro_plus',
      name: t.proPlus,
      desc: t.planProPlusDesc,
      price: '¥99',
      features: [
        { label: `${t.monthlyTokens}: ${t.unlimited}`, included: true },
        { label: `${t.dailySummaries}: ${t.unlimited}`, included: true },
        { label: `${t.advancedCompare}: ${t.included}`, included: true },
        { label: `${t.yearlyReport}: ${t.included}`, included: true },
        { label: `${t.batchExport}: ${t.included}`, included: true },
      ],
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h2 style={{ margin: 0 }}>{t.title}</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: '13px' }}>
            {t.currentPlan}: <strong>{planLabel}</strong>
            {resetAt ? ` · ${t.resetAt} ${resetAt.slice(0, 10)}` : ''}
          </p>
        </div>
        <button className="primary-button" disabled>
          {t.upgrade} — {t.comingSoon}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        {plans.map((p) => (
          <PlanCard key={p.key} {...p} active={plan === p.key} t={t} />
        ))}
      </div>
    </div>
  );
}

export { PlanBenefitsPanel };
