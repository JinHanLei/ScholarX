import { api } from '../../utils/api.js';

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

async function fetchGrowthSummary(userKey, year = new Date().getFullYear(), range = '30d') {
  try {
    const data = await api(`/user-growth/summary?user_key=${encodeURIComponent(userKey || 'local')}&year=${year}&range=${range}`);
    return { data, error: null };
  } catch (err) {
    if (err.message && (err.message.includes('404') || err.message.includes('Not Found') || err.message.includes('不存在'))) {
      return { data: emptyGrowthSummary, error: null };
    }
    return { data: emptyGrowthSummary, error: err.message };
  }
}

async function fetchLibraries() {
  try {
    const data = await api('/libraries');
    return { libraries: data.libraries || [], error: null };
  } catch (err) {
    return { libraries: [], error: err.message };
  }
}

function deriveActivityFromLibraries(libraries) {
  let papersReadTotal = 0;
  (libraries || []).forEach((lib) => {
    papersReadTotal += lib.paper_count || 0;
  });
  return { papersReadTotal };
}

export { fetchGrowthSummary, fetchLibraries, deriveActivityFromLibraries, emptyGrowthSummary };
