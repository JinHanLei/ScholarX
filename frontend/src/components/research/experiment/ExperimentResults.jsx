import React, { useEffect, useRef, useState } from 'react';
import { FlaskConical, ArrowUpRight, Plus, RefreshCw, Square, ChevronDown } from 'lucide-react';
import { request } from '../shared.jsx';
import ResearchModal from '../ResearchModal.jsx';
import LegacyExperimentTools from './LegacyExperimentTools.jsx';
import RunInspector from './RunInspector.jsx';
import ResultMapping from './ResultMapping.jsx';
import { canonical, defaultVersion, label, metricId, number, resultGroups, STATUS } from './resultTable.js';
import './experiment.css';

const EMPTY = { runs: [], rows: [], versions: [] };
export default function ExperimentResults(props) {
  const { project, ideaVersion, onIdea } = props;
  const [data, setData] = useState(EMPTY), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState(ideaVersion || ''), [dataset, setDataset] = useState(''), [includeTest, setIncludeTest] = useState(false);
  const [selected, setSelected] = useState(''), [mapping, setMapping] = useState(null), [tools, setTools] = useState(false), [busy, setBusy] = useState(false);
  const inspector = useRef(null);
  const reload = async () => { const value = await request(`/projects/${project.id}/experiment-results`); setData(value); setError(''); setLoading(false); };
  useEffect(() => {
    let live = true, timer;
    const load = async () => { try { const value = await request(`/projects/${project.id}/experiment-results`); if (live) { setData(value); setError(''); setLoading(false); } } catch (e) { if (live) { setError(e.message); setLoading(false); } } if (live) timer = setTimeout(load, 2500); };
    void load(); return () => { live = false; clearTimeout(timer); };
  }, [project.id, props.epoch]);
  useEffect(() => { if (ideaVersion) setChoice(ideaVersion); }, [ideaVersion]);
  useEffect(() => { if (selected) inspector.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [selected]);
  const versionId = choice === 'legacy' || data.versions.some((v) => v.id === choice) ? choice : defaultVersion(data);
  const version = data.versions.find((v) => v.id === versionId);
  const versionLabel = version ? `V${version.number}` : '历史 / 未绑定版本';
  const datasets = [...new Map(data.rows.filter((r) => includeTest || !r.test_data).map((r) => [canonical(r.dataset), r.dataset]))];
  const groups = resultGroups(data.rows, versionId, dataset, includeTest);
  const visibleRuns = new Set(groups.flatMap((g) => g.rows.map((r) => r.run_id)));
  const runs = data.runs.filter((r) => (includeTest || !r.environment.test_data) && (!dataset || canonical(r.config.dataset) === dataset) && (visibleRuns.has(r.id) || r.version_ids.includes(versionId)));
  const selectedRun = data.runs.find((r) => r.id === selected);
  const versionAction = async (action) => { setBusy(true); try { await request(`/idea-versions/${version.id}/${action}`, { method: 'POST', body: {} }); await reload(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const runVersion = (row) => row.version_ids.map((id) => `V${data.versions.find((v) => v.id === id)?.number ?? '?'}`).join(' / ') || '历史';

  return <div className="experiment-workspace">
    <section className="experiment-results" aria-label="实验结果表">
      <header className="experiment-results-heading"><div><span className="experiment-kicker">EXPERIMENT RESULTS</span><h1>实验结果</h1><p>Baseline 与 Ours 的真实结果 · 点击数值查看运行记录</p></div><button onClick={() => setTools(true)}><Plus size={14} />手动登记</button></header>
      <div className="experiment-filters"><label className="experiment-version-select"><span>Ours 版本</span><select aria-label="Ours 版本" value={versionId} onChange={(e) => { setChoice(e.target.value); setSelected(''); }}>{data.versions.map((v) => <option key={v.id} value={v.id}>V{v.number} · {v.document.name} · {STATUS[v.stage] || v.stage}</option>)}<option value="legacy">历史 / 未绑定版本</option></select></label><label><span>数据集</span><select aria-label="结果数据集" value={dataset} onChange={(e) => setDataset(e.target.value)}><option value="">全部数据集</option>{datasets.map(([key, value]) => <option key={key} value={key}>{label(value)}</option>)}</select></label><label className="experiment-test-toggle"><input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />显示系统测试数据</label></div>
      {error && <p className="experiment-error" role="alert">{error}</p>}
      {groups.map((group, index) => <div className="experiment-result-group" key={group.key}>
        <header><div><span className="experiment-dataset-number">{String(index + 1).padStart(2, '0')}</span><h2 title={label(group.dataset)}>{label(group.dataset)}</h2>{group.test_data && <span className="experiment-status test">测试数据</span>}</div><span>{group.scope || '评估范围未标注'} · {group.rows.length} 项结果</span></header>
        <details className="experiment-evaluation"><summary><ChevronDown size={12} />划分与评估协议{group.protocol?.id ? ` · ${group.protocol.id}` : ''}</summary><dl><dt>数据划分</dt><dd>{label(group.split)}</dd><dt>评估协议</dt><dd>{label(group.protocol)}</dd></dl></details>
        <div className="experiment-table-scroll"><table className="experiment-comparison"><thead><tr><th>方法</th><th>版本 / Seed</th>{group.metrics.map((m) => <th key={metricId(m)}>{m.label}{m.unit && <small> {m.unit}</small>}<span className="experiment-metric-direction">{m.direction === 'higher' ? ' ↑' : m.direction === 'lower' ? ' ↓' : ''}</span></th>)}</tr></thead><tbody>
          {group.rows.map((row) => <tr className={row.role} key={row.id}><th><button onClick={() => setSelected(row.run_id)}>{row.method}<ArrowUpRight size={11} /></button><small>{row.role === 'baseline' ? 'BASELINE' : row.role === 'ours' ? 'OURS' : '待归类'}{row.status !== 'completed' && ` · ${STATUS[row.status] || row.status}`}</small></th><td className="experiment-seed"><span>{runVersion(row)}</span><small>Seed {label(row.seed)}</small></td>{group.metrics.map((metric) => { const value = row.metrics.find((m) => metricId(m) === metricId(metric)); return <td key={metricId(metric)}>{value?.value == null ? <span className="experiment-missing">—</span> : <button title={`${value.source} = ${value.value} · 查看原始运行`} onClick={() => setSelected(row.run_id)}>{number(value.value)}</button>}</td>; })}</tr>)}
          {!group.rows.some((r) => r.role === 'ours') && <tr className="ours missing-ours"><th>Ours <small>{versionLabel}</small></th><td colSpan={group.metrics.length + 1}>此版本在该评估设置下暂无结果</td></tr>}
        </tbody></table></div>
      </div>)}
      {!groups.length && <div className="experiment-empty"><FlaskConical size={30} /><h3>{loading ? '正在加载结果…' : `${versionLabel} 暂无实验结果`}</h3><p>完成实验后，真实指标会出现在这里。保存或切换表格设置不会启动实验。</p></div>}
      {groups.length > 0 && <p className="experiment-table-note">每行保留一次运行或同一运行中的一个方法；不同数据划分与评估协议分别展示，不混合统计。</p>}
    </section>
    {version && <section className="experiment-version-summary"><div><span className="experiment-version-badge">V{version.number}</span><div><strong>{STATUS[version.stage] || version.stage}</strong><p>{version.message}</p></div></div><div className="experiment-version-actions"><button onClick={onIdea}>查看 Idea<ArrowUpRight size={12} /></button>{['failed', 'blocked', 'interrupted', 'cancelled'].includes(version.stage) && <button disabled={busy} onClick={() => versionAction('retry')}><RefreshCw size={12} />重试该版本</button>}{['queued', 'snapshotting', 'implementing', 'validating', 'running', 'summarizing', 'waiting_approval'].includes(version.stage) && <button disabled={busy} onClick={() => versionAction('cancel')}><Square size={12} />停止</button>}</div></section>}
    <section className="experiment-runs" aria-label="实验运行与记录"><header><h2>运行与记录 <span>{runs.length}</span></h2><small>参数 · 结果 · 观察</small></header>{runs.map((run) => <button className={`experiment-run-row ${selected === run.id ? 'selected' : ''}`} key={run.id} onClick={() => setSelected(run.id)}><div className="experiment-run-title"><strong>{run.name}</strong><small>{runVersion(run)} · Seed {label(run.config.seed)} · {new Date(run.created_at).toLocaleString()}</small></div><div className="experiment-run-parameters">{Object.entries(run.config.hyperparameters || {}).slice(0, 3).map(([key, value]) => <span key={key}>{key} <b>{label(value)}</b></span>)}</div><span className={`experiment-status ${run.status}`}>{STATUS[run.status] || run.status}</span><ArrowUpRight size={14} /></button>)}{!runs.length && <p className="experiment-muted">当前筛选下尚无运行记录。</p>}
      {selectedRun && <div ref={inspector} className="experiment-inspector-anchor"><button className="experiment-collapse" onClick={() => setSelected('')}>收起详情</button><RunInspector key={selectedRun.id} projectId={project.id} run={selectedRun} versions={data.versions} onMapping={() => setMapping(selectedRun)} onReload={reload} /></div>}
    </section>
    {mapping && <ResultMapping projectId={project.id} run={mapping} onClose={() => setMapping(null)} onSaved={reload} />}
    {tools && <ResearchModal title="实验登记与高级设置" onClose={() => { setTools(false); void reload(); }} wide className="experiment-tools-dialog"><LegacyExperimentTools {...props} /></ResearchModal>}
  </div>;
}
