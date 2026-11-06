import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  FileText,
  FileUp,
  HelpCircle,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { api } from '../utils/api.js';
import { displayPaperAbstract, displayPaperTitle, displayVenue, formatAuthors } from '../utils/papers.js';
import {
  hasScopeFilter,
  normalizeRanks,
  normalizeVenues,
  parseRankToken,
  rankParam,
  splitScopeDraft,
  venueParam,
} from '../utils/tableFilters.js';

function LibraryCreateProgress({ text, onBackground, task = null }) {
  const isPdfTask = Boolean(task);
  const items = task?.items || [];
  const done = task?.done || 0;
  const total = task?.total || items.length || 0;
  return (
    <div className="modal-backdrop light">
      <section className={`modal compact progress-modal ${isPdfTask ? 'pdf-task-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="library-progress-title">
        {!isPdfTask && (
          <div className="search-loader" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
        <div>
          <h2 id="library-progress-title">{isPdfTask ? (text.modal.uploadPdfZip || text.modal.pdfFiles) : text.workbench.creatingTitle}</h2>
          <p>{isPdfTask ? `${done}/${total} ${text.modal.pdfFiles}` : text.workbench.creatingDesc}</p>
        </div>
        {isPdfTask ? (
          <div className="pdf-task-list">
            {items.map((item) => (
              <article className={`pdf-task-item ${item.status || 'queued'} ${item.stage || ''}`} key={`${item.index}-${item.filename}`}>
                <div>
                  <strong>{item.title || item.filename}</strong>
                  <span>{item.detail || item.stage || 'queued'}</span>
                  {item.parse_error && <small>{item.parse_error}</small>}
                </div>
                <em>{item.status === 'done' ? '完成' : item.status === 'error' ? '失败' : '处理中'}</em>
              </article>
            ))}
          </div>
        ) : (
          <div className="progress-scan">
            <span />
          </div>
        )}
        <button className="secondary-button" onClick={onBackground}>
          <RotateCcw size={17} /> {text.common.background}
        </button>
      </section>
    </div>
  );
}

function KeywordHelp({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="keyword-help-wrap">
      <button
        type="button"
        className="keyword-help-button"
        aria-label={text.modal.keywordHelp}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <HelpCircle size={15} />
      </button>
      {open && (
        <div className="keyword-help-popover" role="tooltip">
          <strong>{text.modal.keywordHelp}</strong>
          {text.modal.keywordHelpItems.map((item) => <span key={item}>{item}</span>)}
        </div>
      )}
    </span>
  );
}

function ScopeTokenInput({ value, onChange, text, onEnter, autoFocus = false }) {
  const ranks = normalizeRanks(value.ranks, value.rank);
  const venues = normalizeVenues(value.venues, value.venue);
  const inputRef = useRef(null);
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const rankSuggestions = ['A', 'B', 'C']
    .filter((rank) => !ranks.includes(rank))
    .filter((rank) => {
      const term = draft.trim().toLowerCase();
      const normalizedRank = parseRankToken(term);
      return !term || normalizedRank === rank || rank.toLowerCase().startsWith(term) || `ccf ${rank.toLowerCase()}`.includes(term) || `ccf-${rank.toLowerCase()}`.includes(term);
    })
    .map((rank) => ({ id: `rank-${rank}`, type: 'rank', rank }));

  useEffect(() => {
    const term = draft.trim();
    if (term.length < 1) {
      setSuggestions([]);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      try {
        const data = await api(`/venues/suggest?q=${encodeURIComponent(term)}`);
        const existing = new Set(venues.map((item) => item.toLowerCase()));
        setSuggestions((data.venues || []).filter((item) => {
          const key = item.venue_abbr || item.venue_name || item.dblp_key || item.dblp_detail_key || '';
          return key && !existing.has(key.toLowerCase());
        }));
        setOpen(true);
      } catch {
        setSuggestions([]);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draft, venues.join('|')]);

  function emit(nextRanks, nextVenues) {
    onChange({
      rank: nextRanks.join(','),
      ranks: nextRanks,
      venue: nextVenues.join(','),
      venues: nextVenues,
    });
  }

  function choose(item) {
    if (item.type === 'rank') {
      emit([...ranks, item.rank], venues);
    } else {
      emit(ranks, [...venues, item.venue_abbr || item.venue_name || item.dblp_key || item.dblp_detail_key || ''].filter(Boolean));
    }
    setDraft('');
    setOpen(false);
  }

  function commitDraft() {
    const items = splitScopeDraft(draft);
    if (!items.length) return false;
    const nextRanks = [...ranks];
    const nextVenues = [...venues];
    items.forEach((item) => {
      const parsedRank = parseRankToken(item);
      if (parsedRank) {
        if (!nextRanks.includes(parsedRank)) nextRanks.push(parsedRank);
      } else if (!nextVenues.some((venue) => venue.toLowerCase() === item.toLowerCase())) {
        nextVenues.push(item);
      }
    });
    emit(nextRanks, nextVenues);
    setDraft('');
    setOpen(false);
    return true;
  }

  function pick(event, item) {
    event.preventDefault();
    event.stopPropagation();
    choose(item);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function focusInput(event) {
    if (event.target.closest?.('button')) return;
    if (event.target !== inputRef.current) {
      event.preventDefault();
    }
    inputRef.current?.focus();
    setOpen(true);
  }

  function stopChipButtonMouseDown(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function removeRank(event, rank) {
    event.preventDefault();
    event.stopPropagation();
    emit(ranks.filter((item) => item !== rank), venues);
    setDraft('');
    setOpen(false);
  }

  function removeVenue(event, venue) {
    event.preventDefault();
    event.stopPropagation();
    emit(ranks, venues.filter((item) => item !== venue));
    setDraft('');
    setOpen(false);
  }

  return (
    <div className="scope-combobox">
      <div className="scope-token-field" onMouseDown={focusInput}>
        {ranks.map((rank) => (
          <span className={`scope-chip rank-${rank}`} key={`rank-${rank}`}>
            CCF {rank}
            <button type="button" aria-label={`Remove CCF ${rank}`} onMouseDown={stopChipButtonMouseDown} onClick={(event) => removeRank(event, rank)}><X size={13} /></button>
          </span>
        ))}
        {venues.map((venue) => (
          <span className="scope-chip venue-chip" key={`venue-${venue}`}>
            {venue}
            <button type="button" aria-label={`Remove ${venue}`} onMouseDown={stopChipButtonMouseDown} onClick={(event) => removeVenue(event, venue)}><X size={13} /></button>
          </span>
        ))}
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          placeholder={ranks.length || venues.length ? '' : text.modal.scopeHint}
          value={draft}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => {
            commitDraft();
            setOpen(false);
          }, 120)}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !draft && (venues.length || ranks.length)) {
              venues.length ? emit(ranks, venues.slice(0, -1)) : emit(ranks.slice(0, -1), venues);
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const first = [...rankSuggestions, ...suggestions][0];
              const draftRank = parseRankToken(draft);
              if (draftRank && !ranks.includes(draftRank)) {
                choose({ id: `rank-${draftRank}`, type: 'rank', rank: draftRank });
              } else if (first) {
                choose(first);
              } else {
                commitDraft() || onEnter?.();
              }
            }
          }}
          autoComplete="off"
        />
      </div>
      {open && !![...rankSuggestions, ...suggestions].length && (
        <div className="scope-suggestions" role="listbox">
          {rankSuggestions.map((item) => (
            <button key={item.id} type="button" onMouseDown={(event) => pick(event, item)}>
              <strong>CCF {item.rank}</strong>
              <span>{text.modal.scopeRankHint}</span>
            </button>
          ))}
          {suggestions.map((item) => (
            <button key={`venue-${item.id}`} type="button" onMouseDown={(event) => pick(event, item)}>
              <strong>{item.venue_abbr || item.venue_name}</strong>
              <span>{[item.venue_name && item.venue_abbr ? item.venue_name : '', item.rank ? `CCF ${item.rank}` : '', item.dblp_key].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function YearRangeSlider({ value, onChange, minYear = 1950, maxYear = new Date().getFullYear(), text }) {
  const from = Number(value.year_from || 2023);
  const to = Number(value.year_to || maxYear);
  const safeFrom = Math.min(Math.max(from, minYear), to);
  const safeTo = Math.max(Math.min(to, maxYear), safeFrom);
  const recentStart = Math.max(minYear, maxYear - 9);
  const recentWeight = 0.7;
  const oldWeight = 1 - recentWeight;

  function yearToPosition(year) {
    if (year <= recentStart) {
      const oldRange = Math.max(1, recentStart - minYear);
      return Math.round(((year - minYear) / oldRange) * oldWeight * 100);
    }
    const recentRange = Math.max(1, maxYear - recentStart);
    return Math.round((oldWeight + ((year - recentStart) / recentRange) * recentWeight) * 100);
  }

  function positionToYear(position) {
    const ratio = Number(position) / 100;
    if (ratio <= oldWeight) {
      const oldRange = Math.max(1, recentStart - minYear);
      return Math.round(minYear + (ratio / oldWeight) * oldRange);
    }
    const recentRange = Math.max(1, maxYear - recentStart);
    return Math.round(recentStart + ((ratio - oldWeight) / recentWeight) * recentRange);
  }

  const fromPosition = yearToPosition(safeFrom);
  const toPosition = yearToPosition(safeTo);
  const left = fromPosition;
  const right = 100 - toPosition;

  function setFrom(nextValue) {
    const nextFrom = Math.min(positionToYear(nextValue), safeTo);
    onChange({ year_from: String(nextFrom), year_to: String(safeTo) });
  }

  function setTo(nextValue) {
    const nextTo = Math.max(positionToYear(nextValue), safeFrom);
    onChange({ year_from: String(safeFrom), year_to: String(nextTo) });
  }

  return (
    <div className="year-range-control">
      <div className="year-range-head">
        <span>{text.modal.yearFrom}</span>
        <strong>{safeFrom} - {safeTo}</strong>
        <span>{text.modal.yearTo}</span>
      </div>
      <div className="dual-range" style={{ '--range-left': `${left}%`, '--range-right': `${right}%` }}>
        <div className="dual-range-track" />
        <input className="range-from" aria-label={text.modal.yearFrom} type="range" min="0" max="100" value={fromPosition} onChange={(event) => setFrom(event.target.value)} />
        <input className="range-to" aria-label={text.modal.yearTo} type="range" min="0" max="100" value={toPosition} onChange={(event) => setTo(event.target.value)} />
      </div>
    </div>
  );
}

function EmailTokenInput({ value = [], onChange, text }) {
  const emails = Array.isArray(value) ? value : [];
  const inputRef = useRef(null);
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const term = draft.trim();
    if (term.length < 1) {
      setSuggestions([]);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      try {
        const data = await api(`/users/suggest?q=${encodeURIComponent(term)}`);
        const existing = new Set(emails.map((item) => item.toLowerCase()));
        setSuggestions((data.users || []).filter((item) => item.email && !existing.has(item.email.toLowerCase())));
        setOpen(true);
      } catch {
        setSuggestions([]);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draft, emails.join('|')]);

  function emit(nextEmails) {
    onChange([...new Set(nextEmails.map((item) => item.trim()).filter(Boolean))]);
  }

  function choose(email) {
    if (!email) return;
    emit([...emails, email]);
    setDraft('');
    setOpen(false);
  }

  function commitDraft() {
    const items = splitScopeDraft(draft).flatMap((item) => item.split(/\s+/)).filter(Boolean);
    if (!items.length) return false;
    emit([...emails, ...items]);
    setDraft('');
    setOpen(false);
    return true;
  }

  function focusEmailInput(event) {
    if (event.target.closest?.('button')) return;
    if (event.target !== inputRef.current) {
      event.preventDefault();
    }
    inputRef.current?.focus();
    setOpen(true);
  }

  function stopEmailChipMouseDown(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function removeEmail(event, email) {
    event.preventDefault();
    event.stopPropagation();
    emit(emails.filter((item) => item !== email));
    setDraft('');
    setOpen(false);
  }

  return (
    <div className="scope-combobox email-combobox">
      <div className="scope-token-field" onMouseDown={focusEmailInput}>
        {emails.map((email) => (
          <span className="scope-chip email-chip" key={email}>
            {email}
            <button type="button" aria-label={`Remove ${email}`} onMouseDown={stopEmailChipMouseDown} onClick={(event) => removeEmail(event, email)}><X size={13} /></button>
          </span>
        ))}
        <input
          ref={inputRef}
          placeholder={emails.length ? '' : text.modal.sharePlaceholder}
          value={draft}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => {
            commitDraft();
            setOpen(false);
          }, 120)}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !draft && emails.length) emit(emails.slice(0, -1));
            if (event.key === 'Enter') {
              event.preventDefault();
              suggestions[0]?.email ? choose(suggestions[0].email) : commitDraft();
            }
          }}
          autoComplete="off"
        />
      </div>
      {open && !!suggestions.length && (
        <div className="scope-suggestions" role="listbox">
          {suggestions.map((item) => (
            <button key={item.id || item.email} type="button" onMouseDown={(event) => {
              event.preventDefault();
              choose(item.email);
            }}>
              <strong>{item.email}</strong>
              <span>{item.confirmed ? 'confirmed' : 'pending'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ShareLibraryModal({ library, onSave, onCancel, busy, text }) {
  const [sharedWith, setSharedWith] = useState(library?.filters_json?.shared_with || []);
  return (
    <div className="modal-backdrop">
      <section className="modal compact" role="dialog" aria-modal="true" aria-labelledby="share-library-title">
        <header>
          <div>
            <h2 id="share-library-title">{text.modal.shareTitle}</h2>
            <p>{text.modal.shareDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        <div className="field-block">
          <span>{library.name}</span>
          <EmailTokenInput value={sharedWith} onChange={setSharedWith} text={text} />
          {!sharedWith.length && <small className="field-hint">{text.modal.shareEmpty}</small>}
        </div>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
          <button className="primary-button" disabled={busy} onClick={() => onSave(sharedWith)}>
            <Users size={17} /> {text.common.save}
          </button>
        </div>
      </section>
    </div>
  );
}

function fullAuthorsText(authors) {
  if (!authors) return '';
  if (Array.isArray(authors)) return authors.join('; ');
  if (typeof authors === 'string') return authors;
  return '';
}

function LibraryModal({ filters, onCreate, onSync, onCancel, busy, text, locale, library, llmSettings }) {
  const currentYear = new Date().getFullYear();
  const defaultYears = { year_from: '2023', year_to: String(currentYear) };
  const recentYears = { year_from: String(Math.max(1950, currentYear - 2)), year_to: String(currentYear) };
  const [form, setForm] = useState({
    name: library?.name || (filters.keyword ? `${filters.keyword} papers` : ''),
    description: library?.description || '',
    mode: 'static',
    ...defaultYears,
    ...filters,
  });
  const [source, setSource] = useState('keyword');
  const [naturalText, setNaturalText] = useState('');
  const [naturalStep, setNaturalStep] = useState('ask');
  const [parsingIntent, setParsingIntent] = useState(false);
  const [previewingIntent, setPreviewingIntent] = useState(false);
  const [naturalPreview, setNaturalPreview] = useState(null);
  const [files, setFiles] = useState([]);
  const namePlaceholder = locale === 'zh' ? text.modal.libraryName : text.modal.libraryName;
  const isPdfSource = !library && source === 'pdf';
  const isNaturalSource = !library && source === 'natural';
  const isEditing = Boolean(library);
  const hasSearchCriteria = Boolean(form.keyword?.trim() || hasScopeFilter(form));
  const canSubmit = isEditing
    ? Boolean(form.name.trim())
    : isPdfSource
    ? Boolean(files.length)
    : isNaturalSource
      ? hasSearchCriteria && naturalStep === 'ready'
      : hasSearchCriteria;
  const naturalSteps = ['ask', 'keyword', 'scope', 'years', 'strategy', 'ready'];
  const naturalStepNumber = Math.max(0, naturalSteps.indexOf(naturalStep)) + 1;

  function buildPayload() {
    return {
      ...form,
      mode: 'static',
      source,
      files,
      rank: rankParam(form),
      ranks: normalizeRanks(form.ranks, form.rank),
      venue: venueParam(form),
      venues: normalizeVenues(form.venues, form.venue),
      name: form.name.trim() || (isPdfSource ? 'PDF papers' : `${(form.keyword || venueParam(form)).trim()} papers`),
      folders: filters.folders || [],
      natural_query: naturalText.trim(),
      smart_search: isNaturalSource,
    };
  }

  function buildEditPayload() {
    return {
      name: form.name.trim() || library.name,
      description: form.description || '',
      folders: filters.folders || library?.filters_json?.folders || [],
      filters: {
        ...(library?.filters_json || {}),
        folders: filters.folders || library?.filters_json?.folders || [],
      },
    };
  }

  async function parseNaturalIntent() {
    const query = naturalText.trim();
    if (!query) return;
    setParsingIntent(true);
    try {
      let parsed = null;
      try {
        parsed = await api('/libraries/intent/parse', { method: 'POST', body: { text: query, llm: llmSettings } });
      } catch {
        parsed = null;
      }
      const keyword = parsed?.keyword || query.replace(/[，。,.!?！？]/g, ' ').trim();
      const parsedVenues = normalizeVenues(parsed?.venues, parsed?.venue);
      const parsedRanks = normalizeRanks(parsed?.ranks, parsed?.rank);
      const parsedYears = {
        year_from: parsed?.year_from || recentYears.year_from,
        year_to: parsed?.year_to || recentYears.year_to,
      };
      const scopeLabel = parsedVenues[0] || (parsedRanks.length ? `CCF ${parsedRanks.join(',')}` : '');
      const generatedName = parsed?.library_name
        || [keyword, scopeLabel].filter(Boolean).join(' · ')
        || (locale === 'zh' ? '智能论文库' : 'Smart paper library');
      setForm({
        ...form,
        keyword,
        broad_keyword: parsed?.broad_keyword || keyword,
        relevance_criteria: parsed?.relevance_criteria || query,
        ranks: parsedRanks,
        rank: parsedRanks.join(','),
        venues: parsedVenues,
        venue: parsedVenues.join(','),
        ...parsedYears,
        name: generatedName,
      });
      setNaturalStep('keyword');
    } finally {
      setParsingIntent(false);
    }
  }

  async function previewNaturalIntent() {
    setPreviewingIntent(true);
    try {
      const preview = await api('/libraries/intent/preview', {
        method: 'POST',
        body: {
          ...form,
          rank: rankParam(form),
          ranks: normalizeRanks(form.ranks, form.rank),
          venue: venueParam(form),
          venues: normalizeVenues(form.venues, form.venue),
          broad_keyword: form.broad_keyword,
        },
      });
      setNaturalPreview(preview);
      setNaturalStep('strategy');
    } finally {
      setPreviewingIntent(false);
    }
  }

  function switchSource(nextSource) {
    setSource(nextSource);
    if (nextSource === 'natural') {
      setNaturalStep('ask');
      setNaturalPreview(null);
      setForm((current) => ({ ...current, name: '', keyword: '', rank: '', ranks: [], venue: '', venues: [] }));
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal library-modal" role="dialog" aria-modal="true" aria-labelledby="library-modal-title">
        <header>
          <div>
            <h2 id="library-modal-title">{library ? text.modal.updateLibrary : text.modal.libraryTitle}</h2>
            <p>{library ? (locale === 'zh' ? '修改名称不会重新检索；需要刷新论文时手动点击更新检索。' : 'Renaming does not re-run search. Use refresh search when needed.') : text.modal.libraryDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        {library ? (
          <>
            <label>
              <span>{text.modal.libraryName}</span>
              <input autoFocus placeholder={namePlaceholder} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              <span>{locale === 'zh' ? '描述' : 'Description'}</span>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <div className="flow-card library-edit-summary">
              <span>{locale === 'zh' ? '当前检索条件' : 'Current search scope'}</span>
              <strong>{[form.keyword, venueParam(form), rankParam(form), [form.year_from, form.year_to].filter(Boolean).join('-')].filter(Boolean).join(' · ') || (locale === 'zh' ? '未设置检索条件' : 'No search scope')}</strong>
              <small>{locale === 'zh' ? '保存信息只更新库名、描述和文件夹配置，不会重新拉取论文。' : 'Save info only updates metadata and folders; it will not fetch papers.'}</small>
            </div>
            <div className="modal-actions split-actions">
              <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
              <button
                className="secondary-button"
                disabled={busy || !onSync}
                onClick={async () => {
                  await onSync?.(library);
                  onCancel();
                }}
              >
                <RotateCcw size={17} /> {text.modal.updateSearch || text.workbench.sync}
              </button>
              <button
                className="primary-button"
                disabled={busy || !canSubmit}
                onClick={() => onCreate(buildEditPayload())}
              >
                <Check size={17} /> {text.modal.updateMetadata || text.common.save}
              </button>
            </div>
          </>
        ) : (
          <>
        {!library && (
          <div className="segmented source-tabs three-way" aria-label="library source">
            <button type="button" className={source === 'keyword' ? 'active' : ''} onClick={() => switchSource('keyword')}>
              <Search size={15} /> {text.modal.sourceKeyword}
            </button>
            <button type="button" className={source === 'pdf' ? 'active' : ''} onClick={() => switchSource('pdf')}>
              <FileText size={15} /> {text.modal.sourcePdf}
            </button>
            <button type="button" className={source === 'natural' ? 'active' : ''} onClick={() => switchSource('natural')}>
              <Sparkles size={15} /> {text.modal.sourceNatural}
            </button>
          </div>
        )}
        {!isNaturalSource && (
          <label>
            <span>{text.modal.libraryName}</span>
            <input placeholder={namePlaceholder} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
        )}
        {isPdfSource ? (
          <label className="pdf-file-input-field">
            <span>{text.modal.pdfFiles}</span>
            <input
              type="file"
              multiple
              accept=".pdf,.zip,application/pdf,application/zip"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
            <small className="field-hint">{text.modal.pdfHint}</small>
          </label>
        ) : (
          <>
            {isNaturalSource ? (
              <div className="natural-library-flow">
                <div className="natural-step-progress">
                  <span>{locale === 'zh' ? `第 ${naturalStepNumber} / ${naturalSteps.length} 步` : `Step ${naturalStepNumber} of ${naturalSteps.length}`}</span>
                  <div><i style={{ width: `${(naturalStepNumber / naturalSteps.length) * 100}%` }} /></div>
                </div>
                {naturalStep === 'ask' && (
                  <div className="flow-card">
                    <label>
                      <span>{text.modal.naturalPrompt}</span>
                      <textarea autoFocus placeholder={text.modal.naturalHint} value={naturalText} onChange={(event) => setNaturalText(event.target.value)} />
                    </label>
                    <div className="natural-step-actions single">
                      <button className="primary-button" disabled={busy || parsingIntent || !naturalText.trim()} onClick={parseNaturalIntent}>
                        <Sparkles size={16} /> {parsingIntent ? text.modal.naturalParsing : text.modal.continue}
                      </button>
                    </div>
                  </div>
                )}
                {naturalStep === 'keyword' && (
                  <div className="flow-card">
                    <p>{locale === 'zh' ? '确认用于标题召回的高召回关键词。复杂研究意图会在后续根据 abstract 判断。' : 'Confirm the high-recall title query. Detailed intent will be checked against abstracts later.'}</p>
                    <label>
                      <span className="label-with-help">{text.modal.parsedKeyword}<KeywordHelp text={text} /></span>
                      <input
                        autoFocus
                        value={form.keyword}
                        onChange={(event) => {
                          setForm((current) => ({ ...current, keyword: event.target.value }));
                          setNaturalPreview(null);
                        }}
                      />
                    </label>
                    <div className="natural-step-actions">
                      <button className="secondary-button" onClick={() => setNaturalStep('ask')}>{locale === 'zh' ? '上一步' : 'Back'}</button>
                      <button className="primary-button" disabled={!form.keyword?.trim()} onClick={() => setNaturalStep('scope')}>{text.modal.continue}</button>
                    </div>
                  </div>
                )}
                {naturalStep === 'scope' && (
                  <div className="flow-card">
                    <p>{text.modal.naturalScopeQuestion}</p>
                    <ScopeTokenInput value={form} onChange={(scope) => setForm((current) => ({ ...current, ...scope }))} text={text} />
                    <div className="natural-step-actions">
                      <button className="secondary-button" onClick={() => setNaturalStep('keyword')}>{locale === 'zh' ? '上一步' : 'Back'}</button>
                      <button className="primary-button" onClick={() => setNaturalStep('years')}>{text.modal.continue}</button>
                    </div>
                  </div>
                )}
                {naturalStep === 'years' && (
                  <div className="flow-card">
                    <p>{text.modal.naturalYearQuestion}</p>
                    <YearRangeSlider value={form} onChange={(years) => setForm({ ...form, ...years })} text={text} />
                    <div className="natural-step-actions">
                      <button className="secondary-button" onClick={() => setNaturalStep('scope')}>{locale === 'zh' ? '上一步' : 'Back'}</button>
                      <button className="primary-button" disabled={previewingIntent} onClick={previewNaturalIntent}>
                        {previewingIntent ? text.modal.naturalParsing : text.modal.continue}
                      </button>
                    </div>
                  </div>
                )}
                {naturalStep === 'strategy' && (
                  <div className="flow-card success">
                    {naturalPreview?.use_broad_search ? (
                      <>
                        <p>{locale === 'zh'
                          ? `初始关键词找到 ${naturalPreview.strict_count} 篇，数量较少。下一步将用下面的扩展条件召回约 ${naturalPreview.broad_count} 篇候选。`
                          : `The initial query found ${naturalPreview.strict_count}. The expanded query below will retrieve about ${naturalPreview.broad_count} candidates.`}</p>
                        <label>
                          <span className="label-with-help">{locale === 'zh' ? '扩展检索式' : 'Expanded query'}<KeywordHelp text={text} /></span>
                          <input value={form.broad_keyword || ''} onChange={(event) => setForm((current) => ({ ...current, broad_keyword: event.target.value }))} />
                        </label>
                      </>
                    ) : (
                      <p>{locale === 'zh'
                        ? `初始关键词可召回 ${naturalPreview?.strict_count || 0} 篇候选，无需扩展。下一步会逐篇分析 abstract，只保留符合原始需求的论文。`
                        : `The initial query retrieves ${naturalPreview?.strict_count || 0} candidates. No expansion is needed; every abstract will still be screened.`}</p>
                    )}
                    <div className="natural-step-actions">
                      <button className="secondary-button" onClick={() => setNaturalStep('years')}>{locale === 'zh' ? '上一步' : 'Back'}</button>
                      <button className="primary-button" onClick={() => setNaturalStep('ready')}>{text.modal.continue}</button>
                    </div>
                  </div>
                )}
                {naturalStep === 'ready' && (
                  <div className="flow-card success">
                    <p>{locale === 'zh'
                      ? '条件已确认。创建后将并行分析候选论文的 title 和 abstract，相关论文才会加入库。'
                      : 'Ready. Candidate titles and abstracts will be screened in parallel, and only relevant papers will be added.'}</p>
                    <label>
                      <span>{text.modal.libraryName}</span>
                      <input autoFocus placeholder={namePlaceholder} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </label>
                    <div className="natural-step-actions">
                      <button className="secondary-button" onClick={() => setNaturalStep('strategy')}>{locale === 'zh' ? '上一步' : 'Back'}</button>
                      <button className="primary-button" disabled={busy || !canSubmit} onClick={() => onCreate(buildPayload())}>
                        <Search size={17} /> {text.modal.createSearch}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <label>
                  <span className="label-with-help">{text.modal.keyword}<KeywordHelp text={text} /></span>
                  <input placeholder={text.modal.keywordHint} value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} />
                </label>
                <div className="field-block">
                  <span>{text.modal.scope}</span>
                  <ScopeTokenInput value={form} onChange={(scope) => setForm((current) => ({ ...current, ...scope }))} text={text} />
                </div>
                <YearRangeSlider value={form} onChange={(years) => setForm({ ...form, ...years })} text={text} />
              </>
            )}
          </>
        )}
        {!isNaturalSource && <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
          <button
            className="primary-button"
            disabled={busy || !canSubmit}
            onClick={() => onCreate(buildPayload())}
          >
            {isPdfSource ? <Upload size={17} /> : <Search size={17} />}
            {library ? text.modal.updateLibrary : isPdfSource ? text.modal.createFromPdf : text.modal.createSearch}
          </button>
        </div>}
          </>
        )}
      </section>
    </div>
  );
}

function AddPaperModal({ activeLibrary, onAddPapers, onUploadPdfs, onCancel, busy, text }) {
  const currentYear = new Date().getFullYear();
  const [tab, setTab] = useState('search');
  const [searchForm, setSearchForm] = useState({ keyword: '', venue: '', venues: [], year_from: '2023', year_to: String(currentYear), rank: '', ranks: [] });
  const [results, setResults] = useState([]);
  const [chosen, setChosen] = useState(new Set());
  const [files, setFiles] = useState([]);
  const [searching, setSearching] = useState(false);

  async function runSearch() {
    if (!searchForm.keyword.trim() && !hasScopeFilter(searchForm)) return;
    setSearching(true);
    try {
      const qs = new URLSearchParams({
        ...searchForm,
        venue: venueParam(searchForm),
        venues: venueParam(searchForm),
        rank: rankParam(searchForm),
        page_size: 30,
      });
      const data = await api(`/papers/search?${qs.toString()}`);
      setResults(data.papers || []);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal add-paper-modal" role="dialog" aria-modal="true" aria-labelledby="add-paper-title">
        <header>
          <div>
            <h2 id="add-paper-title">{text.modal.addToLibrary}</h2>
            <p>{activeLibrary.name}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        <div className="segmented source-tabs" aria-label="add paper source">
          <button type="button" className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>
            <Search size={15} /> {text.modal.searchToAdd}
          </button>
          <button type="button" className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}>
            <Upload size={15} /> {text.modal.uploadToAdd}
          </button>
        </div>
        {tab === 'search' ? (
          <>
            <div className="add-search-grid">
              <label>
                <span className="label-with-help">{text.modal.keyword}<KeywordHelp text={text} /></span>
                <input autoFocus placeholder={text.modal.keywordHint} value={searchForm.keyword} onChange={(e) => setSearchForm({ ...searchForm, keyword: e.target.value })} onKeyDown={(event) => {
                  if (event.key === 'Enter') runSearch();
                }} />
              </label>
              <div className="field-block">
                <span>{text.modal.scope}</span>
                <ScopeTokenInput value={searchForm} onChange={(scope) => setSearchForm((current) => ({ ...current, ...scope }))} text={text} onEnter={runSearch} />
              </div>
              <YearRangeSlider value={searchForm} onChange={(years) => setSearchForm({ ...searchForm, ...years })} text={text} />
            </div>
            <button className="secondary-button" disabled={searching || (!searchForm.keyword.trim() && !hasScopeFilter(searchForm))} onClick={runSearch}>
              <Search size={17} /> {text.common.search}
            </button>
            <div className="search-result-list" aria-label={text.modal.searchResults}>
              {results.map((paper) => (
                <label className="search-result-item" key={paper.id}>
                  <input
                    type="checkbox"
                    checked={chosen.has(paper.id)}
                    onChange={(event) => {
                      const next = new Set(chosen);
                      event.target.checked ? next.add(paper.id) : next.delete(paper.id);
                      setChosen(next);
                    }}
                  />
                  <span>
                    <strong>{paper.title}</strong>
                    <small>{[paper.pub_year, paper.venue_abbr || paper.venue_name, paper.rank ? `CCF ${paper.rank}` : ''].filter(Boolean).join(' · ')}</small>
                  </span>
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
              <button className="primary-button" disabled={busy || !chosen.size} onClick={() => onAddPapers([...chosen])}>
                <Plus size={17} /> {text.modal.addSelected}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="file-drop">
              <FileUp size={22} />
              <span>{text.table.uploadPdfZip}</span>
              <small>{text.modal.pdfHint}</small>
              <input type="file" multiple accept=".pdf,.zip,application/pdf,application/zip" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            </label>
            {!!files.length && <p className="file-count">{files.length} {text.modal.pdfFiles}</p>}
            <div className="modal-actions">
              <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
              <button className="primary-button" disabled={busy || !files.length} onClick={() => onUploadPdfs(files)}>
                <Upload size={17} /> {text.modal.uploadToAdd}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function PaperDetailsModal({ text, paper, onSaveDetails, onUploadPdf, onUnlinkPdf, onClose, busy }) {
  const venue = displayVenue(paper);
  const initialForm = {
    title: displayPaperTitle(paper),
    authors: fullAuthorsText(paper.authors),
    pub_year: paper.pub_year || '',
    venue: venue.label === '-' ? '' : venue.label,
    abstract: displayPaperAbstract(paper),
  };
  const [form, setForm] = useState(initialForm);
  useEffect(() => {
    setForm(initialForm);
  }, [paper.id]);
  const changed = Object.keys(initialForm).some((key) => String(form[key] ?? '').trim() !== String(initialForm[key] ?? '').trim());
  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  return (
    <div className="modal-backdrop light">
      <section className="modal paper-details-modal" role="dialog" aria-modal="true" aria-labelledby="paper-details-title">
        <header>
          <div>
            <h2 id="paper-details-title">{text.table.details}</h2>
            <p>{text.table.detailsEditable}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="paper-details-form">
          <label className="wide">
            <span>{text.table.paper}</span>
            <textarea value={form.title} onChange={(event) => updateField('title', event.target.value)} />
          </label>
          <label className="wide">
            <span>{text.table.authors}</span>
            <input value={form.authors} onChange={(event) => updateField('authors', event.target.value)} />
          </label>
          <label>
            <span>{text.table.year}</span>
            <input value={form.pub_year} onChange={(event) => updateField('pub_year', event.target.value)} />
          </label>
          <label>
            <span>{text.table.venue}</span>
            <input value={form.venue} onChange={(event) => updateField('venue', event.target.value)} />
          </label>
          <label>
            <span>{text.table.rank}</span>
            <input value={paper.rank || '-'} readOnly />
          </label>
        </div>
        <label className="paper-details-abstract">
          <span>{text.table.abstract}</span>
          <textarea
            value={form.abstract}
            placeholder={text.table.abstractPlaceholder}
            onChange={(event) => updateField('abstract', event.target.value)}
          />
        </label>
        <div className="paper-details-pdf-row">
          <span>{text.table.pdf}</span>
          <div>
            {paper.pdf_url ? (
              <small>{text.table.uploadedPdf}</small>
            ) : (
              <small>{text.table.noPdf}</small>
            )}
            <label className="secondary-button">
              <Upload size={15} /> {text.table.uploadPdf}
              <input
                type="file"
                accept="application/pdf"
                onChange={(event) => {
                  onUploadPdf(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
            {paper.pdf_url && (
              <button className="secondary-button danger-soft" disabled={busy} onClick={onUnlinkPdf}>
                <X size={15} /> {text.table.unlinkPdf}
              </button>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>{text.common.cancel}</button>
          <button className="primary-button" disabled={busy || !changed || !form.title.trim()} onClick={() => onSaveDetails(form)}>{text.common.save}</button>
        </div>
      </section>
    </div>
  );
}

function RenamePaperModal({ text, paper, title, setTitle, onCancel, onSave, busy }) {
  const unchanged = title.trim() === displayPaperTitle(paper).trim();
  return (
    <div className="modal-backdrop light">
      <section className="modal rename-paper-modal" role="dialog" aria-modal="true" aria-labelledby="rename-paper-title">
        <header>
          <div>
            <h2 id="rename-paper-title">{text.table.renamePaper}</h2>
            <p>{text.table.renamePaperDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        <label>
          <span>{text.table.paper}</span>
          <textarea autoFocus value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
          <button className="primary-button" disabled={busy || !title.trim() || unchanged} onClick={onSave}>
            {text.common.save}
          </button>
        </div>
      </section>
    </div>
  );
}

function PdfMismatchModal({ text, check, onCancel, onConfirm, busy }) {
  const paper = check.paper || {};
  const pdf = check.pdf || {};
  return (
    <div className="modal-backdrop light">
      <section className="modal pdf-mismatch-modal" role="dialog" aria-modal="true" aria-labelledby="pdf-mismatch-title">
        <header>
          <div>
            <h2 id="pdf-mismatch-title">{text.table.confirmPdfUpload}</h2>
            <p>{text.table.confirmPdfUploadDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        <div className="pdf-match-score">
          {text.table.similarity}: {Math.round((check.score || 0) * 100)}%
        </div>
        <div className="pdf-diff-grid">
          <article>
            <strong>{text.table.currentPaper}</strong>
            <h3>{paper.title || '-'}</h3>
            <p>{formatAuthors(paper.authors)}</p>
            <small>{[paper.pub_year, paper.venue].filter(Boolean).join(' · ') || '-'}</small>
          </article>
          <article>
            <strong>{text.table.uploadedPdf}</strong>
            <h3>{pdf.title || '-'}</h3>
            <p>{pdf.authors || '-'}</p>
            <small>{[pdf.pub_year, pdf.url].filter(Boolean).join(' · ') || '-'}</small>
          </article>
        </div>
        {!!pdf.candidates?.length && (
          <div className="pdf-candidates">
            {pdf.candidates.map((candidate) => <span key={candidate}>{candidate}</span>)}
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
          <button className="primary-button" disabled={busy} onClick={onConfirm}>
            <Upload size={17} /> {text.table.storeAnyway}
          </button>
        </div>
      </section>
    </div>
  );
}

function AssociatePaperModal({ paper, onAssociate, onCancel, busy, text }) {
  const [keyword, setKeyword] = useState(paper.title || '');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  async function runSearch() {
    if (!keyword.trim()) return;
    setSearching(true);
    try {
      const qs = new URLSearchParams({ keyword, page_size: 20 });
      const data = await api(`/papers/search?${qs.toString()}`);
      setResults((data.papers || []).filter((item) => item.id !== paper.id && !String(item.dblp_key || '').startsWith('upload/')));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal associate-modal" role="dialog" aria-modal="true" aria-labelledby="associate-title">
        <header>
          <div>
            <h2 id="associate-title">{text.modal.associateTitle}</h2>
            <p>{text.modal.associateDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        <label>
          <span>{text.modal.keyword}</span>
          <input
            autoFocus
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearch();
            }}
          />
        </label>
        <button className="secondary-button" disabled={searching || !keyword.trim()} onClick={runSearch}>
          <Search size={17} /> {text.common.search}
        </button>
        <div className="search-result-list">
          {results.map((item) => (
            <article className="associate-result-item" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <small>{[item.pub_year, item.venue_abbr || item.venue_name, item.rank ? `CCF ${item.rank}` : ''].filter(Boolean).join(' · ')}</small>
              </div>
              <button className="primary-button" disabled={busy} onClick={() => onAssociate(item.id)}>
                <Check size={17} /> {text.modal.associateToPaper}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function TagModal({ tag: initialTag, onCreate, onCancel, text }) {
  const [tag, setTag] = useState(initialTag || { name: '', description: '', auto_folder: false });
  return (
    <div className="modal-backdrop">
      <section className="modal compact" role="dialog" aria-modal="true" aria-labelledby="tag-modal-title">
        <header>
          <div>
            <h2 id="tag-modal-title">{initialTag ? text.modal.tagTitleEdit : text.modal.tagTitleAdd}</h2>
            <p>{text.modal.tagDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        <label>
          <span>{text.table.tagColumn}</span>
          <input placeholder={text.modal.tagName} value={tag.name} onChange={(e) => setTag({ ...tag, name: e.target.value })} />
        </label>
        <label>
          <span>Description</span>
          <textarea placeholder={text.modal.tagPrompt} value={tag.description} onChange={(e) => setTag({ ...tag, description: e.target.value })} />
        </label>
        <label className="tag-auto-folder-toggle">
          <input type="checkbox" checked={Boolean(tag.auto_folder)} onChange={(e) => setTag({ ...tag, auto_folder: e.target.checked })} />
          <span>
            <strong>{text.modal.autoFolder}</strong>
            <small>{text.modal.autoFolderHint}</small>
          </span>
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
          <button className="primary-button" disabled={!tag.name.trim()} onClick={() => onCreate({ ...tag, name: tag.name.trim() })}>
            <Plus size={17} /> {initialTag ? text.common.save : text.common.add}
          </button>
        </div>
      </section>
    </div>
  );
}

function FolderModal({ library, parentFolder, onCreate, onCancel, text }) {
  const [folderName, setFolderName] = useState('');
  return (
    <div className="modal-backdrop">
      <section className="modal compact" role="dialog" aria-modal="true" aria-labelledby="folder-modal-title">
        <header>
          <div>
            <h2 id="folder-modal-title">{parentFolder ? text.modal.addChildFolder : text.modal.addFolder}</h2>
            <p>{parentFolder || library.name}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onCancel}><X size={18} /></button>
        </header>
        <label>
          <span>{text.modal.folders}</span>
          <input
            autoFocus
            placeholder={text.modal.folderName}
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onCreate(folderName);
            }}
          />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>{text.common.cancel}</button>
          <button className="primary-button" disabled={!folderName.trim()} onClick={() => onCreate(folderName)}>
            <Plus size={17} /> {text.common.add}
          </button>
        </div>
      </section>
    </div>
  );
}

function TagFilterMenu({ definitions, activeTag, onSelect, onAdd, onEdit, text }) {
  return (
    <div className="tag-menu">
      <button className={activeTag ? '' : 'active'} onClick={() => onSelect('')}>{text.table.allTags}</button>
      {definitions.length === 0 && <p>{text.table.noTags}</p>}
      {definitions.map((tag) => (
        <div className="tag-menu-row" key={tag.name}>
          <button className={activeTag === tag.name ? 'active' : ''} onClick={() => onSelect(tag.name)}>
            <span>{tag.name}</span>
            <small>{tag.description}</small>
          </button>
          <button className="tag-edit-button" title={text.table.editTag} aria-label={text.table.editTag} onClick={() => onEdit(tag)}><Pencil size={13} /></button>
        </div>
      ))}
      <button onClick={onAdd}><Plus size={14} /> {text.table.addTag}</button>
    </div>
  );
}

function TagCheckboxes({ paper, definitions, onApply, text }) {
  const selectedTags = paper.tags_json || [];

  function toggleTag(tagName, checked) {
    const next = checked
      ? [...new Set([...selectedTags, tagName])]
      : selectedTags.filter((item) => item !== tagName);
    onApply(next);
  }

  if (!definitions.length) {
    return (
      <span className="tag-inline-empty">{text.table.noTagDefinitions}</span>
    );
  }

  return (
    <div className="tag-checkboxes">
      {definitions.map((tag) => (
        <label key={tag.name}>
          <input
            type="checkbox"
            checked={selectedTags.includes(tag.name)}
            onChange={(event) => toggleTag(tag.name, event.target.checked)}
          />
          <span>{tag.name}</span>
        </label>
      ))}
    </div>
  );
}

function TagMenu({ paper, definitions, onApply, onAdd, onEdit, text }) {
  const [selectedTags, setSelectedTags] = useState(paper.tags_json || []);
  function toggleTag(tagName, checked) {
    const next = checked
      ? [...new Set([...selectedTags, tagName])]
      : selectedTags.filter((item) => item !== tagName);
    setSelectedTags(next);
    onApply(next);
  }
  return (
    <div className="tag-menu">
      {definitions.length === 0 && <p>{text.table.noTags}</p>}
      {definitions.map((tag) => (
        <label key={tag.name}>
          <input
            type="checkbox"
            checked={selectedTags.includes(tag.name)}
            onChange={(e) => toggleTag(tag.name, e.target.checked)}
          />
          <span>{tag.name}</span>
          <small>{tag.description}</small>
          <button type="button" className="tag-edit-button" title={text.table.editTag} aria-label={text.table.editTag} onClick={() => onEdit(tag)}><Pencil size={13} /></button>
        </label>
      ))}
      <button onClick={onAdd}><Plus size={14} /> {text.table.addTag}</button>
    </div>
  );
}

export {
  AddPaperModal,
  AssociatePaperModal,
  FolderModal,
  LibraryCreateProgress,
  LibraryModal,
  PaperDetailsModal,
  PdfMismatchModal,
  RenamePaperModal,
  ShareLibraryModal,
  TagCheckboxes,
  TagFilterMenu,
  TagMenu,
  TagModal,
};
