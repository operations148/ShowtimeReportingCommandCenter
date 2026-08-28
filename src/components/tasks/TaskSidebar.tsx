import React, { useState } from 'react';
import {
  Plus, Building2, Folder, FolderOpen, List as ListIcon, Archive, RotateCcw, Pencil,
  Check, X, Loader2, ChevronDown, FolderInput
} from 'lucide-react';
import { TaskSpace, TaskFolder, TaskList } from '../../tasks/apiClient';

/**
 * Every hierarchy mutation this sidebar can request. A single discriminated-union callback
 * (rather than a dozen separate handler props) keeps the parent's optimistic-update-plus-
 * rollback logic in ONE place per action, and keeps this component's own Props surface small
 * despite Space/Folder/List each getting the same five verbs (create, rename, archive/restore,
 * reorder, and — Folders and Lists only — move).
 *
 * Resolves `true` on success (the caller should close/reset any open editor) or `false` on
 * failure (the caller should leave an open editor's typed value alone, matching the existing
 * "a failed rename keeps the edit row open with the typed value" convention elsewhere in this
 * module). Never rejects — the parent already turns a failure into a rollback plus a banner.
 */
export type HierarchyAction =
  | { type: 'createSpace'; name: string }
  | { type: 'createFolder'; spaceId: string; name: string }
  | { type: 'createList'; spaceId: string; folderId: string | null; name: string }
  | { type: 'renameSpace'; space: TaskSpace; name: string }
  | { type: 'renameFolder'; folder: TaskFolder; name: string }
  | { type: 'renameList'; list: TaskList; name: string }
  | { type: 'archiveToggleSpace'; space: TaskSpace }
  | { type: 'archiveToggleFolder'; folder: TaskFolder }
  | { type: 'archiveToggleList'; list: TaskList }
  | { type: 'reorderSpace'; space: TaskSpace; dir: -1 | 1 }
  | { type: 'reorderFolder'; folder: TaskFolder; dir: -1 | 1 }
  | { type: 'reorderList'; list: TaskList; dir: -1 | 1 }
  | { type: 'moveList'; list: TaskList; folderId: string | null };

interface Props {
  spaces: TaskSpace[];
  folders: TaskFolder[];
  lists: TaskList[];
  selectedSpaceId: string | null;
  selectedListId: string | null;
  expandedSpaceIds: Set<string>;
  expandedFolderIds: Set<string>;
  /** Ids currently mid-mutation (rename/archive/reorder/move), including "temp-…" create
   *  placeholders — the affected row shows a spinner and is not interactive. */
  pendingIds: Set<string>;
  canManage: boolean;
  showArchived: boolean;
  onSelectSpace: (id: string) => void;
  onSelectList: (id: string) => void;
  onToggleSpaceExpanded: (id: string) => void;
  onToggleFolderExpanded: (id: string) => void;
  onAction: (action: HierarchyAction) => Promise<boolean>;
}

type Editing =
  | { kind: 'space' | 'folder' | 'list'; id: string }
  | null;

const rowBtn =
  'flex-1 min-w-0 flex items-center gap-1.5 rounded-lg text-left transition-colors cursor-pointer ' +
  'focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * Space -> optional Folder -> List navigation with inline management.
 *
 * Purely presentational plus its own EPHEMERAL editing state (which input is open, what has
 * been typed, which specific item is mid-request). All actual data — spaces/folders/lists,
 * selection, expand/collapse — is owned by the parent and passed in, so the parent can apply
 * an optimistic update the instant an action fires and roll it back if the request fails.
 *
 * Direct Lists render before Folders within a Space (matching the target hierarchy example),
 * since the two have independent position sequences with no natural shared ordering.
 */
export default function TaskSidebar(p: Props) {
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [creatingFolderFor, setCreatingFolderFor] = useState<string | null>(null);
  const [creatingListFor, setCreatingListFor] = useState<{ spaceId: string; folderId: string | null } | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [editValue, setEditValue] = useState('');

  const visibleSpaces = p.spaces
    .filter(s => p.showArchived || !s.archived_at)
    .sort((a, b) => a.position - b.position);

  const isPending = (id: string) => p.pendingIds.has(id) || id.startsWith('temp-');

  const startRename = (kind: 'space' | 'folder' | 'list', id: string, current: string) => {
    setEditing({ kind, id });
    setEditValue(current);
  };
  const commitRename = async () => {
    if (!editing) return;
    const name = editValue.trim();
    if (!name) { setEditing(null); return; }
    const target = editing;
    let ok = false;
    if (target.kind === 'space') {
      const space = p.spaces.find(s => s.id === target.id);
      if (space) ok = await p.onAction({ type: 'renameSpace', space, name });
    } else if (target.kind === 'folder') {
      const folder = p.folders.find(f => f.id === target.id);
      if (folder) ok = await p.onAction({ type: 'renameFolder', folder, name });
    } else {
      const list = p.lists.find(l => l.id === target.id);
      if (list) ok = await p.onAction({ type: 'renameList', list, name });
    }
    if (ok) setEditing(null);
  };

  const submitCreateSpace = async () => {
    const name = draft.trim();
    if (!name) return;
    const ok = await p.onAction({ type: 'createSpace', name });
    if (ok) { setDraft(''); setCreatingSpace(false); }
  };
  const submitCreateFolder = async (spaceId: string) => {
    const name = draft.trim();
    if (!name) return;
    const ok = await p.onAction({ type: 'createFolder', spaceId, name });
    if (ok) { setDraft(''); setCreatingFolderFor(null); }
  };
  const submitCreateList = async (spaceId: string, folderId: string | null) => {
    const name = draft.trim();
    if (!name) return;
    const ok = await p.onAction({ type: 'createList', spaceId, folderId, name });
    if (ok) { setDraft(''); setCreatingListFor(null); }
  };

  const archiveSpace = (space: TaskSpace) => {
    if (!space.archived_at && !window.confirm(
      `Archive the Space "${space.name}"? Its Folders, Lists and tasks stay intact and it can be restored.`
    )) return;
    p.onAction({ type: 'archiveToggleSpace', space });
  };
  const archiveFolder = (folder: TaskFolder) => {
    if (!folder.archived_at && !window.confirm(
      `Archive the Folder "${folder.name}"? It must be empty — move or archive its Lists first if this is refused.`
    )) return;
    p.onAction({ type: 'archiveToggleFolder', folder });
  };
  const archiveList = (list: TaskList) => {
    if (!list.archived_at && !window.confirm(
      `Archive the List "${list.name}"? Its tasks stay intact and it can be restored.`
    )) return;
    p.onAction({ type: 'archiveToggleList', list });
  };

  const folderOptionsFor = (spaceId: string) =>
    p.folders.filter(f => f.space_id === spaceId && !f.archived_at).sort((a, b) => a.position - b.position);

  return (
    <nav aria-label="Spaces and Lists" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Spaces</h2>
        {p.canManage && (
          <button
            onClick={() => { setCreatingSpace(v => !v); setDraft(''); }}
            aria-expanded={creatingSpace}
            aria-label="Create a new Space"
            className="p-1 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {creatingSpace && (
        <div className="flex gap-1">
          <label className="sr-only" htmlFor="new-space-name">New Space name</label>
          <input
            id="new-space-name" autoFocus value={draft} maxLength={120}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitCreateSpace(); if (e.key === 'Escape') setCreatingSpace(false); }}
            placeholder="Space name"
            className="flex-1 min-w-0 text-[11px] p-1.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-semibold"
          />
          <button onClick={submitCreateSpace} aria-label="Save Space"
            className="p-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-50">
            <Check className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {visibleSpaces.length === 0 && (
        <p className="text-[11px] text-slate-500 font-medium">
          {p.canManage ? 'Create your first Space to get started.' : 'No Spaces yet.'}
        </p>
      )}

      <ul className="space-y-1">
        {visibleSpaces.map(space => {
          const spaceOpen = p.expandedSpaceIds.has(space.id);
          const directLists = p.lists
            .filter(l => l.space_id === space.id && l.folder_id === null && (p.showArchived || !l.archived_at))
            .sort((a, b) => a.position - b.position);
          const spaceFolders = p.folders
            .filter(f => f.space_id === space.id && (p.showArchived || !f.archived_at))
            .sort((a, b) => a.position - b.position);
          const spacePending = isPending(space.id);

          return (
            <li key={space.id} className={space.archived_at ? 'opacity-60' : ''}>
              <div className="flex items-center gap-1 group">
                {editing?.kind === 'space' && editing.id === space.id ? (
                  <EditRow value={editValue} onChange={setEditValue} onCommit={commitRename} onCancel={() => setEditing(null)} label={`Rename Space ${space.name}`} />
                ) : (
                  <>
                    {/* Two SIBLING buttons, not nested — an interactive element inside a
                        <button> is invalid HTML/ARIA and breaks accessible-name computation.
                        The chevron toggles expand/collapse alone; the label selects the Space
                        AND expands it (so selecting always reveals its children). */}
                    <button
                      onClick={() => p.onToggleSpaceExpanded(space.id)}
                      aria-expanded={spaceOpen}
                      aria-label={spaceOpen ? `Collapse ${space.name}` : `Expand ${space.name}`}
                      disabled={spacePending}
                      className="p-1 rounded hover:bg-slate-200 shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none"
                    >
                      <ChevronDown className={`w-3 h-3 transition-transform ${spaceOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => { p.onSelectSpace(space.id); if (!spaceOpen) p.onToggleSpaceExpanded(space.id); }}
                      disabled={spacePending}
                      className={`${rowBtn} px-2 py-1.5 text-[11px] font-bold ${
                        p.selectedSpaceId === space.id ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Building2 className="w-3.5 h-3.5 shrink-0 text-blue-500" aria-hidden="true" />
                      <span className="truncate">{space.name}</span>
                      {space.archived_at && <span className="text-[8px] uppercase font-black text-slate-500 shrink-0">Arch</span>}
                      {spacePending && <Loader2 className="w-3 h-3 animate-spin text-slate-400 shrink-0" aria-hidden="true" />}
                    </button>
                    {p.canManage && !spacePending && (
                      <span className="hidden group-hover:flex group-focus-within:flex items-center gap-0.5 shrink-0">
                        <button onClick={() => p.onAction({ type: 'reorderSpace', space, dir: -1 })} aria-label={`Move ${space.name} up`}
                          className="p-0.5 text-slate-500 hover:text-slate-600 cursor-pointer text-[9px] font-black">▲</button>
                        <button onClick={() => p.onAction({ type: 'reorderSpace', space, dir: 1 })} aria-label={`Move ${space.name} down`}
                          className="p-0.5 text-slate-500 hover:text-slate-600 cursor-pointer text-[9px] font-black">▼</button>
                        <button onClick={() => startRename('space', space.id, space.name)}
                          aria-label={`Rename ${space.name}`} className="p-0.5 text-slate-500 hover:text-blue-600 cursor-pointer">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button onClick={() => archiveSpace(space)}
                          aria-label={space.archived_at ? `Restore ${space.name}` : `Archive ${space.name}`}
                          className="p-0.5 text-slate-500 hover:text-amber-600 cursor-pointer">
                          {space.archived_at ? <RotateCcw className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
                        </button>
                      </span>
                    )}
                  </>
                )}
              </div>

              {spaceOpen && (
                <ul className="ml-4 mt-1 space-y-0.5 border-l border-slate-200 pl-2">
                  {directLists.map(list => (
                    <ListRow key={list.id} sidebar={p} list={list} editing={editing} editValue={editValue}
                      setEditValue={setEditValue} startRename={startRename} commitRename={commitRename}
                      setEditing={setEditing} archiveList={archiveList} isPending={isPending}
                      folderOptions={folderOptionsFor(space.id)} />
                  ))}

                  {p.canManage && (
                    creatingListFor?.spaceId === space.id && creatingListFor.folderId === null ? (
                      <CreateRow value={draft} onChange={setDraft} placeholder="List name" saveLabel="Save List"
                        onCommit={() => submitCreateList(space.id, null)} onCancel={() => setCreatingListFor(null)}
                        label={`New List in ${space.name}`} />
                    ) : (
                      <li>
                        <button
                          onClick={() => { setCreatingListFor({ spaceId: space.id, folderId: null }); setDraft(''); }}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-slate-500 hover:text-blue-700 rounded-lg focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none cursor-pointer"
                        >
                          <Plus className="w-3 h-3" aria-hidden="true" /> Add List
                        </button>
                      </li>
                    )
                  )}

                  {spaceFolders.map(folder => {
                    const folderOpen = p.expandedFolderIds.has(folder.id);
                    const folderLists = p.lists
                      .filter(l => l.folder_id === folder.id && (p.showArchived || !l.archived_at))
                      .sort((a, b) => a.position - b.position);
                    const folderPending = isPending(folder.id);

                    return (
                      <li key={folder.id} className={folder.archived_at ? 'opacity-60' : ''}>
                        <div className="flex items-center gap-1 group/folder">
                          {editing?.kind === 'folder' && editing.id === folder.id ? (
                            <EditRow value={editValue} onChange={setEditValue} onCommit={commitRename} onCancel={() => setEditing(null)} label={`Rename Folder ${folder.name}`} />
                          ) : (
                            <>
                              <button
                                onClick={() => p.onToggleFolderExpanded(folder.id)}
                                aria-expanded={folderOpen}
                                aria-label={`${folderOpen ? 'Collapse' : 'Expand'} ${folder.name}, ${folderLists.length} list${folderLists.length === 1 ? '' : 's'}${folder.archived_at ? ', archived' : ''}`}
                                disabled={folderPending}
                                className={`${rowBtn} px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100`}
                              >
                                <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${folderOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
                                {folderOpen
                                  ? <FolderOpen className="w-3.5 h-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                                  : <Folder className="w-3.5 h-3.5 shrink-0 text-amber-500" aria-hidden="true" />}
                                <span className="truncate" aria-hidden="true">{folder.name}</span>
                                <span className="text-[9px] font-black text-slate-600 shrink-0" aria-hidden="true">{folderLists.length}</span>
                                {folder.archived_at && <span className="text-[8px] uppercase font-black text-slate-500 shrink-0" aria-hidden="true">Arch</span>}
                                {folderPending && <Loader2 className="w-3 h-3 animate-spin text-slate-400 shrink-0" aria-hidden="true" />}
                              </button>
                              {p.canManage && !folderPending && (
                                <span className="hidden group-hover/folder:flex group-focus-within/folder:flex items-center gap-0.5 shrink-0">
                                  <button onClick={() => p.onAction({ type: 'reorderFolder', folder, dir: -1 })} aria-label={`Move ${folder.name} up`}
                                    className="p-0.5 text-slate-500 hover:text-slate-600 cursor-pointer text-[9px] font-black">▲</button>
                                  <button onClick={() => p.onAction({ type: 'reorderFolder', folder, dir: 1 })} aria-label={`Move ${folder.name} down`}
                                    className="p-0.5 text-slate-500 hover:text-slate-600 cursor-pointer text-[9px] font-black">▼</button>
                                  <button onClick={() => startRename('folder', folder.id, folder.name)}
                                    aria-label={`Rename ${folder.name}`} className="p-0.5 text-slate-500 hover:text-blue-600 cursor-pointer">
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => archiveFolder(folder)}
                                    aria-label={folder.archived_at ? `Restore ${folder.name}` : `Archive ${folder.name}`}
                                    className="p-0.5 text-slate-500 hover:text-amber-600 cursor-pointer">
                                    {folder.archived_at ? <RotateCcw className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
                                  </button>
                                </span>
                              )}
                            </>
                          )}
                        </div>

                        {folderOpen && (
                          <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2">
                            {folderLists.length === 0 && (
                              <li className="text-[10px] text-slate-400 font-semibold px-2 py-1">Empty folder</li>
                            )}
                            {folderLists.map(list => (
                              <ListRow key={list.id} sidebar={p} list={list} editing={editing} editValue={editValue}
                                setEditValue={setEditValue} startRename={startRename} commitRename={commitRename}
                                setEditing={setEditing} archiveList={archiveList} isPending={isPending}
                                folderOptions={folderOptionsFor(space.id)} />
                            ))}
                            {p.canManage && (
                              creatingListFor?.spaceId === space.id && creatingListFor.folderId === folder.id ? (
                                <CreateRow value={draft} onChange={setDraft} placeholder="List name" saveLabel="Save List"
                                  onCommit={() => submitCreateList(space.id, folder.id)} onCancel={() => setCreatingListFor(null)}
                                  label={`New List in ${folder.name}`} />
                              ) : (
                                <li>
                                  <button
                                    onClick={() => { setCreatingListFor({ spaceId: space.id, folderId: folder.id }); setDraft(''); }}
                                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-blue-700 rounded-lg focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none cursor-pointer"
                                  >
                                    <Plus className="w-3 h-3" aria-hidden="true" /> Add List
                                  </button>
                                </li>
                              )
                            )}
                          </ul>
                        )}
                      </li>
                    );
                  })}

                  {p.canManage && (
                    creatingFolderFor === space.id ? (
                      <CreateRow value={draft} onChange={setDraft} placeholder="Folder name" saveLabel="Save Folder"
                        onCommit={() => submitCreateFolder(space.id)} onCancel={() => setCreatingFolderFor(null)}
                        label={`New Folder in ${space.name}`} />
                    ) : (
                      <li>
                        <button
                          onClick={() => { setCreatingFolderFor(space.id); setDraft(''); }}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-slate-500 hover:text-amber-700 rounded-lg focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none cursor-pointer"
                        >
                          <Plus className="w-3 h-3" aria-hidden="true" /> Add Folder
                        </button>
                      </li>
                    )
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Shared inline text editor for a rename-in-place row. */
function EditRow(p: {
  value: string; onChange: (v: string) => void; onCommit: () => void; onCancel: () => void; label: string;
}) {
  return (
    <span className="flex gap-1 flex-1 min-w-0">
      <input
        autoFocus value={p.value} maxLength={120}
        onChange={e => p.onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') p.onCommit(); if (e.key === 'Escape') p.onCancel(); }}
        className="flex-1 min-w-0 text-[11px] p-1 bg-white border border-blue-300 rounded outline-none font-semibold"
        aria-label={p.label}
      />
      <button onClick={p.onCommit} aria-label="Save name" className="p-1 text-emerald-600 cursor-pointer">
        <Check className="w-3.5 h-3.5" />
      </button>
      <button onClick={p.onCancel} aria-label="Cancel rename" className="p-1 text-slate-500 cursor-pointer">
        <X className="w-3.5 h-3.5" />
      </button>
    </span>
  );
}

/** Shared inline text input for a new-item row (Space/Folder/List creation). */
function CreateRow(p: {
  value: string; onChange: (v: string) => void; placeholder: string;
  onCommit: () => void; onCancel: () => void; label: string; saveLabel: string;
}) {
  return (
    <li className="flex gap-1">
      <input
        autoFocus value={p.value} maxLength={120}
        onChange={e => p.onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') p.onCommit(); if (e.key === 'Escape') p.onCancel(); }}
        placeholder={p.placeholder} aria-label={p.label}
        className="flex-1 min-w-0 text-[11px] p-1 bg-white border border-slate-200 rounded outline-none focus:border-blue-500"
      />
      <button onClick={p.onCommit} aria-label={p.saveLabel} className="p-1 rounded bg-blue-600 text-white cursor-pointer">
        <Check className="w-3 h-3" />
      </button>
    </li>
  );
}

interface ListRowProps {
  sidebar: Props; list: TaskList; editing: Editing; editValue: string;
  setEditValue: (v: string) => void;
  startRename: (kind: 'space' | 'folder' | 'list', id: string, current: string) => void;
  commitRename: () => void; setEditing: (e: Editing) => void;
  archiveList: (l: TaskList) => void; isPending: (id: string) => boolean;
  folderOptions: TaskFolder[];
}

/** One List row, used both for a Space's direct Lists and for a Folder's Lists. */
const ListRow: React.FC<ListRowProps> = (p) => {
  const { list } = p;
  const pending = p.isPending(list.id);
  const selected = p.sidebar.selectedListId === list.id;

  if (p.editing?.kind === 'list' && p.editing.id === list.id) {
    return (
      <li>
        <EditRow value={p.editValue} onChange={p.setEditValue} onCommit={p.commitRename}
          onCancel={() => p.setEditing(null)} label={`Rename List ${list.name}`} />
      </li>
    );
  }

  return (
    <li className={`flex items-center gap-1 group/list ${list.archived_at ? 'opacity-60' : ''}`}>
      <button
        onClick={() => p.sidebar.onSelectList(list.id)}
        aria-current={selected ? 'true' : undefined}
        disabled={pending}
        className={`${rowBtn} px-2 py-1 text-[11px] font-semibold ${
          selected ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'
        }`}
      >
        <ListIcon className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{list.name}</span>
        {list.is_default && (
          <span className={`text-[8px] uppercase font-black shrink-0 ${selected ? 'opacity-80' : 'opacity-60'}`}>def</span>
        )}
        {list.archived_at && <span className="text-[8px] uppercase font-black shrink-0 opacity-80">Arch</span>}
        {pending && <Loader2 className="w-3 h-3 animate-spin shrink-0" aria-hidden="true" />}
      </button>
      {p.sidebar.canManage && !pending && (
        <span className="hidden group-hover/list:flex group-focus-within/list:flex items-center gap-0.5 shrink-0">
          <button onClick={() => p.sidebar.onAction({ type: 'reorderList', list, dir: -1 })} aria-label={`Move ${list.name} up`}
            className="p-0.5 text-slate-500 hover:text-slate-600 cursor-pointer text-[9px] font-black">▲</button>
          <button onClick={() => p.sidebar.onAction({ type: 'reorderList', list, dir: 1 })} aria-label={`Move ${list.name} down`}
            className="p-0.5 text-slate-500 hover:text-slate-600 cursor-pointer text-[9px] font-black">▼</button>
          {p.folderOptions.length > 0 && (
            <span className="relative inline-flex items-center justify-center w-5 h-5 shrink-0 rounded hover:bg-slate-200">
              <label className="sr-only" htmlFor={`move-list-${list.id}`}>Move {list.name} to a Folder</label>
              <select
                id={`move-list-${list.id}`}
                value={list.folder_id ?? ''}
                onChange={e => p.sidebar.onAction({ type: 'moveList', list, folderId: e.target.value || null })}
                title={`Move ${list.name}`}
                className="appearance-none absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              >
                <option value="">Space root</option>
                {p.folderOptions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <FolderInput className="w-3 h-3 text-slate-500 pointer-events-none" aria-hidden="true" />
            </span>
          )}
          <button onClick={() => p.startRename('list', list.id, list.name)}
            aria-label={`Rename ${list.name}`} className="p-0.5 text-slate-500 hover:text-blue-600 cursor-pointer">
            <Pencil className="w-2.5 h-2.5" />
          </button>
          <button onClick={() => p.archiveList(list)}
            aria-label={list.archived_at ? `Restore ${list.name}` : `Archive ${list.name}`}
            className="p-0.5 text-slate-500 hover:text-amber-600 cursor-pointer">
            {list.archived_at ? <RotateCcw className="w-2.5 h-2.5" /> : <Archive className="w-2.5 h-2.5" />}
          </button>
        </span>
      )}
    </li>
  );
};
