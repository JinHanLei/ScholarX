import { useEffect, useState } from 'react';
import { request } from './shared.jsx';

export default function useReviewProgress(projectId, epoch) {
  const [progress, setProgress] = useState({});
  useEffect(() => {
    setProgress({});
    if (!projectId) return;
    let live = true; let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const { reviews } = await request(`/projects/${projectId}/reviews`);
        if (!live) return;
        const next = {};
        for (const [stage, rebuttal] of [['Review', true], ['Polish', false]]) {
          const job = reviews.find((r) => (r.scope?.mode === 'rebuttal') === rebuttal);
          if (job) next[stage] = job.status === 'running' ? 'running' : job.status === 'completed' ? 'completed' : 'pending';
        }
        setProgress(next);
      } catch { /* Keep last known progress when temporarily offline. */ }
      finally { pending = false; }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [projectId, epoch]);
  return progress;
}
