import React, { useState } from 'react';
import {
  Plus, Folder, List as ListIcon, Archive, RotateCcw, Pencil, Check, X, Loader2, ChevronDown
} from 'lucide-react';
import { TaskApi, TaskSpace, TaskList } from '../../tasks/apiClient';

interface Props {
  api: TaskApi;
  spaces: TaskSpace[];
  lists: TaskList[];
  selectedSpaceId: string | null;
  selectedListId: string | null;
  canManage: boolean;
  showArchived: boolean;
  onSelectSpace: (id: string) => void;
  onSelectList: (id: string | null) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}

/**
 * Space -> List navigation with inline management.
 *
 * Space creation calls the backend's atomic RPC, which creates the default "General" List
 * and the default statuses in one transaction — the UI never creates them separately, so a
 * half-built Space cannot exist.
 *
 * Archival is always soft and always confirmed; nothing here deletes permanently.
 */
export default function TaskSidebar(p: Props) {
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [creatingListFor, setCreatingListFor] = useState<string | null>(null);
  const [newListName, setNewListName] = useState('');
  const [renaming, setRenaming] = useState<{ kind: 'space' | 'list'; id: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);

  const visibleSpaces = p.spaces
    .filter(s => p.showArchived || !s.archived_at)
    .sort((a, b) => a.position - b.position);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); p.onChanged(); }
    catch (err: any) { p.onError(err?.message ?? 'That action could not be completed.'); }
    finally { setBusy(false); }
  };

  const createSpace = async () => {
    const name = newSpaceName.trim();
    if (!name) return;
    await run(async () => {
      const r = await p.api.createSpace(name);
      setNewSpaceName(''); setCreatingSpace(false);
      p.onSelectSpace(r.spaceId);
      p.onSelectList(r.defaultListId);
    });
  };

  const createList = async (spaceId: string) => {
    const name = newListName.trim();
    if (!name) return;
    await run(async () => {
      const l = await p.api.createList({ spaceId, name });
      setNewListName(''); setCreatingListFor(null);
      p.onSelectList(l.id);
    });
  };

  const commitRename = async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) { setRenaming(null); return; }
    const entity = renaming.kind === 'space'
      ? p.spaces.find(s => s.id === renaming.id)
      : p.lists.find(l => l.id === renaming.id);
    if (!entity) { setRenaming(null); return; }
    await run(async () => {
      if (renaming.kind === 'space') await p.api.updateSpace(renaming.id, { name, version: entity.version });
      else await p.api.updateList(renaming.id, { name, version: entity.version });
      setRenaming(null);
    });
  };

  const toggleArchiveSpace = async (s: TaskSpace) => {
    const archiving = !s.archived_at;
    if (archiving && !window.confirm(
      `Archive the Space “${s.name}”? Its Lists and tasks stay intact and it can be restored.`
    )) return;
    await run(() => p.api.updateSpace(s.id, { archived: archiving, version: s.version }));
  };

  const toggleArchiveList = async (l: TaskList) => {
    const archiving = !l.archived_at;
    if (archiving && !window.confirm(
      `Archive the List “${l.name}”? Its tasks stay intact and it can be restored.`
    )) return;
    await run(() => p.api.updateList(l.id, { archived: archiving, version: l.version }));
  };

  const move = async (kind: 'space' | 'list', item: TaskSpace | TaskList, dir: -1 | 1) => {
    const siblings = kind === 'space'
      ? visibleSpaces
      : p.lists.filter(l => l.space_id === (item as TaskList).space_id && !l.archived_at)
               .sort((a, b) => a.position - b.position);
    const i = siblings.findIndex(x => x.id === item.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= siblings.length) return;
    // Take the neighbour's slot by stepping just past it — avoids renumbering the whole list.
    const target = siblings[j].position + (dir === 1 ? 1 : -1);
    await run(() => kind === 'space'
      ? p.api.updateSpace(item.id, { position: target, version: item.version })
      : p.api.updateList(item.id, { position: target, version: item.version }));
  };

  return (
    <nav aria-label="Spaces and Lists" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Spaces</h2>
        {p.canManage && (
          <button
            onClick={() => setCreatingSpace(v => !v)}
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
            id="new-space-name" autoFocus value={newSpaceName} maxLength={120}
            onChange={e => setNewSpaceName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createSpace(); if (e.key === 'Escape') setCreatingSpace(false); }}
            placeholder="Space name"
            className="flex-1 min-w-0 text-[11px] p-1.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-semibold"
          />
          <button onClick={createSpace} disabled={busy} aria-label="Save Space"
            className="p-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
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
          const spaceLists = p.lists
            .filter(l => l.space_id === space.id && (p.showArchived || !l.archived_at))
            .sort((a, b) => a.position - b.position);
          const open = p.selectedSpaceId === space.id;
          return (
            <li key={space.id} className={space.archived_at ? 'opacity-60' : ''}>
              <div className="flex items-center gap-1 group">
                {renaming?.kind === 'space' && renaming.id === space.id ? (
                  <span className="flex gap-1 flex-1 min-w-0">
                    <input
                      autoFocus value={renameValue} maxLength={120}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
                      className="flex-1 min-w-0 text-[11px] p-1 bg-white border border-blue-300 rounded outline-none font-semibold"
                      aria-label={`Rename Space ${space.name}`}
                    />
                    <button onClick={commitRename} aria-label="Save name" className="p-1 text-emerald-600 cursor-pointer">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setRenaming(null)} aria-label="Cancel rename" className="p-1 text-slate-500 cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ) : (
                  <>
                    <button
                      onClick={() => { p.onSelectSpace(space.id); p.onSelectList(null); }}
                      aria-expanded={open}
                      className={`flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-bold text-left transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none ${
                        open ? 'bg-blue-50 text-blue-800' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <ChevronDown
                        className={`w-3 h-3 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
                        aria-hidden="true"
                      />
                      <Folder className="w-3.5 h-3.5 shrink-0 text-blue-500" aria-hidden="true" />
                      <span className="truncate">{space.name}</span>
                      {space.archived_at && <span className="text-[8px] uppercase font-black text-slate-500">Arch</span>}
                    </button>
                    {p.canManage && (
                      <span className="hidden group-hover:flex group-focus-within:flex items-center gap-0.5 shrink-0">
                        <button onClick={() => move('space', space, -1)} aria-label={`Move ${space.name} up`}
                          className="p-0.5 text-slate-500 hover:text-slate-600 cursor-pointer text-[9px] font-black">▲</button>
                        <button onClick={() => move('space', space, 1)} aria-label={`Move ${space.name} down`}
                          className="p-0.5 text-slate-500 hover:text-slate-600 cursor-pointer text-[9px] font-black">▼</button>
                        <button onClick={() => { setRenaming({ kind: 'space', id: space.id }); setRenameValue(space.name); }}
                          aria-label={`Rename ${space.name}`} className="p-0.5 text-slate-500 hover:text-blue-600 cursor-pointer">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button onClick={() => toggleArchiveSpace(space)}
                          aria-label={space.archived_at ? `Restore ${space.name}` : `Archive ${space.name}`}
                          className="p-0.5 text-slate-500 hover:text-amber-600 cursor-pointer">
                          {space.archived_at ? <RotateCcw className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
                        </button>
                      </span>
                    )}
                  </>
                )}
              </div>

              {open && (
                <ul className="ml-4 mt-1 space-y-0.5 border-l border-slate-200 pl-2">
                  {spaceLists.map(list => (
                    <li key={list.id} className={`flex items-center gap-1 group/list ${list.archived_at ? 'opacity-60' : ''}`}>
                      {renaming?.kind === 'list' && renaming.id === list.id ? (
                        <span className="flex gap-1 flex-1 min-w-0">
                          <input
                            autoFocus value={renameValue} maxLength={120}
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
                            className="flex-1 min-w-0 text-[11px] p-1 bg-white border border-blue-300 rounded outline-none"
                            aria-label={`Rename List ${list.name}`}
                          />
                          <button onClick={commitRename} aria-label="Save name" className="p-1 text-emerald-600 cursor-pointer">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => p.onSelectList(list.id)}
                            aria-current={p.selectedListId === list.id ? 'true' : undefined}
                            className={`flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold text-left transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none ${
                              p.selectedListId === list.id ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                            }`}
                          >
                            <ListIcon className="w-3 h-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{list.name}</span>
                            {list.is_default && (
                              <span className="text-[8px] uppercase font-black opacity-60 shrink-0">def</span>
                            )}
                          </button>
                          {p.canManage && (
                            <span className="hidden group-hover/list:flex group-focus-within/list:flex items-center gap-0.5 shrink-0">
                              <button onClick={() => { setRenaming({ kind: 'list', id: list.id }); setRenameValue(list.name); }}
                                aria-label={`Rename ${list.name}`} className="p-0.5 text-slate-500 hover:text-blue-600 cursor-pointer">
                                <Pencil className="w-2.5 h-2.5" />
                              </button>
                              <button onClick={() => toggleArchiveList(list)}
                                aria-label={list.archived_at ? `Restore ${list.name}` : `Archive ${list.name}`}
                                className="p-0.5 text-slate-500 hover:text-amber-600 cursor-pointer">
                                {list.archived_at ? <RotateCcw className="w-2.5 h-2.5" /> : <Archive className="w-2.5 h-2.5" />}
                              </button>
                            </span>
                          )}
                        </>
                      )}
                    </li>
                  ))}

                  {p.canManage && (
                    creatingListFor === space.id ? (
                      <li className="flex gap-1">
                        <label className="sr-only" htmlFor={`new-list-${space.id}`}>New List name</label>
                        <input
                          id={`new-list-${space.id}`} autoFocus value={newListName} maxLength={120}
                          onChange={e => setNewListName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') createList(space.id); if (e.key === 'Escape') setCreatingListFor(null); }}
                          placeholder="List name"
                          className="flex-1 min-w-0 text-[11px] p-1 bg-white border border-slate-200 rounded outline-none focus:border-blue-500"
                        />
                        <button onClick={() => createList(space.id)} disabled={busy} aria-label="Save List"
                          className="p-1 rounded bg-blue-600 text-white cursor-pointer disabled:opacity-50">
                          <Check className="w-3 h-3" />
                        </button>
                      </li>
                    ) : (
                      <li>
                        <button
                          onClick={() => { setCreatingListFor(space.id); setNewListName(''); }}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-slate-500 hover:text-blue-700 rounded-lg focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none cursor-pointer"
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
      </ul>
    </nav>
  );
}
