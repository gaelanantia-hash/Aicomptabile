// Building blocks shared by the screens of the three Sage 100 modules: panels, badges, line editor, entries table.
import type { ReactNode } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import { docTotals, tiersName, type Entry } from '../sageData'
import { type DraftLine, type ViewProps, emptyLine, num, parseLines, sum } from './helpers'

export function Panel({ title, subtitle, action, className = '', children }: { title: string; subtitle?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`panel sg-panel ${className}`}>
      <div className="panel-heading"><div><div className="panel-title">{title}</div>{subtitle && <div className="panel-subtitle">{subtitle}</div>}</div>{action}</div>
      {children}
    </section>
  )
}

export function Stat({ label, value }: { label: string; value: string }) {
  return <div className="sg-stat"><span>{label}</span><strong>{value}</strong></div>
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn'; children: ReactNode }) {
  return <span className={`sg-badge ${tone}`}>{children}</span>
}

export function Chips<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return <div className="sg-chips sg-noprint">{options.map(([id, label]) => <button className={value === id ? 'active' : ''} key={id} type="button" onClick={() => onChange(id)}>{label}</button>)}</div>
}

export function SaveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <div className="sg-actions"><button className="primary-button" type="button" disabled={disabled} onClick={onClick}><Check size={14} />{label}</button></div>
}

export function LinesEditor({ ctx, lines, onChange, atCost }: ViewProps & { lines: DraftLine[]; onChange: (lines: DraftLine[]) => void; atCost?: boolean }) {
  const { tr, store, money } = ctx
  const update = (index: number, patch: Partial<DraftLine>) => onChange(lines.map((line, position) => position === index ? { ...line, ...patch } : line))
  const totals = docTotals(parseLines(store, lines), store.currency)
  return (
    <div className="sg-lines">
      <div className="sg-line sg-line-head"><span>{tr('Article', 'Item')}</span><span>{tr('Qté', 'Qty')}</span><span>{tr('PU HT', 'Unit price')}</span><span>{tr('Total HT', 'Net total')}</span><span /></div>
      {lines.map((line, index) => (
        <div className="sg-line" key={index}>
          <select aria-label={tr('Article', 'Item')} value={line.ref} onChange={(event) => {
            const article = store.articles.find((item) => item.ref === event.target.value)
            update(index, { ref: event.target.value, price: article ? String(atCost ? article.cost : article.price) : '' })
          }}>
            <option value="">—</option>
            {store.articles.map((article) => <option key={article.ref} value={article.ref}>{article.ref} · {article.name}</option>)}
          </select>
          <input aria-label={tr('Quantité', 'Quantity')} type="number" min="1" step="1" value={line.qty} onChange={(event) => update(index, { qty: event.target.value })} />
          <input aria-label={tr('Prix unitaire HT', 'Unit price')} type="number" min="0" step="0.01" value={line.price} onChange={(event) => update(index, { price: event.target.value })} />
          <span className="sg-line-total">{money(num(line.qty) * num(line.price))}</span>
          <button className="reject-button" type="button" aria-label={tr('Supprimer la ligne', 'Remove line')} disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, position) => position !== index))}><Trash2 size={13} /></button>
        </div>
      ))}
      <div className="sg-lines-footer">
        <button className="upload-button" type="button" onClick={() => onChange([...lines, emptyLine])}><Plus size={13} />{tr('Ajouter une ligne', 'Add line')}</button>
        <span>{tr('HT', 'Net')} <strong>{money(totals.ht)}</strong></span><span>{tr('TVA', 'VAT')} <strong>{money(totals.vat)}</strong></span><span>{tr('TTC', 'Gross')} <strong>{money(totals.ttc)}</strong></span>
      </div>
    </div>
  )
}

export function EntriesTable({ ctx, entries, action, renderLabel }: ViewProps & { entries: Entry[]; action?: (entry: Entry) => ReactNode; renderLabel?: (entry: Entry) => ReactNode }) {
  const { tr, store, money, day } = ctx
  if (!entries.length) return <div className="empty-state">{tr('Aucune écriture.', 'No entries.')}</div>
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  return (
    <div className="table-scroll">
      <table className="data-table sg-table">
        <thead><tr><th>DATE</th><th>{tr('JAL', 'JNL')}</th><th>{tr('PIÈCE', 'DOC')}</th><th>{tr('COMPTE', 'ACCOUNT')}</th><th>{tr('TIERS', 'PARTY')}</th><th>{tr('LIBELLÉ', 'LABEL')}</th><th className="sg-num">{tr('DÉBIT', 'DEBIT')}</th><th className="sg-num">{tr('CRÉDIT', 'CREDIT')}</th><th>{tr('LET.', 'MATCH')}</th>{action && <th />}</tr></thead>
        <tbody>
          {sorted.map((entry) => (
            <tr key={entry.id}>
              <td className="date-cell">{day(entry.date)}</td><td>{entry.journal}</td><td><strong className="invoice-id">{entry.piece}</strong></td><td>{entry.account}</td>
              <td>{tiersName(store, entry.tiers)}</td><td>{renderLabel ? renderLabel(entry) : entry.label}</td>
              <td className="sg-num">{entry.debit ? money(entry.debit) : ''}</td><td className="sg-num">{entry.credit ? money(entry.credit) : ''}</td>
              <td>{entry.letter && <Badge tone="good">{entry.letter}</Badge>}</td>{action && <td>{action(entry)}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={6}>{tr('Totaux', 'Totals')}</td><td className="sg-num">{money(sum(entries.map((entry) => entry.debit)))}</td><td className="sg-num">{money(sum(entries.map((entry) => entry.credit)))}</td><td colSpan={action ? 2 : 1} /></tr></tfoot>
      </table>
    </div>
  )
}
