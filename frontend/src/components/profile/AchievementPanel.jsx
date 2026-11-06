import React from 'react';
import { BookOpen, Flame, MessageCircle, FileText, Award, Lock, Globe } from 'lucide-react';

const T = {
  zh: {
    title: '成就徽章',
    earned: '已获得',
    inProgress: '进行中',
    locked: '未解锁',
    empty: '暂无徽章数据，使用论文问答和总结后会自动生成。',
  },
  en: {
    title: 'Achievements',
    earned: 'Earned',
    inProgress: 'In Progress',
    locked: 'Locked',
    empty: 'No achievement data yet. Use paper Q&A and summarization to unlock badges.',
  },
};

const BADGE_DEFS = [
  { id: 'paper_reader_1', name: '初读者', nameEn: 'First Read', desc: '累计阅读 1 篇论文', descEn: 'Read 1 paper', icon: BookOpen, metric: 'papers_read_total', threshold: 1 },
  { id: 'paper_reader_10', name: '文献猎人', nameEn: 'Paper Hunter', desc: '累计阅读 10 篇论文', descEn: 'Read 10 papers', icon: BookOpen, metric: 'papers_read_total', threshold: 10 },
  { id: 'paper_reader_50', name: '深度研究者', nameEn: 'Deep Researcher', desc: '累计阅读 50 篇论文', descEn: 'Read 50 papers', icon: BookOpen, metric: 'papers_read_total', threshold: 50 },
  { id: 'streak_3', name: '三日连读', nameEn: '3-Day Streak', desc: '连续 3 天活跃', descEn: 'Active 3 days in a row', icon: Flame, metric: 'current_streak_days', threshold: 3 },
  { id: 'streak_7', name: '七日研究员', nameEn: '7-Day Researcher', desc: '连续 7 天活跃', descEn: 'Active 7 days in a row', icon: Flame, metric: 'current_streak_days', threshold: 7 },
  { id: 'ai_10', name: '提问新手', nameEn: 'AI Starter', desc: 'AI 提问 10 次', descEn: 'Ask AI 10 times', icon: MessageCircle, metric: 'ai_questions_year', threshold: 10 },
  { id: 'ai_100', name: '追问大师', nameEn: 'AI Master', desc: 'AI 提问 100 次', descEn: 'Ask AI 100 times', icon: MessageCircle, metric: 'ai_questions_year', threshold: 100 },
  { id: 'summary_20', name: '总结达人', nameEn: 'Summary Pro', desc: '生成 20 次论文总结', descEn: 'Generate 20 summaries', icon: FileText, metric: 'summaries_year', threshold: 20 },
  { id: 'citation_10', name: '引用整理师', nameEn: 'Citation Organizer', desc: '生成 10 条引用', descEn: 'Generate 10 citations', icon: Award, metric: 'citations_year', threshold: 10 },
  { id: 'cross_field_3', name: '跨学科探索者', nameEn: 'Cross-Discipline', desc: '阅读 3 个不同领域', descEn: 'Read papers from 3 fields', icon: Globe, metric: 'fields_count', threshold: 3 },
];

function lang(text) {
  return text?.common?.language === 'English' ? 'en' : 'zh';
}

function getMetricValue(activity, metric) {
  if (!activity) return 0;
  if (metric === 'fields_count') {
    const fields = activity.top_fields || [];
    return fields.length;
  }
  return activity[metric] || 0;
}

function computeBadges(growth) {
  const activity = growth?.activity || {};
  const userAchievements = growth?.achievements || [];
  const byId = {};
  userAchievements.forEach((a) => {
    byId[a.achievement_id || a.id] = a;
  });

  return BADGE_DEFS.map((def) => {
    const ua = byId[def.id];
    const progress = ua?.progress ?? getMetricValue(activity, def.metric);
    const threshold = def.threshold;
    const unlocked = ua?.unlocked || progress >= threshold;
    const unlockedAt = ua?.unlocked_at || null;
    return { ...def, progress, threshold, unlocked, unlockedAt };
  });
}

function BadgeCard({ badge, l }) {
  const Icon = badge.icon;
  const name = l === 'en' ? badge.nameEn : badge.name;
  const desc = l === 'en' ? badge.descEn : badge.desc;
  const percent = Math.min(100, Math.round((badge.progress / badge.threshold) * 100));

  return (
    <div
      style={{
        flex: '1 1 200px',
        maxWidth: '260px',
        padding: '14px',
        borderRadius: '8px',
        border: badge.unlocked ? '2px solid #fbbf24' : '2px solid #e5e7eb',
        background: badge.unlocked ? '#fffbeb' : '#fff',
        opacity: badge.unlocked ? 1 : 0.85,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: badge.unlocked ? '#fbbf24' : '#f3f4f6',
            color: badge.unlocked ? '#fff' : '#9ca3af',
          }}
        >
          <Icon size={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: '14px' }}>{name}</div>
          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{desc}</div>
        </div>
        {!badge.unlocked && <Lock size={14} color="#9ca3af" style={{ marginLeft: 'auto' }} />}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: '#e5e7eb', overflow: 'hidden' }}>
          <div
            style={{
              width: `${percent}%`,
              height: '100%',
              borderRadius: '3px',
              background: badge.unlocked ? '#fbbf24' : '#0ea5e9',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
        <span style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {badge.progress}/{badge.threshold}
        </span>
      </div>

      {badge.unlocked && badge.unlockedAt && (
        <div style={{ fontSize: '11px', color: '#d97706' }}>
          {l === 'en' ? 'Unlocked' : '已获得'} {badge.unlockedAt.slice(0, 10)}
        </div>
      )}
    </div>
  );
}

function AchievementPanel({ text, growth }) {
  const l = lang(text);
  const t = T[l];
  const badges = computeBadges(growth);
  const earned = badges.filter((b) => b.unlocked);
  const inProgress = badges.filter((b) => !b.unlocked && b.progress > 0);
  const locked = badges.filter((b) => !b.unlocked && b.progress === 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h2 style={{ margin: 0 }}>{t.title}</h2>

      {badges.length === 0 && <div className="account-card" style={{ color: 'var(--muted)' }}>{t.empty}</div>}

      {earned.length > 0 && (
        <div>
          <div style={{ fontSize: '13px', fontWeight: 800, marginBottom: '8px', color: '#b45309' }}>
            {t.earned} ({earned.length})
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {earned.map((b) => (
              <BadgeCard key={b.id} badge={b} l={l} />
            ))}
          </div>
        </div>
      )}

      {inProgress.length > 0 && (
        <div>
          <div style={{ fontSize: '13px', fontWeight: 800, marginBottom: '8px', color: '#0ea5e9' }}>
            {t.inProgress} ({inProgress.length})
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {inProgress.map((b) => (
              <BadgeCard key={b.id} badge={b} l={l} />
            ))}
          </div>
        </div>
      )}

      {locked.length > 0 && (
        <div>
          <div style={{ fontSize: '13px', fontWeight: 800, marginBottom: '8px', color: 'var(--muted)' }}>
            {t.locked} ({locked.length})
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {locked.map((b) => (
              <BadgeCard key={b.id} badge={b} l={l} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export { AchievementPanel };
