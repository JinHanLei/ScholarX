import React, { useEffect, useRef, useState } from 'react';
import { Bot, Globe, Send, Square, X, MessageSquare } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { request } from './shared.jsx';
import useLiteratureAssist from './useLiteratureAssist.js';
import LiteratureSearchResults from './LiteratureSearchResults.jsx';

export default function LiteratureChatSearch({ project, initialQuery = '', initialNetwork = false, onClose, onBack, onSession, onAdded }) {
  const [prompt, setPrompt] = useState(initialQuery);
  const [question, setQuestion] = useState('');
  const [network, setNetwork] = useState(initialNetwork);
  const [history, setHistory] = useState([]);
  const [result, setResult] = useState(null);
  const [params, setParams] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const started = useRef(false);
  const assist = useLiteratureAssist(project, 'search');
  useEffect(() => {
    let live = true;
    request(`/projects/${project.id}/literature/searches`).then((r) => {
      if (!live) return;
      setHistory(r.searches);
      if (!started.current && r.searches[0]) {
        const last = r.searches[0]; setQuestion(last.text); setNetwork(last.network); assist.restore(last.id);
      }
    }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; generation.current++; };
  }, [project.id]);
  useEffect(() => {
    if (!assist.task?.session_id) return;
    let live = true;
    request(`/projects/${project.id}/literature/searches`).then((r) => { if (live) setHistory(r.searches); }).catch(() => {});
    return () => { live = false; };
  }, [assist.task?.session_id, project.id]);
  const run = async (next, offset = 0) => {
    const version = ++generation.current; setBusy(true); setError('');
    try {
      const r = await request('/literature/search?' + new URLSearchParams({ ...next, offset, limit: 30 }));
      if (version === generation.current) { setResult(r); setParams(next); }
    } catch (e) { if (version === generation.current) setError(e.message); }
    finally { if (version === generation.current) setBusy(false); }
  };
  useEffect(() => {
    if (!assist.task?.output) return;
    const next = Object.fromEntries(Object.entries(assist.task.output).filter(([key, value]) => !['papers', 'explanation', 'venue'].includes(key) && value != null));
    run(next);
  }, [assist.task?.output]);
  const send = (event) => {
    event.preventDefault(); started.current = true; generation.current++; setBusy(false); setResult(null); setError('');
    const text = prompt.trim(); setQuestion(text); setPrompt('');
    assist.start(text, { network, history: question ? [question.slice(0, 4000)] : [] });
  };
  const selectHistory = (id) => {
    const item = history.find((row) => row.id === id); if (!item) return;
    started.current = true; generation.current++; setBusy(false); setResult(null); setError('');
    setQuestion(item.text); setNetwork(item.network); assist.restore(id);
  };
  return <aside className="rw-assistant lit-chat-search">
    <header><button className="rw-icon" title="收起文献检索聊天" aria-label="收起文献检索聊天" onClick={onClose}><X size={15} /></button><div className="rw-toolbar"><Bot size={19} /><strong>Codex · 文献检索</strong></div><button className="rw-icon" title="普通聊天" aria-label="普通聊天" onClick={onBack}><MessageSquare size={16} /></button></header>
    <div className="rw-assistant-scroll">
      {history.length > 0 && <select aria-label="文献检索记录" value={assist.task?.session_id || ''} disabled={assist.busy || busy} onChange={(e) => selectHistory(e.target.value)}><option value="">新的检索</option>{history.map((item) => <option key={item.id} value={item.id}>{item.text.slice(0, 65)}</option>)}</select>}
      {!question && <div className="rw-chat-empty"><Bot size={24} /><p>描述你想找的论文</p><small>例如：查找近三年关于图神经网络的 CCF A 类论文。</small></div>}
      {question && <div className="rw-message user"><small>你</small><p>{question}</p></div>}
      {assist.task?.output?.explanation && <div className="rw-message assistant"><small>Codex</small><ReactMarkdown components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{assist.task.output.explanation}</ReactMarkdown></div>}
      {(assist.busy || busy) && <p role="status" className="rw-muted">{busy ? '正在查询文献数据库…' : 'Codex 正在检索…'}</p>}
      {assist.task?.notice && <p className="rw-warning" role="status">{assist.task.notice}</p>}
      {assist.task?.status === 'waiting_approval' && <button onClick={() => onSession(assist.task.session_id)}>查看 Codex 授权请求</button>}
      {(error || assist.error) && <p role="alert" className="rw-error">{error || assist.error}</p>}
      <LiteratureSearchResults key={assist.task?.session_id || 'new'} result={result} webPapers={assist.task?.output?.papers || []} project={project} sessionId={assist.task?.session_id} onAdded={onAdded} busy={busy || assist.busy} onPage={(offset) => run(params, offset)} />
    </div>
    <form className="rw-composer" onSubmit={send}><textarea autoFocus aria-label="聊天检索需求" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="描述论文需求，或继续补充筛选条件…" rows={3} /><div><button type="button" className="lit-network-toggle" aria-pressed={network} disabled={assist.busy || busy} onClick={() => setNetwork(!network)}><Globe size={14} />网络检索</button>{assist.busy ? <button type="button" disabled={!assist.task?.session_id} onClick={assist.stop}><Square size={14} />停止</button> : <button type="submit" className="rw-primary" disabled={!prompt.trim() || busy}><Send size={14} />发送</button>}</div></form>
  </aside>;
}
