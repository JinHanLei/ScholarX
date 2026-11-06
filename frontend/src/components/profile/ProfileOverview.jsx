import React from 'react';
import { BookOpen, Award, Cpu, Zap, Calendar, FileText, Globe } from 'lucide-react';
import { Avatar } from './Avatar.jsx';

const T = {
  zh: {
    title: '概览',
    papersRead: '已阅读论文',
    badgesEarned: '已获得徽章',
    tokensThisMonth: '本月 Token',
    currentPlan: '当前套餐',
    yearlyReport: '年度报告',
    goToReport: '查看报告',
    researchProfile: '研究画像',
    topFields: '研究领域',
    keywords: '关键词',
    recentPapers: '最近阅读',
    heatmap: '近 30 天活跃',
    emptyActivity: '暂无活动数据，使用论文库和 AI 功能后会自动生成。',
    emptyPapers: '暂无最近阅读记录',
    free: 'Free',
  },
  en: {
    title: 'Overview',
    papersRead: 'Papers read',
    badgesEarned: 'Badges earned',
    tokensThisMonth: 'Tokens this month',
    currentPlan: 'Current plan',
    yearlyReport: 'Yearly Report',
    goToReport: 'View report',
    researchProfile: 'Research Profile',
    topFields: 'Top fields',
    keywords: 'Keywords',
    recentPapers: 'Recent papers',
    heatmap: 'Last 30 days activity',
    emptyActivity: 'No activity data yet. Use libraries and AI features to generate insights.',
    emptyPapers: 'No recent papers',
    free: 'Free',
  },
};

function lang(text) {
  return text?.common?.language === 'English' ? 'en' : 'zh';
}

function formatNumber(n) {
  if (n === undefined || n === null) return '0';
  return n.toLocaleString();
}

function MiniStat({ icon: Icon, label, value, color }) {
  return (
    <div
      style={{
        flex: '1 1 140px',
        padding: '12px',
        borderRadius: '8px',
        background: '#fff',
        border: '2px solid var(--line)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}
    >
      <div
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          background: color + '18',
          color,
          flex: '0 0 auto',
        }}
      >
        <Icon size={18} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{label}</div>
        <div style={{ fontSize: '16px', fontWeight: 900 }}>{value}</div>
      </div>
    </div>
  );
}

function Heatmap({ data }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.count || 0), 1);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
      {data.map((d, i) => {
        const intensity = d.count / max;
        const bg = intensity === 0 ? '#e5e7eb' : `rgba(14,165,233, ${0.15 + intensity * 0.85})`;
        return (
          <div
            key={i}
            title={`${d.date}: ${d.count}`}
            style={{
              aspectRatio: '1',
              borderRadius: '3px',
              background: bg,
            }}
          />
        );
      })}
    </div>
  );
}

function ProfileOverview({ text, user, userEmail, growth, libraryCount, onTab }) {
  const l = lang(text);
  const t = T[l];
  const activity = growth?.activity || {};
  const usage = growth?.usage || {};
  const report = growth?.yearly_report;
  const research = growth?.research_profile || {};
  const planLabel = growth?.profile?.plan_label || t.free;
  const badges = growth?.achievements || [];
  const earnedCount = badges.filter((b) => b.unlocked).length || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div
        className="account-card"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        <Avatar user={user} size={64} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '16px', fontWeight: 900 }}>{userEmail || (l === 'en' ? 'Local user' : '本地用户')}</div>
          <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Zap size={12} /> {t.currentPlan}: <strong>{planLabel}</strong>
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <MiniStat icon={BookOpen} label={t.papersRead} value={activity.papers_read_total || libraryCount || 0} color="#10b981" />
        <MiniStat icon={Award} label={t.badgesEarned} value={earnedCount} color="#f59e0b" />
        <MiniStat icon={Cpu} label={t.tokensThisMonth} value={formatNumber(usage.tokens_month || 0)} color="#0ea5e9" />
        <MiniStat icon={Zap} label={t.currentPlan} value={planLabel} color="#8b5cf6" />
      </div>

      {report && (
        <div
          className="account-card"
          style={{
            cursor: 'pointer',
            background: '#eef2ff',
            border: '2px solid #c7d2fe',
          }}
          onClick={() => onTab('yearly')}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#4338ca' }}>{report.year} {t.yearlyReport}</div>
              <div style={{ fontSize: '12px', color: '#4f46e5', marginTop: '4px' }}>
                {report.papers_read || 0} {t.papersRead} · {report.ai_questions || 0} {t.aiQuestions || 'AI questions'} · {report.persona || ''}
              </div>
            </div>
            <span style={{ fontSize: '12px', color: '#4338ca', fontWeight: 800 }}>{t.goToReport} →</span>
          </div>
        </div>
      )}

      <div className="account-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '14px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Globe size={16} /> {t.researchProfile}
        </div>

        {research.top_fields && research.top_fields.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>{t.topFields}</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {research.top_fields.map((f) => (
                <span
                  key={f.name}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '999px',
                    background: '#eef2ff',
                    color: '#4338ca',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  {f.name} ({f.count})
                </span>
              ))}
            </div>
          </div>
        )}

        {research.keywords && research.keywords.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>{t.keywords}</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {research.keywords.map((k) => (
                <span
                  key={k}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '999px',
                    background: '#f0fdf4',
                    color: '#166534',
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

        {research.recent_papers && research.recent_papers.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>{t.recentPapers}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {research.recent_papers.slice(0, 5).map((p) => (
                <div
                  key={p.id}
                  style={{
                    padding: '8px',
                    borderRadius: '6px',
                    background: '#f8fafd',
                    fontSize: '13px',
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{p.title}</div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    {p.venue} {p.year} · {p.read_at?.slice(0, 10)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {research.heatmap_30d && research.heatmap_30d.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '6px' }}>{t.heatmap}</div>
            <Heatmap data={research.heatmap_30d} />
          </div>
        )}

        {!research.top_fields?.length && !research.keywords?.length && !research.recent_papers?.length && (
          <div style={{ color: 'var(--muted)', fontSize: '13px' }}>{t.emptyActivity}</div>
        )}
      </div>
    </div>
  );
}

export { ProfileOverview };
