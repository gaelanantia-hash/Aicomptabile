import { useState, type Dispatch, type SetStateAction } from 'react'
import { ChevronRight } from 'lucide-react'
import { sageModules, type ModuleId, type Store } from './sageData'
import { type Ctx, type Locale, type ViewProps, period } from './sage/helpers'
import { ArticlesView, ClientsView, FabricationView, InterrogationView, InventoryView, PurchasesView, SalesDocForm, SalesDocsView } from './sage/commercial'
import { CounterView, GroupView } from './sage/caisse'
import { AccountsView, AdvancedView, BankOperationView, EntriesView, FreeEntryView, GuidedPieceView, JournalsView, PeriodicView, SearchView, TiersView } from './sage/compta'
import { ReportsView } from './sage/reports'
import { AssetsView, ClosingView } from './sage/closing'
import './SageModules.css'

const commercialGuidance: Record<string, { fr: string; en: string }> = {
  'gc.clients': {
    fr: 'Créer et mettre à jour les fiches clients : coordonnées et informations utiles pour les documents de vente.',
    en: 'Create and update customer records, including contact details used on sales documents.',
  },
  'gc.documents': {
    fr: 'Consulter les devis, commandes, livraisons et factures. Transformer un document en étape suivante ; le stock sort à la livraison.',
    en: 'Review quotes, orders, deliveries and invoices. Move a document to the next step; stock leaves when goods are delivered.',
  },
  'gc.saisie': {
    fr: 'Créer un document de vente en choisissant son type, son client et les articles. Utilisez cette entrée pour les documents autres qu’une commande directe.',
    en: 'Create a sales document by choosing its type, customer and items. Use this for documents other than a direct customer order.',
  },
  'gc.commande': {
    fr: 'Enregistrer directement une commande client avec les articles et quantités demandés ; elle ne sort pas encore le stock.',
    en: 'Record a customer order and its requested items and quantities; stock is not reduced yet.',
  },
  'gc.interrogation': {
    fr: 'Rechercher un client ou un article et consulter son activité, les quantités vendues et le stock disponible.',
    en: 'Find a customer or item and review its activity, quantities sold and available stock.',
  },
  'gc.achats': {
    fr: 'Saisir les achats avec articles et quantités. La facture fournisseur réceptionnée augmente le stock et comptabilise l’achat.',
    en: 'Record purchases with items and quantities. Receiving a supplier invoice increases stock and posts the purchase.',
  },
  'gc.articles': {
    fr: 'Créer et modifier les articles, leur prix d’achat, leur prix de vente, leur TVA et consulter leur stock.',
    en: 'Create and update items, purchase and sales prices, VAT, and view current stock.',
  },
  'gc.fabrications': {
    fr: 'Définir les composants nécessaires à un produit puis suivre sa fabrication : les composants sortent et le produit fini entre en stock.',
    en: 'Define the components needed for a product and record production: components leave stock and finished goods are added.',
  },
  'gc.inventaire': {
    fr: 'Saisir les quantités réellement comptées et valider les écarts pour corriger le stock théorique.',
    en: 'Enter physically counted quantities and validate differences to correct the recorded stock.',
  },
}

export function SageModules({ module, locale, store, setStore, money, notify, audit, onModule, savePdf, initialActivity, admin = false }: {
  module: ModuleId
  admin?: boolean
  locale: Locale
  store: Store
  setStore: Dispatch<SetStateAction<Store>>
  money: (amount: number) => string
  notify: (message: string) => void
  audit: (action: string, record: string) => void
  onModule: (module: ModuleId) => void
  savePdf?: (name: string) => void
  /** Activity to open first, when arriving from a link elsewhere in the app. */
  initialActivity?: string
}) {
  const [activeByModule, setActiveByModule] = useState<Record<ModuleId, string>>({ commercial: 'gc.clients', caisse: 'sc.clients', compta: 'cp.compte', ...(initialActivity ? { [module]: initialActivity } : {}) })
  const tr = (fr: string, en: string) => locale === 'fr' ? fr : en
  const current = sageModules.find((item) => item.id === module)!
  const active = activeByModule[module]
  const go = (id: string) => setActiveByModule((value) => ({ ...value, [module]: id }))
  const ctx: Ctx = {
    tr, store, money, notify, audit, savePdf, admin,
    apply: (next) => setStore(next),
    day: (date) => {
      const [year, month, day] = date.split('-').map(Number)
      return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(year, month - 1, day))
    },
    closed: (date) => {
      if (!store.closedPeriods.includes(period(date))) return false
      notify(tr(`La période ${period(date)} est clôturée.`, `Period ${period(date)} is closed.`))
      return true
    },
  }

  return (
    <div className="sg-module">
      <div className="sg-flow sg-noprint">
        <span>{tr('Flux des données', 'Data flow')}</span>
        {sageModules.map((item, index) => (
          <span className="sg-flow-step" key={item.id}>
            {index > 0 && <ChevronRight size={13} />}
            <button className={item.id === module ? 'active' : ''} type="button" onClick={() => onModule(item.id)}>{tr(item.fr, item.en)}</button>
          </span>
        ))}
        <code>{current.sage}</code>
      </div>

      {module === 'caisse' && store.groups.length > 0 && <div className="sg-shortcuts sg-noprint">
        {store.groups.map((group) => (
          <div key={group.name}>
            <strong>{group.name}</strong>
            {group.activities.map((id) => {
              const activity = current.groups.flatMap((item) => item.activities).find((item) => item.id === id)
              return activity && <button key={id} type="button" onClick={() => go(id)}>{activity.sage}</button>
            })}
          </div>
        ))}
      </div>}

      <div className="sg-layout">
        <nav className="panel sg-menu sg-noprint" aria-label={current.sage}>
          {current.groups.map((group) => (
            <div className="sg-menu-group" key={group.sage}>
              <div className="sg-menu-caption">{tr(group.fr, group.en)}<code>{group.sage}</code></div>
              {group.activities.map((activity) => (
                <button className={`sg-menu-item ${active === activity.id ? 'active' : ''}`} key={activity.id} type="button" onClick={() => go(activity.id)}>
                  <span>{tr(activity.fr, activity.en)}{activity.optional && <em>{tr('facultatif', 'optional')}</em>}</span>
                  <code>{activity.sage}</code>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sg-work">
          {module === 'commercial' && commercialGuidance[active] && <div className="sg-guidance" role="note">
            <strong>{tr('À quoi sert cet onglet ?', 'What this tab is for')}</strong>
            <span>{tr(commercialGuidance[active].fr, commercialGuidance[active].en)}</span>
          </div>}
          <ActivityView key={active} id={active} ctx={ctx} />
        </div>
      </div>
    </div>
  )
}

export function ActivityView({ id, ctx }: ViewProps & { id: string }) {
  switch (id) {
    case 'gc.clients': return <ClientsView ctx={ctx} origin="commercial" />
    case 'gc.documents': return <SalesDocsView ctx={ctx} origin="commercial" />
    case 'gc.saisie': return <SalesDocForm ctx={ctx} origin="commercial" />
    case 'gc.commande': return <SalesDocForm ctx={ctx} origin="commercial" fixedType="commande" />
    case 'gc.interrogation': return <InterrogationView ctx={ctx} />
    case 'gc.achats': return <PurchasesView ctx={ctx} />
    case 'gc.articles': return <ArticlesView ctx={ctx} editable />
    case 'gc.fabrications': return <FabricationView ctx={ctx} />
    case 'gc.inventaire': return <InventoryView ctx={ctx} />
    case 'sc.clients': return <ClientsView ctx={ctx} origin="caisse" />
    case 'sc.documents': return <SalesDocsView ctx={ctx} origin="caisse" />
    case 'sc.saisie': return <SalesDocForm ctx={ctx} origin="caisse" />
    case 'sc.commande': return <SalesDocForm ctx={ctx} origin="caisse" fixedType="commande" />
    case 'sc.comptoir': return <CounterView ctx={ctx} />
    case 'sc.stocks': return <ArticlesView ctx={ctx} />
    case 'sc.groupe': return <GroupView ctx={ctx} />
    case 'cp.compte': return <AccountsView ctx={ctx} />
    case 'cp.journaux': return <JournalsView ctx={ctx} />
    case 'cp.piece': return <GuidedPieceView ctx={ctx} />
    case 'cp.operations': return <BankOperationView ctx={ctx} />
    case 'cp.ecritures': return <FreeEntryView ctx={ctx} />
    case 'cp.visualisation': return <EntriesView ctx={ctx} />
    case 'cp.recherche': return <SearchView ctx={ctx} />
    case 'cp.tiers': return <TiersView ctx={ctx} />
    case 'cp.avancees': return <AdvancedView ctx={ctx} />
    case 'cp.periodiques': return <PeriodicView ctx={ctx} />
    case 'cp.etats': return <ReportsView ctx={ctx} />
    case 'cp.immobilisations': return <AssetsView ctx={ctx} />
    case 'cp.cloture': return <ClosingView ctx={ctx} />
    default: return null
  }
}
