import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  FileText,
  Folder,
  HelpCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import useClickOutside from '../hooks/useClickOutside.js';
import { folderLeaf, folderMarker, isUnmatchedUploadedPaper, paperFolderMarkers } from '../utils/papers.js';
import { normalizeTableSorts, toggleTableSort } from '../utils/tableFilters.js';

function SortButton({ label, column, tableFilters, setTableFilters }) {
  const sorts = normalizeTableSorts(tableFilters);
  const sortIndex = sorts.findIndex((item) => item.column === column);
  const active = sortIndex >= 0;
  const direction = active ? sorts[sortIndex].dir : '';
  return (
    <button
      type="button"
      className={`sort-button ${active ? 'active' : ''}`}
      onClick={() => setTableFilters((current) => toggleTableSort(current, column))}
      title="点击切换排序：默认方向、反方向、取消"
    >
      {label}
      {active ? <span className="sort-indicator">{direction === 'asc' ? '↑' : '↓'}{sorts.length > 1 ? sortIndex + 1 : ''}</span> : <ArrowUpDown size={13} />}
    </button>
  );
}

function PaginationBar({ text, tableFilters, total, onChange, onDownload, selectedCount, citationStatus, onExport, onRetryCitations }) {
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const downloadRef = useRef(null);
  const exportRef = useRef(null);
  const pageCount = Math.max(1, Math.ceil((total || 0) / tableFilters.page_size));
  const page = Math.min(tableFilters.page, pageCount);
  const pages = Array.from(new Set([1, page - 1, page, page + 1, pageCount]))
    .filter((item) => item >= 1 && item <= pageCount)
    .sort((a, b) => a - b);
  const exportDisabled = !selectedCount || !citationStatus?.exportable;
  const exportTitle = selectedCount
    ? citationStatus?.exportable
      ? text.workbench.citationReady
      : `${text.workbench.citationFetching}: ${citationStatus?.ready || 0}/${citationStatus?.total || selectedCount}`
    : text.workbench.exportCitations;
  useClickOutside(downloadRef, downloadOpen, () => setDownloadOpen(false));
  useClickOutside(exportRef, exportOpen, () => setExportOpen(false));
  return (
    <footer className="pagination-bar">
      <div className="download-actions">
        <div className="dropdown-action" ref={downloadRef}>
          <button className="secondary-button compact-download" disabled={!selectedCount} onClick={() => setDownloadOpen((open) => !open)}>
            <Download size={15} /> {text.workbench.download} <ChevronDown size={13} />
          </button>
          {downloadOpen && !!selectedCount && (
            <div className="dropdown-menu">
              <button onClick={() => { setDownloadOpen(false); onDownload('csv'); }}>{text.workbench.downloadCsv}</button>
              <button onClick={() => { setDownloadOpen(false); onDownload('xlsx'); }}>{text.workbench.downloadExcel}</button>
            </div>
          )}
        </div>
        <div className="dropdown-action" ref={exportRef}>
          <button className="secondary-button compact-download" title={exportTitle} disabled={exportDisabled} onClick={() => setExportOpen((open) => !open)}>
            <FileText size={15} /> {text.workbench.exportCitations} <ChevronDown size={13} />
          </button>
          {exportOpen && !exportDisabled && (
            <div className="dropdown-menu">
              <button onClick={() => { setExportOpen(false); onExport('bib'); }}>{text.workbench.exportBib}</button>
              <button onClick={() => { setExportOpen(false); onExport('apa'); }}>{text.workbench.exportApa}</button>
              <button onClick={() => { setExportOpen(false); onExport('mla'); }}>{text.workbench.exportMla}</button>
              <button onClick={() => { setExportOpen(false); onExport('gbt'); }}>{text.workbench.exportGbt}</button>
            </div>
          )}
        </div>
        {selectedCount > 0 && (citationStatus?.failed || 0) > 0 && (
          <button className="secondary-button compact-download" onClick={onRetryCitations}>
            {text.workbench.citationRetry}
          </button>
        )}
      </div>
      <div className="scholar-pages">
        <button className="icon-button" disabled={page <= 1} title={text.workbench.previous} onClick={() => onChange({ ...tableFilters, page: page - 1 })}>
          <ChevronLeft size={17} />
        </button>
        {pages.map((item, index) => (
          <React.Fragment key={item}>
            {index > 0 && item - pages[index - 1] > 1 && <span className="page-gap">...</span>}
            <button className={`page-number ${item === page ? 'active' : ''}`} onClick={() => onChange({ ...tableFilters, page: item })}>{item}</button>
          </React.Fragment>
        ))}
        <button className="icon-button" disabled={page >= pageCount} title={text.workbench.next} onClick={() => onChange({ ...tableFilters, page: page + 1 })}>
          <ChevronRight size={17} />
        </button>
        <select value={tableFilters.page_size} onChange={(e) => onChange({ ...tableFilters, page_size: Number(e.target.value), page: 1 })}>
          <option value="10">10</option>
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </div>
    </footer>
  );
}

function ContextMenu({ text, menu, folders, currentFolder, onClose, onEditLibrary, onNewFolder, onNewChildFolder, onDeleteFolder, onDeleteLibrary, onPinLibrary, onMovePaper, onCopyPaper, onRelinkPaper, onOpenDetails, onRenamePaper, onDeletePaper }) {
  const [openSubmenu, setOpenSubmenu] = useState(null);
  useEffect(() => {
    window.addEventListener('click', onClose);
    return () => window.removeEventListener('click', onClose);
  }, [onClose]);
  const { ref, style } = useViewportMenuPosition(menu);
  const submenuSide = menu.x > window.innerWidth - 420 ? 'left' : 'right';
  const moveTargets = menu.type === 'paper' ? folders.filter((folder) => folder !== currentFolder) : [];
  const copyTargets = menu.type === 'paper' ? folders.filter((folder) => !paperFolderMarkers(menu.target).has(folderMarker(folder))) : [];

  return (
    <div ref={ref} className="context-menu" style={style} onClick={(event) => event.stopPropagation()}>
      {menu.type === 'library' && (
        <>
          <button onClick={() => onEditLibrary(menu.target)}><Pencil size={14} /> 修改论文库</button>
          <button onClick={() => onPinLibrary(menu.target)}><ChevronUp size={14} /> 置顶</button>
          <button onClick={() => onNewFolder(menu.target)}><Plus size={14} /> 新建子目录</button>
          <button className="danger" onClick={() => onDeleteLibrary(menu.target)}><Trash2 size={14} /> {text.library.delete}</button>
        </>
      )}
      {menu.type === 'folder' && (
        <>
          <div className="context-menu-title">{menu.target.folder}</div>
          <button onClick={() => onNewChildFolder(menu.target.library, menu.target.folder)}><Plus size={14} /> {text.modal.addChildFolder}</button>
          <button className="danger" onClick={() => onDeleteFolder(menu.target.library, menu.target.folder)}><Trash2 size={14} /> {text.table.deleteFolder}</button>
        </>
      )}
      {menu.type === 'paper' && (
        <>
          <button onClick={() => onOpenDetails(menu.target)}><HelpCircle size={14} /> {text.table.details}</button>
          <div
            className="context-submenu-wrap"
            onMouseEnter={() => setOpenSubmenu('move')}
          >
            <button className="context-submenu-trigger" onClick={() => setOpenSubmenu(openSubmenu === 'move' ? null : 'move')}>
              <Folder size={14} /> {text.table.moveToFolder} <ChevronRight size={14} />
            </button>
            {openSubmenu === 'move' && (
              <div className={`context-submenu ${submenuSide}`}>
                {((currentFolder && currentFolder !== '__all__') || menu.target.user_columns_json?.folder) && (
                  <button onClick={() => onMovePaper(menu.target, '')}><Folder size={14} /> {text.table.moveToRoot}</button>
                )}
                {moveTargets.map((folder) => (
                  <button className="context-folder-target" style={{ paddingLeft: 12 + folder.split('/').length * 10 }} key={folder} onClick={() => onMovePaper(menu.target, folder)}>
                    <Folder size={14} /> {folderLeaf(folder)}
                  </button>
                ))}
                {moveTargets.length === 0 && <button disabled>{text.table.noFolder}</button>}
              </div>
            )}
          </div>
          <div
            className="context-submenu-wrap"
            onMouseEnter={() => setOpenSubmenu('copy')}
          >
            <button className="context-submenu-trigger" onClick={() => setOpenSubmenu(openSubmenu === 'copy' ? null : 'copy')}>
              <Copy size={14} /> {text.table.copyToFolder} <ChevronRight size={14} />
            </button>
            {openSubmenu === 'copy' && (
              <div className={`context-submenu ${submenuSide}`}>
                {copyTargets.map((folder) => (
                  <button className="context-folder-target" style={{ paddingLeft: 12 + folder.split('/').length * 10 }} key={`copy-${folder}`} onClick={() => onCopyPaper(menu.target, folder)}>
                    <Copy size={14} /> {folderLeaf(folder)}
                  </button>
                ))}
                {copyTargets.length === 0 && <button disabled>{text.table.noFolder}</button>}
              </div>
            )}
          </div>
          {menu.target.pdf_url && (
            <button onClick={() => onRelinkPaper(menu.target)}><Search size={14} /> {text.table.relink}</button>
          )}
          {isUnmatchedUploadedPaper(menu.target) && (
            <button onClick={() => onRenamePaper(menu.target)}><Pencil size={14} /> {text.table.renamePaper}</button>
          )}
          <button className="danger" onClick={() => onDeletePaper(menu.target)}><Trash2 size={14} /> {text.table.remove}</button>
        </>
      )}
    </div>
  );
}

function useViewportMenuPosition(menu) {
  const ref = useRef(null);
  const [style, setStyle] = useState({ left: menu.x, top: menu.y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      setStyle({ left: menu.x, top: menu.y });
      return;
    }

    const margin = 8;
    const rect = element.getBoundingClientRect();
    let left = menu.x;
    let top = menu.y;

    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height + margin > window.innerHeight) {
      top = menu.y - rect.height - margin;
      if (top < margin) {
        top = Math.max(margin, window.innerHeight - rect.height - margin);
      }
    }

    setStyle({ left, top });
  }, [menu]);

  return { ref, style };
}

export { ContextMenu, PaginationBar, SortButton };
