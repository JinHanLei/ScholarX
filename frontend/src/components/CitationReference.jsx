import React from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileSearch } from 'lucide-react';
import { buildCitationSourceMap, citationMarker, makeCitationId, parseCitationId, splitCitationMarkers } from '../utils/citations.js';
import { displayPaperTitle, displayVenue } from '../utils/papers.js';

function CitationBubble({ refId, source, onOpen }) {
  const [open, setOpen] = React.useState(false);
  const [popoverStyle, setPopoverStyle] = React.useState(null);
  const bubbleRef = React.useRef(null);
  const closeTimerRef = React.useRef(null);
  const parsed = parseCitationId(refId);
  const merged = {
    ...parsed,
    ...(source || {}),
    refId,
  };
  const title = merged.title || '引用文献';
  const meta = [merged.year, merged.venue].filter(Boolean).join(' · ');
  const updatePopoverPosition = React.useCallback(() => {
    const bubble = bubbleRef.current;
    if (!bubble) return;
    const rect = bubble.getBoundingClientRect();
    const gap = 10;
    const margin = 12;
    const width = Math.min(340, window.innerWidth - margin * 2);
    const estimatedHeight = Math.min(260, Math.max(150, window.innerHeight - margin * 2));
    const fitsAbove = rect.top >= estimatedHeight + gap + margin;
    const top = fitsAbove
      ? rect.top - gap
      : Math.min(window.innerHeight - margin, rect.bottom + gap);
    const left = Math.min(
      Math.max(margin, rect.left + rect.width / 2 - width / 2),
      Math.max(margin, window.innerWidth - width - margin),
    );
    setPopoverStyle({
      left,
      top,
      width,
      maxHeight: Math.min(260, window.innerHeight - margin * 2),
      transform: fitsAbove ? 'translateY(-100%)' : 'translateY(0)',
    });
  }, []);
  const showPopover = () => {
    window.clearTimeout(closeTimerRef.current);
    setOpen(true);
    requestAnimationFrame(updatePopoverPosition);
  };
  const hidePopover = () => {
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 260);
  };
  React.useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);
  React.useEffect(() => {
    if (!open) return undefined;
    updatePopoverPosition();
    const handleMove = () => updatePopoverPosition();
    window.addEventListener('resize', handleMove);
    window.addEventListener('scroll', handleMove, true);
    return () => {
      window.removeEventListener('resize', handleMove);
      window.removeEventListener('scroll', handleMove, true);
    };
  }, [open, updatePopoverPosition]);
  return (
    <span
      className={`citation-ref-wrap ${open ? 'open' : ''}`}
      onMouseEnter={showPopover}
      onMouseLeave={hidePopover}
      onFocus={showPopover}
      onBlur={hidePopover}
    >
      <button
        ref={bubbleRef}
        type="button"
        className="citation-ref-bubble"
        onClick={(event) => {
          event.preventDefault();
          onOpen?.(merged);
        }}
        aria-label={`引用 ${title}`}
      >
        <span aria-hidden="true">”</span>
      </button>
      {open && popoverStyle && createPortal(
        <span
          className="citation-ref-popover"
          role="tooltip"
          style={popoverStyle}
          onMouseEnter={showPopover}
          onMouseLeave={hidePopover}
        >
          <strong>{title}</strong>
          {meta && <small>{meta}</small>}
          {merged.chunkText && <p>{merged.chunkText}</p>}
          {!merged.chunkText && merged.abstract && <p>{merged.abstract}</p>}
        </span>,
        document.body,
      )}
    </span>
  );
}

const MATH_SYMBOLS = {
  Alpha: 'Α',
  Beta: 'Β',
  Chi: 'Χ',
  Delta: 'Δ',
  Epsilon: 'Ε',
  Eta: 'Η',
  Gamma: 'Γ',
  Iota: 'Ι',
  Kappa: 'Κ',
  Lambda: 'Λ',
  Mu: 'Μ',
  Nu: 'Ν',
  Omega: 'Ω',
  Omicron: 'Ο',
  Phi: 'Φ',
  Pi: 'Π',
  Psi: 'Ψ',
  Rho: 'Ρ',
  Sigma: 'Σ',
  Tau: 'Τ',
  Theta: 'Θ',
  Upsilon: 'Υ',
  Xi: 'Ξ',
  Zeta: 'Ζ',
  aleph: 'ℵ',
  alpha: 'α',
  approx: '≈',
  beta: 'β',
  cdot: '·',
  chi: 'χ',
  cong: '≅',
  cup: '∪',
  delta: 'δ',
  div: '÷',
  dots: '...',
  downarrow: '↓',
  emptyset: '∅',
  epsilon: 'ε',
  equiv: '≡',
  eta: 'η',
  exists: '∃',
  forall: '∀',
  gamma: 'γ',
  ge: '>=',
  geq: '>=',
  hbar: 'ℏ',
  infty: '∞',
  in: '∈',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  langle: '⟨',
  leftarrow: '←',
  ldots: '...',
  le: '<=',
  leq: '<=',
  lg: 'lg',
  lim: 'lim',
  ln: 'ln',
  log: 'log',
  lnot: '¬',
  lor: '∨',
  max: 'max',
  min: 'min',
  mu: 'μ',
  nabla: '∇',
  neg: '¬',
  neq: '≠',
  ni: '∋',
  notin: '∉',
  nu: 'ν',
  omega: 'ω',
  omicron: 'ο',
  oplus: '⊕',
  partial: '∂',
  perp: '⊥',
  phi: 'φ',
  pi: 'π',
  pm: '±',
  prod: '∏',
  propto: '∝',
  psi: 'ψ',
  rangle: '⟩',
  rho: 'ρ',
  rightarrow: '→',
  sigma: 'σ',
  sim: '∼',
  subset: '⊂',
  subseteq: '⊆',
  superset: '⊃',
  superseteq: '⊇',
  sum: '∑',
  tau: 'τ',
  theta: 'θ',
  times: '×',
  to: '→',
  uparrow: '↑',
  upsilon: 'υ',
  varepsilon: 'ϵ',
  varphi: 'ϕ',
  varpi: 'ϖ',
  varrho: 'ϱ',
  varsigma: 'ς',
  vartheta: 'ϑ',
  xi: 'ξ',
  zeta: 'ζ',
};

const MATH_OPERATORS = new Set([
  'arg',
  'argmax',
  'argmin',
  'arccos',
  'arcsin',
  'arctan',
  'cos',
  'cosh',
  'cot',
  'coth',
  'csc',
  'deg',
  'det',
  'dim',
  'exp',
  'gcd',
  'hom',
  'inf',
  'ker',
  'lg',
  'lim',
  'liminf',
  'limsup',
  'ln',
  'log',
  'max',
  'min',
  'Pr',
  'sec',
  'sin',
  'sinh',
  'sup',
  'tan',
  'tanh',
]);

function readMathScript(expression, index) {
  if (expression[index] === '{') {
    let depth = 1;
    let cursor = index + 1;
    while (cursor < expression.length && depth > 0) {
      if (expression[cursor] === '{') depth += 1;
      if (expression[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    return {
      value: expression.slice(index + 1, Math.max(index + 1, cursor - 1)),
      nextIndex: cursor,
    };
  }
  return {
    value: expression[index] || '',
    nextIndex: index + 1,
  };
}

function renderMathExpression(expression) {
  const parts = [];
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === '\\') {
      const match = expression.slice(index + 1).match(/^[A-Za-z]+/);
      if (match) {
        const command = match[0];
        if (MATH_OPERATORS.has(command)) {
          parts.push(<span className="math-operator" key={`op-${index}`}>{MATH_SYMBOLS[command] || command}</span>);
        } else {
          parts.push(MATH_SYMBOLS[command] || `\\${command}`);
        }
        index += command.length;
      } else if (expression[index + 1]) {
        parts.push(expression[index + 1]);
        index += 1;
      }
      continue;
    }
    if ((char === '_' || char === '^') && index + 1 < expression.length) {
      const script = readMathScript(expression, index + 1);
      const Tag = char === '_' ? 'sub' : 'sup';
      parts.push(<Tag key={`script-${index}`}>{renderMathExpression(script.value)}</Tag>);
      index = script.nextIndex - 1;
      continue;
    }
    if (/[A-Za-z]/.test(char)) {
      parts.push(<var key={`var-${index}`}>{char}</var>);
      continue;
    }
    parts.push(char);
  }
  return parts;
}

function splitInlineMath(text) {
  const value = String(text || '');
  const parts = [];
  let cursor = 0;
  const mathRe = /(^|[^\\])\$([^$\n]+?)\$/g;
  for (const match of value.matchAll(mathRe)) {
    const markerStart = match.index + match[1].length;
    if (markerStart > cursor) parts.push({ type: 'text', text: value.slice(cursor, markerStart) });
    parts.push({ type: 'math', text: match[2] });
    cursor = markerStart + match[0].length - match[1].length;
  }
  if (cursor < value.length) parts.push({ type: 'text', text: value.slice(cursor) });
  return parts;
}

function renderInlineText(text, keyPrefix) {
  return splitInlineMath(text).map((part, index) => (
    part.type === 'math'
      ? <span className="inline-math" key={`${keyPrefix}-math-${index}`}>{renderMathExpression(part.text)}</span>
      : part.text
  ));
}

function renderCitationChildren(children, sources, onOpen) {
  return React.Children.toArray(children).flatMap((child, childIndex) => {
    if (typeof child === 'string') {
      return splitCitationMarkers(child).flatMap((part, partIndex) => {
        if (part.type === 'citation') {
          return (
            <CitationBubble
              key={`citation-${childIndex}-${partIndex}-${part.refId}`}
              refId={part.refId}
              source={sources?.[part.refId]}
              onOpen={onOpen}
            />
          );
        }
        return renderInlineText(part.text, `text-${childIndex}-${partIndex}`);
      });
    }
    if (React.isValidElement(child) && child.props?.children && typeof child.type !== 'string') {
      return React.cloneElement(child, {
        key: child.key || `node-${childIndex}`,
        children: renderCitationChildren(child.props.children, sources, onOpen),
      });
    }
    return child;
  });
}

function CitationMarkdown({ content, sources, onOpen }) {
  const components = {
    p: ({ children }) => <p>{renderCitationChildren(children, sources, onOpen)}</p>,
    li: ({ children }) => <li>{renderCitationChildren(children, sources, onOpen)}</li>,
    blockquote: ({ children }) => <blockquote>{renderCitationChildren(children, sources, onOpen)}</blockquote>,
    strong: ({ children }) => <strong>{renderCitationChildren(children, sources, onOpen)}</strong>,
    em: ({ children }) => <em>{renderCitationChildren(children, sources, onOpen)}</em>,
    td: ({ children }) => <td>{renderCitationChildren(children, sources, onOpen)}</td>,
    th: ({ children }) => <th>{renderCitationChildren(children, sources, onOpen)}</th>,
  };
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content || ''}
    </ReactMarkdown>
  );
}

function CitationSearchModal({ text, papers, onPick, onClose }) {
  const [query, setQuery] = React.useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (papers || [])
    .filter((paper) => {
      if (!normalizedQuery) return true;
      return `${displayPaperTitle(paper)} ${displayVenue(paper).label} ${paper.pub_year || ''}`.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, 40);
  return (
    <div className="modal-backdrop light" onMouseDown={onClose}>
      <section className="citation-picker-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>{text.workbench.insertCitation || '插入文献'}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>×</button>
        </header>
        <label className="citation-picker-search">
          <FileSearch size={16} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={text.workbench.searchPaperCitation || '搜索论文标题'}
          />
        </label>
        <div className="citation-picker-list">
          {matches.map((paper) => (
            <button
              key={paper.id}
              type="button"
              onClick={() => onPick?.(paper, citationMarker(makeCitationId({ paperId: paper.id })))}
            >
              <strong>{displayPaperTitle(paper)}</strong>
              <span>{[paper.pub_year, displayVenue(paper).label].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          {!matches.length && <p>{text.workbench.noCitationMatches || '没有匹配的论文'}</p>}
        </div>
      </section>
    </div>
  );
}

export {
  CitationBubble,
  CitationMarkdown,
  CitationSearchModal,
  buildCitationSourceMap,
};
