import React, { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Avatar } from './Avatar.jsx';
import { ProfileOverview } from './ProfileOverview.jsx';
import { TokenUsagePanel } from './TokenUsagePanel.jsx';
import { AchievementPanel } from './AchievementPanel.jsx';
import { YearlyReportPanel } from './YearlyReportPanel.jsx';
import { PlanBenefitsPanel } from './PlanBenefitsPanel.jsx';
import { SettingsPanel } from './SettingsPanel.jsx';
import { fetchGrowthSummary, fetchLibraries, deriveActivityFromLibraries, emptyGrowthSummary } from './profileApi.js';

const TAB_DEFS = [
  { key: 'overview', zh: '概览', en: 'Overview' },
  { key: 'token', zh: 'Token 统计', en: 'Tokens' },
  { key: 'achievements', zh: '成就徽章', en: 'Badges' },
  { key: 'yearly', zh: '年度报告', en: 'Report' },
  { key: 'plan', zh: '账户权益', en: 'Plan' },
  { key: 'settings', zh: '设置', en: 'Settings' },
];

function ProfilePage({ text, user, userEmail, onBack, supabase }) {
  const [tab, setTab] = useState('overview');
  const [growth, setGrowth] = useState(emptyGrowthSummary);
  const [libraryCount, setLibraryCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  const isEnglish = text?.common?.language === 'English';
  const title = isEnglish ? 'Academic Growth Center' : '学术成长中心';
  const desc = isEnglish
    ? 'Your data center for tokens, achievements, and yearly insights.'
    : 'Token 用量、成就徽章与年度学术总结的一站式数据中心。';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setPageError('');
      try {
        const [{ data: growthData }, { libraries }] = await Promise.all([
          fetchGrowthSummary(userEmail),
          fetchLibraries(),
        ]);
        if (cancelled) return;
        const derived = deriveActivityFromLibraries(libraries);
        setLibraryCount(derived.papersReadTotal);
        setGrowth(growthData);
      } catch (err) {
        if (!cancelled) setPageError(err.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [userEmail]);

  const renderTab = () => {
    switch (tab) {
      case 'overview':
        return (
          <ProfileOverview
            text={text}
            user={user}
            userEmail={userEmail}
            growth={growth}
            libraryCount={libraryCount}
            onTab={setTab}
          />
        );
      case 'token':
        return <TokenUsagePanel text={text} growth={growth} />;
      case 'achievements':
        return <AchievementPanel text={text} growth={growth} />;
      case 'yearly':
        return <YearlyReportPanel text={text} growth={growth} />;
      case 'plan':
        return <PlanBenefitsPanel text={text} growth={growth} />;
      case 'settings':
        return <SettingsPanel text={text} user={user} userEmail={userEmail} supabase={supabase} />;
      default:
        return null;
    }
  };

  return (
    <main className="account-shell">
      <section className="account-page">
        <button className="secondary-button account-back" onClick={onBack}>
          <ChevronLeft size={16} /> {text.common.backToWorkbench}
        </button>

        <header>
          <div>
            <h1>{title}</h1>
            <p>{desc}</p>
          </div>
          <Avatar user={user} size={72} />
        </header>

        {pageError && <div className="error-banner">{pageError}</div>}

        <div
          style={{
            display: 'flex',
            gap: '6px',
            overflowX: 'auto',
            paddingBottom: '4px',
          }}
        >
          {TAB_DEFS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: active ? '2px solid #0ea5e9' : '2px solid transparent',
                  background: active ? '#e0f2fe' : '#fff',
                  color: active ? '#0369a1' : 'var(--ink)',
                  fontWeight: 800,
                  fontSize: '13px',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  boxShadow: active ? 'none' : 'var(--shadow-hard)',
                }}
              >
                {isEnglish ? t.en : t.zh}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="account-card" style={{ color: 'var(--muted)', textAlign: 'center' }}>
            {isEnglish ? 'Loading…' : '加载中…'}
          </div>
        ) : (
          renderTab()
        )}
      </section>
    </main>
  );
}

export { ProfilePage };
