/** The two small pieces every list on the outreach workbench opens and closes with. */

export function Lead({ children }: { children: React.ReactNode }) {
  return <div className="text-muted mb-3 max-w-[68ch] text-sm">{children}</div>
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="note note-info max-w-[68ch]">{children}</div>
}
