/** Hairline borders, uppercase font-tele headers, generous row height. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  cell,
}: {
  columns: { key: string; label: string; className?: string }[]
  rows: readonly T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  cell: (row: T, columnKey: string) => React.ReactNode
}) {
  return (
    <div className="overflow-x-auto border border-rule">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-rule">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-4 py-2.5 font-tele text-[11px] font-bold tracking-widest text-faint uppercase ${c.className ?? ''}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`group h-14 border-b border-rule last:border-b-0 ${onRowClick ? 'cursor-pointer hover:bg-paper-2' : ''}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`px-4 font-tele text-[0.82rem] text-ink ${c.className ?? ''}`}>
                  {cell(row, c.key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
