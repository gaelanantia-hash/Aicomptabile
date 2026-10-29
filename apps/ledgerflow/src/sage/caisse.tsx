// Sage 100 Saisie de caisse décentralisée: counter sales and custom command groups.
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { docTotals, isoDate, sageModules, saveSalesDoc, type Payment } from '../sageData'
import { type DraftLine, type ViewProps, emptyLine, parseLines, stockAvailable, sum } from './helpers'
import { LinesEditor, Panel, SaveButton, Stat } from './ui'

export function CounterView({ ctx }: ViewProps) {
  const { tr, store, money } = ctx
  const today = isoDate()
  const [lines, setLines] = useState<DraftLine[]>([emptyLine])
  const [payment, setPayment] = useState<Payment>('cash')
  const [client, setClient] = useState('')
  const tickets = store.salesDocs.filter((doc) => doc.type === 'ticket' && doc.date === today)
  const total = (mode?: Payment) => sum(tickets.filter((doc) => !mode || doc.payment === mode).map((doc) => docTotals(doc.lines, store.currency).ttc))

  function cashIn() {
    const parsed = parseLines(store, lines)
    if (!parsed.length) {
      ctx.notify(tr('Ajoutez au moins un article.', 'Add at least one item.'))
      return
    }
    if (ctx.closed(today) || !stockAvailable(ctx, parsed)) return
    const next = saveSalesDoc(store, { type: 'ticket', client, date: today, lines: parsed, origin: 'caisse', payment })
    const saved = next.salesDocs[next.salesDocs.length - 1]
    ctx.apply(next)
    ctx.audit('Recorded counter sale', `${saved.id} · ${money(docTotals(parsed, store.currency).ttc)}`)
    ctx.notify(tr(`Ticket ${saved.id} encaissé et comptabilisé dans le journal de caisse.`, `Ticket ${saved.id} cashed in and posted to the cash journal.`))
    setLines([emptyLine])
    setClient('')
  }

  return (
    <>
      <Panel title={tr('Vente comptoir', 'Counter sale')} subtitle={tr('L’encaissement sort le stock et alimente le journal de caisse', 'Cashing in moves stock and feeds the cash journal')}>
        <div className="sg-form">
          <label>{tr('Mode de règlement', 'Payment method')}<select value={payment} onChange={(event) => setPayment(event.target.value as Payment)}><option value="cash">{tr('Espèces', 'Cash')}</option><option value="card">{tr('Carte bancaire', 'Card')}</option></select></label>
          <label>{tr('Client (facultatif)', 'Customer (optional)')}<select value={client} onChange={(event) => setClient(event.target.value)}>
            <option value="">{tr('Client comptoir', 'Walk-in customer')}</option>
            {store.clients.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
          </select></label>
        </div>
        <LinesEditor ctx={ctx} lines={lines} onChange={setLines} />
        <SaveButton label={tr('Encaisser', 'Cash in')} onClick={cashIn} />
      </Panel>
      <Panel title={tr('Ventes de la journée', 'Today’s sales')} subtitle={ctx.day(today)}>
        <div className="sg-stats">
          <Stat label="Tickets" value={String(tickets.length)} />
          <Stat label={tr('Total TTC', 'Gross total')} value={money(total())} />
          <Stat label={tr('Espèces', 'Cash')} value={money(total('cash'))} />
          <Stat label={tr('Carte bancaire', 'Card')} value={money(total('card'))} />
        </div>
        {tickets.length > 0 && <div className="sg-list">
          {tickets.map((doc) => (
            <div key={doc.id}><strong>{doc.id} · {money(docTotals(doc.lines, store.currency).ttc)} · {doc.payment === 'card' ? tr('Carte', 'Card') : tr('Espèces', 'Cash')}</strong><span>{doc.lines.map((line) => `${line.qty} × ${line.ref}`).join(', ')}</span></div>
          ))}
        </div>}
      </Panel>
    </>
  )
}

export function GroupView({ ctx }: ViewProps) {
  const { tr, store } = ctx
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const choices = sageModules.find((item) => item.id === 'caisse')!.groups.flatMap((group) => group.activities).filter((activity) => activity.id !== 'sc.groupe')

  function create() {
    if (!name.trim() || !selected.length || store.groups.some((group) => group.name === name.trim())) {
      ctx.notify(tr('Donnez un nom unique au groupe et choisissez au moins une commande.', 'Give the group a unique name and choose at least one command.'))
      return
    }
    ctx.apply({ ...store, groups: [...store.groups, { name: name.trim(), activities: selected }] })
    ctx.audit('Created command group', name.trim())
    ctx.notify(tr('Groupe ajouté en haut du module de caisse.', 'Group added at the top of the point-of-sale module.'))
    setName('')
    setSelected([])
  }

  return (
    <Panel title={tr('Nouveau groupe de commandes', 'New command group')} subtitle={tr('Facultatif : des raccourcis vers les commandes les plus utilisées au point de vente', 'Optional: shortcuts to the commands used most at the point of sale')}>
      <div className="sg-form"><label>{tr('Nom du groupe', 'Group name')}<input value={name} onChange={(event) => setName(event.target.value)} /></label></div>
      <div className="sg-checks">
        {choices.map((activity) => (
          <label key={activity.id}>
            <input type="checkbox" checked={selected.includes(activity.id)} onChange={() => setSelected(selected.includes(activity.id) ? selected.filter((id) => id !== activity.id) : [...selected, activity.id])} />
            {tr(activity.fr, activity.en)}<code>{activity.sage}</code>
          </label>
        ))}
      </div>
      <SaveButton label={tr('Créer le groupe', 'Create group')} onClick={create} />
      {store.groups.length > 0 && <div className="sg-list">
        {store.groups.map((group) => (
          <div className="sg-list-row" key={group.name}>
            <span><strong>{group.name}</strong><span>{group.activities.map((id) => choices.find((activity) => activity.id === id)?.sage).join(' · ')}</span></span>
            <button className="reject-button" type="button" aria-label={`${tr('Supprimer', 'Delete')} ${group.name}`} onClick={() => ctx.apply({ ...store, groups: store.groups.filter((item) => item.name !== group.name) })}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>}
    </Panel>
  )
}
