import { useEffect, useState } from 'react';
import { request } from './shared.jsx';

export default function useLiteratureAssist(project, kind) {
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [submittedText, setSubmittedText] = useState('');
  useEffect(() => {
    if (!task?.session_id || !['starting', 'running', 'idle', 'waiting_approval'].includes(task.status)) return;
    let live = true, timer;
    const poll = async () => {
      try { const value = await request(`/projects/${project.id}/literature/assist/${task.session_id}`); if (live) { setTask(value); if (['starting', 'running', 'idle', 'waiting_approval'].includes(value.status)) timer = setTimeout(poll, 1300); } }
      catch (e) { if (live) { setError(e.message); setTask((old) => ({ ...old, status: 'failed' })); } }
    };
    poll(); return () => { live = false; clearTimeout(timer); };
  }, [task?.session_id, task?.status, project?.id]);
  const start = async (text, extra = {}) => {
    setError(''); setStarting(true); setTask(null); setSubmittedText(text);
    try { const value = await request(`/projects/${project.id}/literature/assist`, { method: 'POST', body: { kind, text, ...extra } }); setTask({ ...value, status: 'running' }); }
    catch (e) { setError(e.message); } finally { setStarting(false); }
  };
  const stop = async () => { try { await request(`/sessions/${task.session_id}/interrupt`, { method: 'POST', body: {} }); setTask((old) => ({ ...old, status: 'interrupted' })); } catch (e) { setError(e.message); } };
  const busy = starting || ['running', 'starting', 'idle', 'waiting_approval'].includes(task?.status);
  const reset = () => { setTask(null); setError(''); };
  return { task, submittedText, error: error || task?.error || (task?.status === 'interrupted' ? '任务已停止，可重新发起。' : ''), busy, start, stop, reset };
}
