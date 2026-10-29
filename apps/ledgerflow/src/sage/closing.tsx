// SYSCOHADA fixed assets and year-end closing.
import { useState, type ReactNode } from 'react'
import { roundAmount, isoDate, type Store } from '../sageData'
import { incomeStatement } from '../syscohada'
import { assetAccounts, assignResult, closeYear, depreciationFor, depreciationSchedule, openingStock, postDepreciation, postInventory, registerAsset, stockValuation, yearEndStatus } from '../yearEnd'
import { type ViewProps, num } from './helpers'
import { Badge, Panel, SaveButton } from './ui'

/** Year-end closing is built on the SYSCOHADA accounts; companies on the French chart see a notice instead. */
function SyscohadaOnly({ ctx, title }: ViewProps & { title: string }) {
  return <Panel title={title}><p className="dk-note">{ctx.tr('Disponible pour les entreprises tenues selon le SYSCOHADA révisé.', 'Available for companies keeping their books under the revised SYSCOHADA.')}</p></Panel>
}

export function AssetsView({ ctx }: ViewProps) {
  const { tr, store, money, day } = ctx
  const [form, setForm] = useState({ label: '', account: assetAccounts[4].number, acquired: isoDate(), cost: '', years: '5', counterpart: '' })
  const year = Number(isoDate().slice(0, 4))
  if (store.chart !== 'syscohada') return <SyscohadaOnly ctx={ctx} title={tr('Immobilisations', 'Fixed assets')} />
  const accounts = [...assetAccounts, ...store.accounts.filter((account) => account.number.startsWith('2') && !account.number.startsWith('28') && !assetAccounts.some((item) => item.number === account.number))]
  const label = (number: string) => accounts.find((account) => account.number === number)?.label ?? number

  function save() {
    const cost = roundAmount(store, num(form.cost))
    const years = Math.round(num(form.years))
    if (!form.label.trim() || !form.acquired || cost <= 0 || years < 0 || years > 100) {
      ctx.notify(tr('Renseignez la désignation, la date, le coût et la durée d’utilisation.', 'Enter the description, date, cost and useful life.'))
      return
    }
    if (form.counterpart && ctx.closed(form.acquired)) return
    const next = registerAsset(store, { label: form.label.trim(), account: form.account, acquired: form.acquired, cost, years }, (form.counterpart || undefined) as 'bank' | 'cash' | 'supplier' | undefined)
    ctx.apply(next)
    ctx.audit('Registered fixed asset', `${next.assets.at(-1)!.id} · ${form.label.trim()}`)
    ctx.notify(tr(`Immobilisation ${next.assets.at(-1)!.id} enregistrée.`, `Fixed asset ${next.assets.at(-1)!.id} registered.`))
    setForm({ ...form, label: '', cost: '' })
  }

  return (
    <>
      <Panel title={tr('Nouvelle immobilisation', 'New fixed asset')} subtitle={tr('Amortissement linéaire, prorata temporis à partir de la date d’acquisition', 'Straight-line depreciation, pro rata from the acquisition date')}>
        <div className="sg-form">
          <label>{tr('Désignation', 'Description')}<input value={form.label} maxLength={120} onChange={(event) => setForm({ ...form, label: event.target.value })} /></label>
          <label>{tr('Compte', 'Account')}<select value={form.account} onChange={(event) => setForm({ ...form, account: event.target.value })}>{accounts.map((account) => <option key={account.number} value={account.number}>{account.number} · {account.label}</option>)}</select></label>
          <label>{tr('Date d’acquisition (mise en service)', 'Acquisition date (in service)')}<input type="date" value={form.acquired} onChange={(event) => setForm({ ...form, acquired: event.target.value })} /></label>
          <label>{tr('Coût d’acquisition HT', 'Cost, net of VAT')}<input type="number" min="0" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} /></label>
          <label>{tr('Durée d’utilisation (années)', 'Useful life (years)')}<input type="number" min="0" max="100" value={form.years} onChange={(event) => setForm({ ...form, years: event.target.value })} /><small>{tr('0 pour un bien non amortissable (terrain)', '0 for an asset that is not depreciated (land)')}</small></label>
          <label>{tr('Comptabiliser l’acquisition', 'Post the acquisition')}<select value={form.counterpart} onChange={(event) => setForm({ ...form, counterpart: event.target.value })}>
            <option value="">{tr('Non, déjà comptabilisée', 'No, already posted')}</option>
            <option value="bank">{tr('Payée par banque', 'Paid by bank')}</option>
            <option value="cash">{tr('Payée en espèces', 'Paid in cash')}</option>
            <option value="supplier">{tr('À payer au fournisseur d’immobilisations (4812)', 'Owed to the asset supplier (4812)')}</option>
          </select></label>
        </div>
        <SaveButton label={tr('Enregistrer l’immobilisation', 'Register the asset')} onClick={save} />
      </Panel>
      <Panel title={tr('Registre des immobilisations', 'Fixed asset register')} subtitle={`${store.assets.length} ${tr('bien(s)', 'asset(s)')} · ${tr('exercice', 'year')} ${year}`}>
        <div className="table-scroll">
          <table className="data-table sg-table">
            <thead><tr><th>N°</th><th>{tr('DÉSIGNATION', 'DESCRIPTION')}</th><th>{tr('COMPTE', 'ACCOUNT')}</th><th>{tr('ACQUISITION', 'ACQUIRED')}</th><th className="sg-num">{tr('COÛT', 'COST')}</th><th className="sg-num">{tr('DURÉE', 'LIFE')}</th><th className="sg-num">{tr(`DOTATION ${year}`, `${year} CHARGE`)}</th><th className="sg-num">{tr(`VNC 31/12/${year}`, `NET 31/12/${year}`)}</th></tr></thead>
            <tbody>{store.assets.map((asset) => {
              const schedule = depreciationSchedule(asset, store.currency)
              const accumulated = schedule.filter((line) => line.year <= year).at(-1)?.accumulated ?? 0
              return <tr key={asset.id}>
                <td><strong className="invoice-id">{asset.id}</strong></td><td>{asset.label}</td><td>{asset.account} · {label(asset.account)}</td><td className="date-cell">{day(asset.acquired)}</td>
                <td className="sg-num">{money(asset.cost)}</td><td className="sg-num">{asset.years ? `${asset.years} ${tr('ans', 'yrs')}` : '—'}</td>
                <td className="sg-num">{money(schedule.find((line) => line.year === year)?.amount ?? 0)}</td><td className="sg-num">{money(asset.cost - accumulated)}</td>
              </tr>
            })}</tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}

export function ClosingView({ ctx }: ViewProps) {
  const { tr, store, money } = ctx
  const years = Array.from(new Set([...store.entries.map((entry) => entry.date.slice(0, 4)), isoDate().slice(0, 4)])).sort()
  const [selected, setSelected] = useState(years.find((item) => !store.yearEnd[item]?.closing) ?? years.at(-1)!)
  const [stock, setStock] = useState(String(stockValuation(store)))
  const [assignDate, setAssignDate] = useState(isoDate())
  if (store.chart !== 'syscohada') return <SyscohadaOnly ctx={ctx} title={tr('Clôture de l’exercice', 'Year-end closing')} />
  const year = Number(selected)
  const status = yearEndStatus(store, year)
  const depreciation = depreciationFor(store, year)
  const decemberLocked = store.closedPeriods.includes(`${year}-12`) && !status.closing
  const result = status.closing ? status.result ?? 0 : incomeStatement(store, year).result

  /** Every year-end step is for administrators, and needs December still open. */
  function run(action: string, work: () => Store, done: string) {
    if (!ctx.admin) {
      ctx.notify(tr('Seul un administrateur peut lancer les travaux de clôture.', 'Only an administrator can run the year-end steps.'))
      return
    }
    if (decemberLocked) {
      ctx.notify(tr(`Décembre ${year} est verrouillé : rouvrez-le avant les travaux de clôture.`, `December ${year} is locked: reopen it before the year-end steps.`))
      return
    }
    const next = work()
    if (next === store) return
    ctx.apply(next)
    ctx.audit(action, String(year))
    ctx.notify(done)
  }

  const step = (number: number, title: string, done: string | undefined, children: ReactNode) => (
    <div className="sg-guidance" role="group" aria-label={title}>
      <strong>{number}. {title} {done ? <Badge tone="good">{done === '—' ? tr('Rien à comptabiliser', 'Nothing to post') : `${tr('Fait', 'Done')} · ${done}`}</Badge> : <Badge>{tr('À faire', 'To do')}</Badge>}</strong>
      {children}
    </div>
  )

  return (
    <Panel title={tr('Clôture de l’exercice', 'Year-end closing')} subtitle={tr('SYSCOHADA révisé · exercice du 1er janvier au 31 décembre', 'Revised SYSCOHADA · financial year from 1 January to 31 December')}>
      <div className="sg-form">
        <label>{tr('Exercice', 'Financial year')}<select value={selected} onChange={(event) => setSelected(event.target.value)}>{years.map((item) => <option key={item} value={item}>{item}{store.yearEnd[item]?.closing ? ` · ${tr('clôturé', 'closed')}` : ''}</option>)}</select></label>
      </div>
      {status.previousOpen && <p className="portal-error" role="alert">{tr(`L’exercice ${year - 1} n’est pas clôturé : clôturez-le d’abord.`, `Financial year ${year - 1} is not closed: close it first.`)}</p>}
      {!ctx.admin && <p className="dk-note">{tr('Les travaux de clôture sont réservés aux administrateurs.', 'Year-end steps are for administrators only.')}</p>}

      {step(1, tr('Dotations aux amortissements', 'Depreciation'), status.depreciation ?? (status.needsDepreciation ? undefined : '—'), <>
        <p>{depreciation.length ? tr(`${depreciation.length} immobilisation(s) · total ${money(depreciation.reduce((sum, line) => sum + line.amount, 0))}, au débit de 6812/6813 et au crédit des comptes 28.`, `${depreciation.length} asset(s) · total ${money(depreciation.reduce((sum, line) => sum + line.amount, 0))}, debited to 6812/6813 and credited to the 28 accounts.`) : tr('Aucune immobilisation à amortir sur cet exercice.', 'No asset to depreciate this year.')}</p>
        {!status.depreciation && depreciation.length > 0 && <SaveButton label={tr('Comptabiliser les dotations', 'Post the depreciation')} disabled={Boolean(status.closing)} onClick={() => run('Posted depreciation', () => postDepreciation(store, year), tr(`Dotations ${year} comptabilisées.`, `${year} depreciation posted.`))} />}
      </>)}

      {step(2, tr('Inventaire des marchandises', 'Stock count'), status.inventory, <>
        <p>{tr(`Stock en comptabilité (compte 31) : ${money(openingStock(store, year))}. Saisissez la valeur au coût du stock compté au 31/12/${year} ; la variation est passée au compte 6031.`, `Stock in the books (account 31): ${money(openingStock(store, year))}. Enter the cost value of the stock counted on 31/12/${year}; the variation goes to account 6031.`)}</p>
        {status.inventory ? <p>{tr('Stock final retenu', 'Closing stock')} : {money(status.closingStock ?? 0)}</p> : <>
          <div className="sg-form"><label>{tr('Stock final compté', 'Counted closing stock')}<input type="number" min="0" value={stock} onChange={(event) => setStock(event.target.value)} /><small>{tr(`Proposé : valeur actuelle des articles au coût (${money(stockValuation(store))})`, `Proposed: current value of the items at cost (${money(stockValuation(store))})`)}</small></label></div>
          <SaveButton label={tr('Comptabiliser l’inventaire', 'Post the stock count')} disabled={Boolean(status.closing)} onClick={() => run('Posted stock count', () => postInventory(store, year, roundAmount(store, num(stock))), tr(`Inventaire ${year} comptabilisé.`, `${year} stock count posted.`))} />
        </>}
      </>)}

      {step(3, tr('Détermination du résultat et clôture', 'Result and closing'), status.closing, <>
        <p>{status.closing
          ? tr(`Résultat net ${result >= 0 ? '(bénéfice, compte 131)' : '(perte, compte 139)'} : ${money(result)}. Les douze mois de ${year} sont verrouillés.`, `Net result ${result >= 0 ? '(profit, account 131)' : '(loss, account 139)'}: ${money(result)}. The twelve months of ${year} are locked.`)
          : tr(`Résultat provisoire : ${money(result)}. La clôture solde les classes 6, 7 et 8 dans le compte 13 et verrouille définitivement l’exercice.`, `Provisional result: ${money(result)}. Closing clears classes 6, 7 and 8 into account 13 and locks the year for good.`)}</p>
        {!status.closing && <SaveButton label={tr(`Clôturer l’exercice ${year}`, `Close financial year ${year}`)} disabled={status.previousOpen || (!status.depreciation && status.needsDepreciation) || !status.inventory} onClick={() => {
          if (!window.confirm(tr(`Clôturer définitivement l’exercice ${year} ? Plus aucune écriture ne pourra y être passée.`, `Close financial year ${year} for good? No further entry can be posted to it.`))) return
          run('Closed financial year', () => closeYear(store, year), tr(`Exercice ${year} clôturé.`, `Financial year ${year} closed.`))
        }} />}
      </>)}

      {step(4, tr('Affectation du résultat (report à nouveau)', 'Result assignment (retained earnings)'), status.assignment, <>
        <p>{tr('Après la décision de l’assemblée générale, le résultat passe du compte 13 au report à nouveau (121 si bénéfice, 129 si perte). Une affectation en réserves ou en dividendes se saisit en écriture manuelle.', 'After the shareholders’ decision, the result moves from account 13 to retained earnings (121 profit, 129 loss). Reserves or dividends are entered as a manual entry.')}</p>
        {status.closing && !status.assignment && <>
          <div className="sg-form"><label>{tr('Date de la décision', 'Decision date')}<input type="date" value={assignDate} min={`${year + 1}-01-01`} onChange={(event) => setAssignDate(event.target.value)} /></label></div>
          <SaveButton label={tr('Affecter en report à nouveau', 'Carry to retained earnings')} onClick={() => {
            if (!ctx.admin) {
              ctx.notify(tr('Seul un administrateur peut affecter le résultat.', 'Only an administrator can assign the result.'))
              return
            }
            if (assignDate <= `${year}-12-31` || ctx.closed(assignDate)) return
            const next = assignResult(store, year, assignDate)
            if (next === store) return
            ctx.apply(next)
            ctx.audit('Assigned result', `${year} · ${money(result)}`)
            ctx.notify(tr(`Résultat ${year} affecté en report à nouveau.`, `${year} result carried to retained earnings.`))
          }} />
        </>}
      </>)}
    </Panel>
  )
}
