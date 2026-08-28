import React from 'react';
import { ChevronRight } from 'lucide-react';

interface Props {
  spaceName?: string;
  folderName?: string | null;
  listName?: string;
}

/**
 * Space / [Folder] / List, shown above the task list so the current location in the
 * hierarchy is always legible — including on a fresh page load or after a deep-link/refresh
 * restoration, before the user has touched the sidebar at all.
 */
export default function HierarchyBreadcrumb(p: Props) {
  const parts = [p.spaceName, p.folderName, p.listName].filter(
    (x): x is string => typeof x === 'string' && x.length > 0
  );
  if (parts.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1 text-[11px] font-bold text-slate-700 flex-wrap min-w-0">
        {parts.map((part, i) => {
          const isLast = i === parts.length - 1;
          return (
            <li key={i} className="flex items-center gap-1 min-w-0">
              {i > 0 && <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />}
              <span
                className={`truncate max-w-[220px] ${isLast ? 'text-slate-900' : ''}`}
                aria-current={isLast ? 'page' : undefined}
              >
                {part}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
