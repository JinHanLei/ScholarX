import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Bot,
  BookMarked,
  BookOpen,
  Check,
  ChevronLeft,
  FileText,
  GraduationCap,
  Home,
  KeyRound,
  Languages,
  LogOut,
  RotateCcw,
  Rocket,
  Save,
  Sparkles,
  Tag,
  Trophy,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { api } from '../utils/api.js';
import { groupModels, isInvalidModelId } from '../utils/models.js';

function WritingMemoryModal({ text, draft, setDraft, onSave, onClose }) {
  return (
    <div className="modal-backdrop light" onClick={onClose}>
      <section className="modal memory-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>{text.user.memoryTitle}</h2>
            <p>{text.user.writingMemoryDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="memory-input-row">
          <textarea
            className="memory-single-textarea"
            value={draft}
            placeholder={text.user.memoryPlaceholder}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="primary-button" onClick={onSave}>
            <Check size={16} /> {text.user.memoryAdd}
          </button>
        </div>
      </section>
    </div>
  );
}

function ModelSelectionModal({ text, settings, models, loading, error, onSave, onClose }) {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState({
    mode: settings.mode || 'single',
    model: settings.model || '',
    protocol: settings.protocol || '',
  });
  useEffect(() => {
    setDraft({
      mode: settings.mode || 'single',
      model: settings.model || '',
      protocol: settings.protocol || '',
    });
  }, [settings]);
  const modelOptions = models.length ? [...models] : [];
  if (!isInvalidModelId(draft.model) && !modelOptions.some((model) => model.id === draft.model)) {
    modelOptions.unshift({ id: draft.model, name: draft.model });
  }
  const filteredModels = modelOptions.filter((model) => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    return String(model.id || '').toLowerCase().includes(keyword)
      || String(model.name || '').toLowerCase().includes(keyword);
  });
  const modelGroups = groupModels(filteredModels);
  return (
    <div className="modal-backdrop light" onClick={onClose}>
      <section className="modal model-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>{text.user.modelTitle}</h2>
            <p>{text.user.modelDesc}</p>
          </div>
          <button className="icon-button" aria-label={text.common.cancel} onClick={onClose}><X size={18} /></button>
        </header>
        <div className="model-mode-tabs">
          <button type="button" className={draft.mode === 'single' ? 'active' : ''} onClick={() => setDraft({ ...draft, mode: 'single' })}>
            {text.user.modelList}
          </button>
          <button type="button" className={draft.mode === 'smart' ? 'active' : ''} onClick={() => setDraft({ ...draft, mode: 'smart' })}>
            {text.user.modelSmart}
          </button>
        </div>
        {draft.mode === 'single' ? (
          <div className="model-list-panel">
            {loading && <p className="field-hint">{text.user.modelLoading}</p>}
            {error && <p className="field-hint warning">{error || text.user.modelLoadFailed}</p>}
            <input
              className="model-search-input"
              value={query}
              placeholder={text.user.modelSearch}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="model-option-list">
              {modelGroups.map((group) => (
                <section className="model-group" key={group.family}>
                  <h3>
                    <span>{group.family}</span>
                    <small>{group.items.length}</small>
                  </h3>
                  {group.items.map((model) => (
                    <button
                      type="button"
                      key={model.id}
                      className={draft.model === model.id ? 'active' : ''}
                      onClick={() => setDraft({ ...draft, model: model.id })}
                    >
                      <span>{model.name || model.id}</span>
                      {draft.model === model.id && <Check size={15} />}
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </div>
        ) : (
          <div className="model-smart-panel">
            <strong>{text.user.modelSmartTitle}</strong>
            <p>{text.user.modelSmartDesc}</p>
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>{text.common.cancel}</button>
          <button className="primary-button" onClick={() => onSave(draft)}>
            <Check size={16} /> {text.common.save}
          </button>
        </div>
      </section>
    </div>
  );
}

function TrashPage({ text, userEmail, onBack }) {
  const [papers, setPapers] = useState([]);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');

  async function loadTrash() {
    try {
      const data = await api(`/trash?owner=${encodeURIComponent(userEmail || '')}`);
      setPapers(data.papers || []);
      setFiles(data.files || []);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadTrash();
  }, [userEmail]);

  async function restorePaper(paper) {
    await api(`/libraries/${paper.library_id}/papers/${paper.id}/restore`, { method: 'POST', body: {} });
    await loadTrash();
  }

  async function restoreFile(file) {
    await api(`/libraries/${file.library_id}/files/${file.id}/restore`, { method: 'POST', body: {} });
    await loadTrash();
  }

  return (
    <main className="account-shell">
      <section className="account-page trash-page">
        <button className="secondary-button account-back" onClick={onBack}><ChevronLeft size={16} /> {text.common.backToWorkbench}</button>
        <header>
          <div>
            <h1>{text.user.trashTitle}</h1>
            <p>{text.user.trashDesc}</p>
          </div>
          <Trash2 size={32} />
        </header>
        {error && <div className="error-banner">{error}</div>}
        <div className="trash-list">
          {papers.map((paper) => (
            <article className="trash-item" key={`${paper.library_id}-${paper.id}`}>
              <div>
                <strong>{paper.title}</strong>
                <span>{paper.library_name}</span>
              </div>
              <button className="secondary-button" onClick={() => restorePaper(paper)}><RotateCcw size={15} /> {text.table.restore}</button>
            </article>
          ))}
          {files.map((file) => (
            <article className="trash-item" key={`file-${file.library_id}-${file.id}`}>
              <div>
                <strong>{file.name}</strong>
                <span>{file.library_name || ''} · {file.type === 'folder' ? text.workbench.newFolder : text.workbench.fileLibrary}</span>
              </div>
              <button className="secondary-button" onClick={() => restoreFile(file)}><RotateCcw size={15} /> {text.table.restore}</button>
            </article>
          ))}
          {!papers.length && !files.length && <p className="library-empty">{text.user.trashEmpty}</p>}
        </div>
      </section>
    </main>
  );
}

function HomePage({ text, locale, setLocale, stats, onDemo, userEmail, onSignOut }) {
  const statText = stats ? `${stats.papers.toLocaleString()} ${text.brand.indexed}` : text.brand.fallback;

  return (
    <main className="home-shell">
      <nav className="home-nav">
        <div className="brand">
          <div className="brand-mark"><GraduationCap size={23} /></div>
          <div>
            <h1>{text.brand.name}</h1>
            <p>{statText}</p>
          </div>
        </div>
        <div className="nav-actions">
          <a href="#features">{text.home.navFeatures}</a>
          <a href="#stories">{text.home.navStories}</a>
          <LanguageToggle locale={locale} setLocale={setLocale} text={text} />
          {userEmail && <span className="nav-user"><User size={15} /> {userEmail}</span>}
          {userEmail && (
            <button className="icon-button" title={text.common.signOut} aria-label={text.common.signOut} onClick={onSignOut}>
              <LogOut size={17} />
            </button>
          )}
          <button className="secondary-button nav-demo" onClick={onDemo}>
            {text.common.demo} <ArrowRight size={16} />
          </button>
        </div>
      </nav>

      <section className="home-hero">
        <div className="home-copy">
          <span className="eyebrow"><Sparkles size={15} /> {text.home.eyebrow}</span>
          <h2>{text.home.title}</h2>
          <p>{text.home.subtitle}</p>
          <div className="home-actions">
            <button className="primary-button demo-button" onClick={onDemo}>
              <Rocket size={20} /> {text.home.primary}
            </button>
            <a className="secondary-link" href="#features">
              <BookOpen size={17} /> {text.home.secondary}
            </a>
          </div>
        </div>

        <div className="home-board" aria-label={text.home.catalogTitle}>
          <div className="mini-window clay-pink">
            <div className="window-dots"><span /><span /><span /></div>
            <h3>{text.home.catalogTitle}</h3>
            <p>{text.home.catalogMeta}</p>
            <div className="course-preview">
              <span>{text.home.courseA}</span>
              <strong>CCF A</strong>
            </div>
            <div className="course-preview">
              <span>{text.home.courseB}</span>
              <strong>2025</strong>
            </div>
            <div className="course-preview">
              <span>{text.home.courseC}</span>
              <strong>PDF</strong>
            </div>
          </div>
          <div className="mini-window clay-mint">
            <div className="course-icon"><BarChart3 size={22} /></div>
            <h3>{text.home.progressTitle}</h3>
            <p>{text.home.progressMeta}</p>
            <ProgressRow label={text.home.progressDone} value="72%" />
            <ProgressRow label={text.home.progressPdf} value="48%" />
            <ProgressRow label={text.home.progressDraft} value="36%" />
          </div>
        </div>
      </section>

      <section id="features" className="home-section feature-grid">
        <article className="home-card">
          <BookMarked size={25} />
          <h3>{text.home.catalogTitle}</h3>
          <p>{text.home.catalogDesc}</p>
        </article>
        <article className="home-card">
          <BarChart3 size={25} />
          <h3>{text.home.progressTitle}</h3>
          <p>{text.home.progressDesc}</p>
        </article>
        <article className="home-card">
          <Bot size={25} />
          <h3>{text.agent.title}</h3>
          <p>{text.agent.placeholder}</p>
        </article>
      </section>

      <section id="stories" className="home-section story-band">
        <div>
          <span className="eyebrow"><Users size={15} /> {text.home.testimonialTitle}</span>
          <h2>{text.home.ctaTitle}</h2>
          <p>{text.home.ctaDesc}</p>
        </div>
        <div className="story-stack">
          <div className="testimonial-card"><Trophy size={20} /><p>{text.home.testimonialOne}</p><small>{text.home.progressDraft}</small></div>
          <div className="testimonial-card"><Tag size={20} /><p>{text.home.testimonialTwo}</p><small>{text.home.progressDone}</small></div>
        </div>
      </section>

      <section className="home-cta">
        <div>
          <h2>{text.home.ctaTitle}</h2>
          <p>{text.home.ctaDesc}</p>
        </div>
        <button className="primary-button demo-button" onClick={onDemo}>
          <Rocket size={20} /> {text.home.ctaButton}
        </button>
      </section>
    </main>
  );
}

function ProgressRow({ label, value }) {
  return (
    <div className="progress-row">
      <div><span>{label}</span><strong>{value}</strong></div>
      <div className="progress-track"><span style={{ width: value }} /></div>
    </div>
  );
}

function AuthPage({ text, locale, setLocale, onHome, onAuthed, supabase }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState('signin');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitAuth() {
    setError('');
    setBusy(true);
    try {
      if (!supabase) {
        if (!email.trim()) throw new Error(text.auth.noSupabase);
        localStorage.setItem('scholarx.localUser', email.trim());
        onAuthed({ user: { email: email.trim() } });
        return;
      }
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        setPendingVerification(true);
        return;
      }
      const status = await api(`/auth/email-status?email=${encodeURIComponent(email.trim())}`);
      if (!status.exists) {
        setMode('signup');
        setError(text.auth.pleaseRegister);
        return;
      }
      if (!status.confirmed) {
        setMode('signup');
        setPendingVerification(false);
        setError(text.auth.pleaseFinishRegister);
        return;
      }
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        if (authError.message?.toLowerCase().includes('email not confirmed')) {
          setMode('signup');
          setPendingVerification(false);
          setError(text.auth.pleaseFinishRegister);
          return;
        }
        if (
          authError.message?.toLowerCase().includes('invalid login credentials')
          || authError.code === 'invalid_credentials'
        ) {
          setMode('signup');
          setError(text.auth.pleaseRegister);
          return;
        }
        throw authError;
      }
      if (data.session) onAuthed(data.session);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setError('');
    setBusy(true);
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: 'signup',
      });
      if (verifyError) {
        if (verifyError.message?.toLowerCase().includes('unexpected failure')) {
          throw new Error(text.auth.authServiceBusy);
        }
        throw verifyError;
      }
      onAuthed(data.session || { user: data.user });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setError('');
    setBusy(true);
    try {
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) throw signUpError;
      setCode('');
      setError(text.auth.codeResent);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand">
          <div className="brand-mark"><GraduationCap size={23} /></div>
          <div>
            <h1>{text.brand.name}</h1>
            <p>{text.auth.subtitle}</p>
          </div>
        </div>
        <div>
          <h2>{pendingVerification ? text.auth.verifyTitle : text.auth.title}</h2>
          <p>{pendingVerification ? text.auth.verifyDesc : text.auth.subtitle}</p>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {!pendingVerification ? (
          <>
            <label>
              <span>{text.auth.email}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              <span>{text.auth.password}</span>
              <input type="password" placeholder={text.auth.passwordHint} value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <div className="segmented">
              <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>{text.auth.signIn}</button>
              <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>{text.auth.signUp}</button>
            </div>
            <button className="primary-button" disabled={busy || !email.trim()} onClick={submitAuth}>
              <KeyRound size={17} /> {mode === 'signin' ? text.auth.signIn : text.auth.signUp}
            </button>
          </>
        ) : (
          <>
            <label>
              <span>{text.auth.code}</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
            </label>
            <button className="primary-button" disabled={busy || !code.trim()} onClick={verifyCode}>
              <KeyRound size={17} /> {text.auth.verify}
            </button>
            <button className="secondary-button" disabled={busy || !email.trim()} onClick={resendCode}>
              <RotateCcw size={17} /> {text.auth.resendCode}
            </button>
          </>
        )}
        <div className="auth-actions">
          <button className="secondary-button" onClick={onHome}><Home size={16} /> {text.common.home}</button>
          <LanguageToggle locale={locale} setLocale={setLocale} text={text} />
        </div>
      </section>
    </main>
  );
}

function LanguageToggle({ locale, setLocale, text }) {
  return (
    <button
      className="language-toggle"
      type="button"
      aria-label={text.common.language}
      onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
    >
      {text.common.switchLanguage}
    </button>
  );
}

export {
  AuthPage,
  HomePage,
  LanguageToggle,
  ModelSelectionModal,
  TrashPage,
  WritingMemoryModal,
};
