import { useEffect, useState } from 'react';
import { request } from '../shared.jsx';
export default function useIdeaVersions(projectId) {
  const [versions, setVersions] = useState([]), [error, setError] = useState('');
  useEffect(() => {
    setVersions([]); setError('');
    if (!projectId) return;
    let live = true, timer, loading = false;
    const load = async () => {
      if (loading) return; loading = true; clearTimeout(timer);
      try { const value = await request(`/projects/${projectId}/idea-versions`); if (live) { setVersions(value.versions); setError(''); } }
      catch (e) { if (live) setError(e.message); }
      finally { loading = false; if (live) timer = setTimeout(load, 1800); }
    };
    load(); window.addEventListener('easyref:idea-saved', load);
    return () => { live = false; clearTimeout(timer); window.removeEventListener('easyref:idea-saved', load); };
  }, [projectId]);
  return { versions, error };
}
