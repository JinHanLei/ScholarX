import React, { useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { request } from '../shared.jsx';
import { number, STATUS } from './resultTable.js';
import './monitor.css';

const resourceLabel = (key) => ({
  'system/process_cpu_percent': '主进程 CPU (%)',
  'system/process_memory_mb': '进程树内存 (MB)',
  'system/host_memory_percent': '主机内存 (%)',
}[key] || key.replace(/^system\/gpu_(\d+)_utilization_percent$/, 'GPU $1 整卡利用率 (%)').replace(/^system\/gpu_(\d+)_memory_mb$/, 'GPU $1 整卡显存 (MB)'));
const shortTime = (value) => value ? new Date(value).toLocaleTimeString() : '尚未同步';

function MetricChart({ series, startedAt }) {
  const resource = series.key.startsWith('system/');
  const origin = startedAt ? new Date(startedAt).valueOf() : series.points[0]?.timestamp;
  const points = series.points.map((p) => ({ ...p, x: resource ? (p.timestamp - origin) / 1000 : p.step }));
  return <div className="experiment-metric-chart" aria-label={`指标曲线 ${series.key}`}>
    <header><strong>{resourceLabel(series.key)}</strong><span>{series.total} 个采样点{series.total > points.length && ` · 显示 ${points.length} 点`}</span></header>
    <ResponsiveContainer width="100%" height={210} minWidth={0}>
      <LineChart data={points} margin={{ top: 14, right: 20, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5edf7" />
        <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={number} tick={{ fontSize: 10 }} minTickGap={35} />
        <YAxis domain={['auto', 'auto']} tickFormatter={number} tick={{ fontSize: 10 }} width={64} />
        <Tooltip formatter={(value) => [number(value), resourceLabel(series.key)]} labelFormatter={(x) => resource ? `运行 ${number(x)} 秒` : `Step ${x}`} contentStyle={{ border: '1px solid #dce7f5', borderRadius: 7, fontSize: 11 }} />
        <Line dataKey="value" type="linear" stroke="#5284c4" strokeWidth={2} dot={points.length === 1} activeDot={{ r: 4 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
    <small>{resource ? '横轴：运行时间（秒）' : '横轴：训练脚本上报的 step / epoch'} · 悬停查看原始数值</small>
  </div>;
}

export default function RunMonitor({ projectId, run }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('training'), [metric, setMetric] = useState('');
  const url = `/projects/${projectId}/experiments/${run.id}/tracking`;
  useEffect(() => {
    let live = true, timer;
    const load = async () => {
      try {
        const result = await request(url + (metric ? `?metric=${encodeURIComponent(metric)}` : ''));
        if (live) { setData(result); setError(''); }
      } catch (e) { if (live) setError(e.message); }
      if (live) timer = setTimeout(load, 2500);
    };
    void load(); return () => { live = false; clearTimeout(timer); };
  }, [url, metric]);
  const choices = (data?.metrics || []).filter((m) => tab === 'resources' ? m.key.startsWith('system/') : !m.key.startsWith('system/') && !m.key.startsWith('final/'));
  const selected = choices.some((m) => m.key === metric) ? metric : choices[0]?.key || '';
  useEffect(() => { if (selected !== metric) setMetric(selected); }, [selected, metric]);
  const current = data?.series.find((s) => s.key === selected);
  const tracked = Boolean(data?.tracking?.mlflow_run_id);
  const active = ['queued', 'running'].includes(run.status);
  const sync = async () => {
    setBusy(true); setError('');
    try { setData(await request(url + '/sync', { method: 'POST', body: {} })); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <section className="experiment-monitor" aria-label="MLflow 实验监控">
    <header><div><Activity size={16} /><strong>实验监控</strong><span className="experiment-monitor-engine">MLflow · 本地</span></div>{!active && data?.available && <button disabled={busy} onClick={sync}><RefreshCw size={12} />{busy ? '同步中…' : tracked ? '重新同步记录' : '同步已有结果'}</button>}</header>
    <div className={`experiment-monitor-status ${active ? 'active' : ''}`}><span><i />{STATUS[run.status] || run.status}{active && ' · 自动采集'}</span><span>最近同步 {shortTime(data?.tracking?.last_synced_at)}</span></div>
    {(error || data?.read_error || data?.tracking?.error) && <p className="experiment-error" role="alert">监控同步异常：{error || data.read_error || data.tracking.error}。运行记录与已生成的实验结果仍保留。</p>}
    {data?.archived && <p className="experiment-monitor-empty">此记录来自另一个本地监控库。点击“重新同步记录”可从保存的监控日志恢复；不会重新运行实验。</p>}
    {!tracked && !data?.archived && <p className="experiment-monitor-empty">{!data ? '正在读取监控…' : active ? '等待首批采样。训练脚本上报指标后会显示曲线。' : '此运行尚无 MLflow 记录，可同步已有参数与结果。历史未采集的曲线不会补造。'}</p>}
    {tracked && !data?.archived && <>
      <div className="experiment-monitor-controls"><div role="tablist" aria-label="监控内容"><button role="tab" aria-selected={tab === 'training'} onClick={() => { setTab('training'); setMetric(''); }}>训练曲线</button><button role="tab" aria-selected={tab === 'resources'} onClick={() => { setTab('resources'); setMetric(''); }}>资源监控</button></div>{choices.length > 0 && <select aria-label="监控指标" value={selected} onChange={(e) => setMetric(e.target.value)}>{choices.map((m) => <option key={m.key} value={m.key}>{resourceLabel(m.key)}</option>)}</select>}</div>
      {choices.length > 0 && <div className="experiment-monitor-value"><strong>{number(choices.find((m) => m.key === selected)?.value)}</strong><span>最近一次上报{current?.points.length > 0 && ` · Step ${current.points.at(-1).step}`}</span></div>}
      {current?.points.length > 0 ? <MetricChart series={current} startedAt={data.started_at} /> : <p className="experiment-monitor-empty">{tab === 'training' ? '尚无训练曲线。此处只显示脚本实际采集的中间指标；最终测试指标在结果表中。' : '尚无资源采样。没有采集到的 CPU / GPU 数值保持为空。'}</p>}
      {tab === 'resources' && <p className="experiment-monitor-hint">进程内存包含子进程；GPU 为整卡指标，可能包含其他任务的占用。</p>}
      {data.tracking.warnings?.map((warning) => <p key={warning} className="experiment-monitor-hint">{warning}</p>)}
      <details className="experiment-monitor-identity"><summary>追踪关联</summary><dl><dt>EasyRef Run</dt><dd>{run.id}</dd><dt>MLflow Run</dt><dd>{data.tracking.mlflow_run_id}</dd><dt>来源</dt><dd>{data.tracking.origin === 'historical' ? '历史参数与结果同步' : '实际执行采集'}</dd></dl></details>
    </>}
  </section>;
}

export function TrackingBadge() {
  const [status, setStatus] = useState(null);
  useEffect(() => { let live = true; request('/experiment-tracking/status').then((value) => { if (live) setStatus(value); }).catch(() => {}); return () => { live = false; }; }, []);
  return <span className="experiment-monitor-engine" title={status?.message || '正在检查实验监控'}><Activity size={12} />MLflow · {status ? status.available ? '本地可用' : '未配置' : '连接中'}</span>;
}
