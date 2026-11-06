import { useEffect, useRef, useState } from 'react';
import { request } from './shared.jsx';

export default function useLiteratureAssist(project, kind, resource = 'literature') {
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, [project?.id]);
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [submittedText, setSubmittedText] = useState('');
  useEffect(() => {
    if (!task?.session_id || !['starting', 'running', 'idle', 'waiting_approval'].includes(task.status)) return;
    let live = true, timer;
    const run = generation.current;
    const poll = async () => {
      try { const value = await request(`/projects/${project.id}/${resource}/assist/${task.session_id}`); if (live && run === generation.current) { setTask(value); if (['starting', 'running', 'idle', 'waiting_approval'].includes(value.status)) timer = setTimeout(poll, 1300); } }
      catch (e) { if (live && run === generation.current) { setError(e.message); setTask((old) => ({ ...old, status: 'failed' })); } }
    };
    poll(); return () => { live = false; clearTimeout(timer); };
  }, [task?.session_id, task?.status, project?.id, resource]);
  const start = async (text, extra = {}) => {
    const run = ++generation.current;
    setError(''); setStarting(true); setTask(null); setSubmittedText(text);
    try { const value = await request(`/projects/${project.id}/${resource}/assist`, { method: 'POST', body: { kind, text, ...extra } }); if (run === generation.current) setTask({ ...value, status: 'running' }); }
    catch (e) { if (run === generation.current) setError(e.message); } finally { if (run === generation.current) setStarting(false); }
  };
  const stop = async () => { try { await request(`/sessions/${task.session_id}/interrupt`, { method: 'POST', body: {} }); setTask((old) => ({ ...old, status: 'interrupted' })); } catch (e) { setError(e.message); } };
  const reset = () => { generation.current += 1; setTask(null); setError(''); setStarting(false); };
  const busy = starting || ['running', 'starting', 'idle', 'waiting_approval'].includes(task?.status);
  return { task, submittedText, error: error || task?.error || (task?.status === 'interrupted' ? '任务已停止，可重新发起。' : ''), busy, start, stop, reset };
}
