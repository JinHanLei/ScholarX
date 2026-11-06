import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Folder,
  Library,
  MoreVertical,
  Pencil,
  Share2,
  Trash2,
  Users,
} from 'lucide-react';
import useClickOutside from '../hooks/useClickOutside.js';
import { buildFolderTree, formatDateOnly } from '../utils/papers.js';

function toggleSetItem(setter, item) {
  setter((items) => {
    const next = new Set(items);
    next.has(item) ? next.delete(item) : next.add(item);
    return next;
  });
}

function LibraryTree({
  library,
  activeLibrary,
  activeFolder,
  paperTotal,
  text,
  locale,
  expandedLibraries,
  expandedFolders,
  setExpandedLibraries,
  setExpandedFolders,
  onOpenFolder,
  onOpenFiles,
  onEditLibrary,
  onShareLibrary,
  onContextMenu,
}) {
  const folderTree = buildFolderTree(library.filters_json?.folders || []);
  const expanded = expandedLibraries.has(library.id);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef(null);
  useClickOutside(actionsRef, actionsOpen, () => setActionsOpen(false));

  function runLibraryAction(action) {
    setActionsOpen(false);
    action();
  }

  return (
    <div className="library-tree-item">
      <div
        className={`library-item ${activeLibrary?.id === library.id && !activeFolder ? 'active' : ''} ${actionsOpen ? 'menu-open' : ''}`}
        onContextMenu={(event) => onContextMenu(event, 'library', library)}
      >
        <button className="tree-toggle" disabled={!folderTree.length} onClick={() => toggleSetItem(setExpandedLibraries, library.id)}>
          {folderTree.length ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <Library size={14} />}
        </button>
        <button className="library-main-button" onClick={() => onOpenFolder(library)}>
          <span className="library-title">{library.name}</span>
          <small>
            <strong className="library-count">
              ({paperTotal || 0})
            </strong>
            {library.is_shared ? <Share2 size={13} /> : null}
            {library.created_at && (
              <span className="library-created-at">
                {text.modal.createdAt || 'Created'} {formatDateOnly(library.created_at)}
              </span>
            )}
          </small>
        </button>
        <div className="library-actions-menu" ref={actionsRef}>
          <button
            className={`library-actions-trigger ${library.is_shared ? 'shared' : ''}`}
            aria-label={locale === 'zh' ? '论文库操作' : 'Library actions'}
            title={locale === 'zh' ? '论文库操作' : 'Library actions'}
            onClick={() => setActionsOpen((open) => !open)}
          >
            <MoreVertical size={15} />
          </button>
          {actionsOpen && (
            <div className="library-actions-popover">
              <button onClick={() => runLibraryAction(() => onShareLibrary(library))}>
                <Users size={14} /> {locale === 'zh' ? '共享' : 'Share'}
              </button>
              <button onClick={() => runLibraryAction(() => onEditLibrary(library))}>
                <Pencil size={14} /> {locale === 'zh' ? '编辑' : 'Edit'}
              </button>
            </div>
          )}
        </div>
      </div>
      {expanded && (
        <FolderTreeNodes
          nodes={folderTree}
          library={library}
          activeLibrary={activeLibrary}
          activeFolder={activeFolder}
          expandedFolders={expandedFolders}
          setExpandedFolders={setExpandedFolders}
          onOpenFolder={onOpenFolder}
          onContextMenu={onContextMenu}
        />
      )}
    </div>
  );
}

function FolderTreeNodes({
  nodes,
  library,
  activeLibrary,
  activeFolder,
  expandedFolders,
  setExpandedFolders,
  onOpenFolder,
  onContextMenu,
}) {
  return (
    <div className="library-folder-list">
      {nodes.map((node) => {
        const expanded = expandedFolders.has(node.path);
        return (
          <div className="library-folder-branch" key={node.path}>
            <div
              className={`library-folder-item ${activeLibrary?.id === library.id && activeFolder === node.path ? 'active' : ''}`}
              onContextMenu={(event) => onContextMenu(event, 'folder', { library, folder: node.path })}
            >
              <button className="tree-toggle" disabled={!node.children.length} onClick={() => toggleSetItem(setExpandedFolders, node.path)}>
                {node.children.length ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <Folder size={13} />}
              </button>
              <button className="folder-open-button" onClick={() => onOpenFolder(library, node.path)}>
                <Folder size={14} /> <span>{node.name}</span>
              </button>
            </div>
            {expanded && node.children.length > 0 && (
              <FolderTreeNodes
                nodes={node.children}
                library={library}
                activeLibrary={activeLibrary}
                activeFolder={activeFolder}
                expandedFolders={expandedFolders}
                setExpandedFolders={setExpandedFolders}
                onOpenFolder={onOpenFolder}
                onContextMenu={onContextMenu}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FileContextMenu({ text, menu, onClose, onNewFile, onNewFolder, onRename, onExport, onDelete }) {
  const [downloadOpen, setDownloadOpen] = useState(false);
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [onClose]);
  const { ref, style } = useViewportMenuPosition(menu);
  const submenuSide = menu.x > window.innerWidth - 420 ? 'left' : 'right';
  const parentId = menu.type === 'blank' ? menu.parentId : menu.target?.type === 'folder' ? menu.target.id : menu.target?.parent_id;
  const downloadLabel = menu.target?.type === 'folder'
    ? (text.workbench.downloadZip || text.workbench.download)
    : text.workbench.download;
  const downloadFormats = [
    ['raw', text.workbench.downloadZipRaw || '原始 Markdown'],
    ['apa', 'APA'],
    ['mla', 'MLA'],
    ['gbt', 'GB/T'],
    ['latex', 'LaTeX'],
  ];
  function runExport(format) {
    setDownloadOpen(false);
    onClose();
    onExport(menu.target, format);
  }
  return (
    <div ref={ref} className="context-menu" style={style} onClick={(event) => event.stopPropagation()}>
      {(menu.type === 'blank' || menu.type === 'folder') && (
        <>
          <button onClick={() => onNewFile(parentId)}><FileText size={14} /> {text.workbench.newFile}</button>
          <button onClick={() => onNewFolder(parentId)}><Folder size={14} /> {text.workbench.newFolder}</button>
        </>
      )}
      {menu.target && (
        <>
          <button onClick={() => onRename(menu.target)}><Pencil size={14} /> {text.workbench.rename}</button>
          <div
            className="context-submenu-wrap"
            onMouseEnter={() => setDownloadOpen(true)}
          >
            <button className="context-submenu-trigger" onClick={() => setDownloadOpen((open) => !open)}>
              <Download size={14} /> {downloadLabel} <ChevronRight size={14} />
            </button>
            {downloadOpen && (
              <div className={`context-submenu compact ${submenuSide}`}>
                {downloadFormats.map(([format, label]) => (
                  <button key={format} onClick={() => runExport(format)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="danger" onClick={() => onDelete(menu.target)}><Trash2 size={14} /> {text.common.confirmDelete}</button>
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

export { FileContextMenu, LibraryTree };
