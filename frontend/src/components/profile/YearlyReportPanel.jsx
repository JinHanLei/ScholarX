import React, { useState } from 'react';
import { Share2, BookOpen, MessageCircle, Cpu, Tag, Calendar, Award, Lightbulb } from 'lucide-react';

const T = {
  zh: {
    title: '年度报告',
    reportTitle: 'EasyRef 学术足迹',
    papersRead: '今年阅读论文',
    aiQuestions: '今年 AI 提问',
    tokensUsed: '今年消耗 Token',
    topField: '最常阅读领域',
    topFeature: '最常使用功能',
    topKeywords: '高频关键词',
    topMonth: '最活跃月份',
    badgesUnlocked: '获得徽章',
    persona: '研究人格',
    personaReason: '人格画像',
    shareCard: '生成分享卡片',
    empty: '暂无年度数据，持续使用 EasyRef 生成你的专属报告。',
    personas: {
      deep: { name: '深度钻研型', reason: '你在少量核心论文上进行了高密度追问和总结。' },
      broad: { name: '广泛探索型', reason: '你涉猎多个领域，阅读面非常广泛。' },
      efficient: { name: '效率工具型', reason: '你善于使用 AI 工具加速阅读和写作。' },
      persistent: { name: '坚持积累型', reason: '你保持稳定的阅读习惯，日积月累。' },
    },
  },
  en: {
    title: 'Yearly Report',
    reportTitle: 'EasyRef Academic Footprint',
    papersRead: 'Papers read this year',
    aiQuestions: 'AI questions this year',
    tokensUsed: 'Tokens used this year',
    topField: 'Top field',
    topFeature: 'Top feature',
    topKeywords: 'Top keywords',
    topMonth: 'Most active month',
    badgesUnlocked: 'Badges unlocked',
    persona: 'Research persona',
    personaReason: 'Persona insight',
    shareCard: 'Generate share card',
    empty: 'No yearly data yet. Keep using EasyRef to build your report.',
    personas: {
      deep: { name: 'Deep Diver', reason: 'You focus deeply on a small set of core papers with intensive Q&A and summaries.' },
      broad: { name: 'Broad Explorer', reason: 'You explore many different fields and read widely.' },
      efficient: { name: 'Efficiency User', reason: 'You leverage AI tools to accelerate reading and writing.' },
      persistent: { name: 'Steady Accumulator', reason: 'You maintain a stable reading habit and accumulate knowledge over time.' },
    },
  },
};

function lang(text) {
  return text?.common?.language === 'English' ? 'en' : 'zh';
}

function PersonaBadge({ personaKey, t }) {
  const map = {
    '深度钻研型': 'deep',
    '广泛探索型': 'broad',
    '效率工具型': 'efficient',
    '坚持积累型': 'persistent',
    'Deep Diver': 'deep',
    'Broad Explorer': 'broad',
    'Efficiency User': 'efficient',
    'Steady Accumulator': 'persistent',
  };
  const key = map[personaKey] || 'deep';
  const p = t.personas[key];
  return (
    <div
      style={{
        padding: '16px',
        borderRadius: '8px',
        background: '#eef2ff',
        border: '2px solid #c7d2fe',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Lightbulb size={20} color="#6366f1" />
        <strong style={{ fontSize: '16px', color: '#4338ca' }}>{p.name}</strong>
      </div>
      <p style={{ margin: 0, fontSize: '13px', color: '#4f46e5' }}>{p.reason}</p>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div
      style={{
        flex: '1 1 160px',
        padding: '14px',
        borderRadius: '8px',
        background: '#fff',
        border: '2px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Icon size={16} color={color} />
        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{label}</span>
      </div>
      <div style={{ fontSize: '20px', fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function YearlyReportPanel({ text, growth }) {
  const l = lang(text);
  const t = T[l];
  const report = growth?.yearly_report;
  const [showCard, setShowCard] = useState(false);

  if (!report) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2 style={{ margin: 0 }}>{t.title}</h2>
        <div className="account-card" style={{ color: 'var(--muted)' }}>{t.empty}</div>
      </div>
    );
  }

  const year = report.year || new Date().getFullYear();
  const keywords = Array.isArray(report.keywords) ? report.keywords : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <h2 style={{ margin: 0 }}>{t.title}</h2>
        <button className="secondary-button" onClick={() => setShowCard((s) => !s)}>
          <Share2 size={14} /> {t.shareCard}
        </button>
      </div>

      {showCard && (
        <div
          style={{
            padding: '24px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ fontSize: '12px', opacity: 0.9 }}>{year}</div>
          <div style={{ fontSize: '22px', fontWeight: 900 }}>{t.reportTitle}</div>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 900 }}>{report.papers_read || 0}</div>
              <div style={{ fontSize: '12px', opacity: 0.9 }}>{t.papersRead}</div>
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 900 }}>{report.ai_questions || 0}</div>
              <div style={{ fontSize: '12px', opacity: 0.9 }}>{t.aiQuestions}</div>
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 900 }}>{(report.tokens_used || 0).toLocaleString()}</div>
              <div style={{ fontSize: '12px', opacity: 0.9 }}>{t.tokensUsed}</div>
            </div>
          </div>
          <div style={{ marginTop: '4px', fontSize: '14px', fontWeight: 800 }}>{report.persona || ''}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <StatCard icon={BookOpen} label={t.papersRead} value={report.papers_read || 0} color="#10b981" />
        <StatCard icon={MessageCircle} label={t.aiQuestions} value={report.ai_questions || 0} color="#0ea5e9" />
        <StatCard icon={Cpu} label={t.tokensUsed} value={(report.tokens_used || 0).toLocaleString()} color="#8b5cf6" />
        <StatCard icon={Tag} label={t.topField} value={report.top_field || '—'} color="#f59e0b" />
        <StatCard icon={Calendar} label={t.topMonth} value={report.top_month || '—'} color="#ef4444" />
        <StatCard icon={Award} label={t.badgesUnlocked} value={report.badges_unlocked || 0} color="#ec4899" />
      </div>

      <div className="account-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ fontSize: '13px', fontWeight: 800 }}>{t.topFeature}</div>
        <div style={{ fontSize: '15px' }}>{report.top_feature || '—'}</div>
      </div>

      {keywords.length > 0 && (
        <div className="account-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '13px', fontWeight: 800 }}>{t.topKeywords}</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {keywords.map((k) => (
              <span
                key={k}
                style={{
                  padding: '4px 10px',
                  borderRadius: '999px',
                  background: '#eef2ff',
                  color: '#4338ca',
                  fontSize: '12px',
                  fontWeight: 700,
                }}
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      <PersonaBadge personaKey={report.persona} t={t} />
    </div>
  );
}

export { YearlyReportPanel };
