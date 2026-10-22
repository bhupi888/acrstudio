import { Search, X } from 'lucide-react'

export type AgreementFilter = 'all' | 'client' | 'provider' | 'active' | 'completed' | 'cancelled' | 'unfunded'

const FILTERS: { id: AgreementFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'client', label: 'Client' },
  { id: 'provider', label: 'Provider' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'unfunded', label: 'Unfunded' },
  { id: 'cancelled', label: 'Cancelled' },
]

interface Props {
  search: string
  onSearch: (v: string) => void
  filter: AgreementFilter
  onFilter: (f: AgreementFilter) => void
  inputRef?: React.RefObject<HTMLInputElement>
}

export default function FilterBar({ search, onSearch, filter, onFilter, inputRef }: Props) {
  return (
    <div className="mb-4 space-y-2">
      {/* search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--subtle)' }} />
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by ID or address… (/)"
          className="w-full rounded-xl py-2.5 pl-9 pr-9 text-sm outline-none"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink)' }}
        />
        {search && (
          <button
            onClick={() => onSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            <X className="size-3.5" style={{ color: 'var(--subtle)' }} />
          </button>
        )}
      </div>

      {/* filter chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => onFilter(f.id)}
            className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-all"
            style={
              filter === f.id
                ? { background: 'var(--accent)', color: 'white' }
                : { background: 'rgba(255,255,255,0.80)', color: 'var(--ink-2)', border: '1px solid var(--border)' }
            }
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  )
}
