'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import {
  addQuoteCustomLineItem,
  buildQuotePdf,
  buildShareableQuoteLink,
  createQuoteFromRecipes,
  createQuoteRevision,
  fetchQuoteAuditLog,
  fetchQuoteBuilderSnapshot,
  saveQuoteLineItems,
  sendQuoteToClient,
  setQuoteDiscountAndNote,
  setQuoteLockState,
} from '@/lib/actions/quotes'

type QuoteLine = {
  id: string
  description: string
  quantity: number
  unitCostSnapshot: number
  currentUnitCost: number
  hasPriceDelta: boolean
  lineType: 'inventory' | 'custom' | 'discount'
}

type Quote = {
  id: string
  title: string
  clientId: string | null
  status: 'draft' | 'sent' | 'approved' | 'revision_requested' | 'locked'
  note: string | null
  discountType: 'percent' | 'fixed' | null
  discountValue: number
  rootQuoteId: string | null
  revisionNumber: number
  lines: QuoteLine[]
}

type QuoteAuditEntry = {
  id: string
  actionType: string
  performedBy: string | null
  createdAt: string
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatSavedTime(value: Date | null) {
  if (!value) return 'Not saved yet'
  return `Saved · ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(value)}`
}

export default function QuotesPage() {
  const { addToast } = useToast()
  const [isLoading, setIsLoading] = useState(true)
  const [clients, setClients] = useState<Array<{ id: string; name: string; email: string | null }>>([])
  const [recipes, setRecipes] = useState<Array<{ id: string; name: string }>>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [activeQuoteId, setActiveQuoteId] = useState<string | null>(null)
  const [lineItems, setLineItems] = useState<QuoteLine[]>([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<string[]>([])
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [customDescription, setCustomDescription] = useState('')
  const [customQuantity, setCustomQuantity] = useState('1')
  const [customUnitPrice, setCustomUnitPrice] = useState('0')
  const [discountType, setDiscountType] = useState<'percent' | 'fixed' | ''>('')
  const [discountValue, setDiscountValue] = useState('0')
  const [note, setNote] = useState('')
  const [auditEntries, setAuditEntries] = useState<QuoteAuditEntry[]>([])
  const [shareLink, setShareLink] = useState<string | null>(null)

  const activeQuote = quotes.find((quote) => quote.id === activeQuoteId) ?? null
  const selectedClient = clients.find((client) => client.id === activeQuote?.clientId) ?? null

  const subtotal = useMemo(
    () => lineItems.reduce((sum, line) => sum + line.quantity * line.unitCostSnapshot, 0),
    [lineItems]
  )

  const discountAmount = useMemo(() => {
    const value = Number(discountValue)
    if (Number.isNaN(value) || value <= 0) return 0
    if (discountType === 'percent') return Math.min(subtotal, subtotal * (value / 100))
    if (discountType === 'fixed') return Math.min(subtotal, value)
    return 0
  }, [discountType, discountValue, subtotal])

  const total = Math.max(0, subtotal - discountAmount)

  const revisionHistory = useMemo(() => {
    if (!activeQuote) return []
    const rootId = activeQuote.rootQuoteId ?? activeQuote.id
    return quotes
      .filter((quote) => (quote.rootQuoteId ?? quote.id) === rootId)
      .sort((a, b) => b.revisionNumber - a.revisionNumber)
  }, [activeQuote, quotes])

  const applyQuoteToEditor = (quote: Quote | null) => {
    if (!quote) {
      setActiveQuoteId(null)
      setLineItems([])
      setDiscountType('')
      setDiscountValue('0')
      setNote('')
      return
    }

    setActiveQuoteId(quote.id)
    setLineItems(quote.lines)
    setDiscountType(quote.discountType ?? '')
    setDiscountValue(String(quote.discountValue ?? 0))
    setNote(quote.note ?? '')
    setDirty(false)
    setSavedAt(null)
    setShareLink(null)
  }

  const loadSnapshot = async (preferredQuoteId?: string) => {
    setIsLoading(true)
    const result = await fetchQuoteBuilderSnapshot()
    setIsLoading(false)

    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    const nextQuotes: Quote[] = result.data.quotes.map((quote) => ({
      id: quote.id,
      title: quote.title,
      clientId: quote.clientId,
      status: quote.status,
      note: quote.note,
      discountType: quote.discountType,
      discountValue: quote.discountValue,
      rootQuoteId: quote.rootQuoteId,
      revisionNumber: quote.revisionNumber,
      lines: quote.lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unitCostSnapshot: line.unitCostSnapshot,
        currentUnitCost: line.currentUnitCost,
        hasPriceDelta: line.hasPriceDelta,
        lineType: line.lineType,
      })),
    }))

    setClients(result.data.clients.map((client) => ({ id: client.id, name: client.name, email: client.email })))
    setRecipes(result.data.recipes)
    setQuotes(nextQuotes)

    const targetId = preferredQuoteId ?? activeQuoteId
    const target = nextQuotes.find((quote) => quote.id === targetId) ?? nextQuotes[0] ?? null
    applyQuoteToEditor(target)
  }

  useEffect(() => {
    void loadSnapshot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!activeQuoteId || !dirty || activeQuote?.status === 'locked') return

    const timer = setTimeout(async () => {
      setIsSaving(true)
      const result = await saveQuoteLineItems({
        quoteId: activeQuoteId,
        lines: lineItems.map((line) => ({ id: line.id, quantity: line.quantity })),
      })
      setIsSaving(false)

      if (!result.success) {
        addToast('error', result.error.message)
        return
      }

      setSavedAt(new Date())
      setDirty(false)
    }, 2000)

    return () => clearTimeout(timer)
  }, [activeQuote?.status, activeQuoteId, addToast, dirty, lineItems])

  useEffect(() => {
    if (!activeQuoteId) {
      setAuditEntries([])
      return
    }

    const loadAudit = async () => {
      const result = await fetchQuoteAuditLog({ quoteId: activeQuoteId })
      if (!result.success) {
        addToast('error', result.error.message)
        return
      }
      setAuditEntries(result.data.entries)
    }

    void loadAudit()
  }, [activeQuoteId, addToast])

  useEffect(() => {
    const baseTitle = 'Eventvico'
    document.title = dirty ? `• ${baseTitle}` : baseTitle
    return () => {
      document.title = baseTitle
    }
  }, [dirty])

  const createQuote = async () => {
    const result = await createQuoteFromRecipes({
      clientId: selectedClientId,
      recipeIds: selectedRecipeIds,
    })

    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    addToast('success', `Quote created with ${result.data.lineCount} line items`)
    setSelectedClientId('')
    setSelectedRecipeIds([])
    await loadSnapshot(result.data.quoteId)
  }

  const addCustomItem = async () => {
    if (!activeQuoteId) return
    const result = await addQuoteCustomLineItem({
      quoteId: activeQuoteId,
      description: customDescription,
      quantity: Number(customQuantity),
      unitPrice: Number(customUnitPrice),
    })

    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    addToast('success', 'Custom line item added')
    setCustomDescription('')
    setCustomQuantity('1')
    setCustomUnitPrice('0')
    await loadSnapshot(activeQuoteId)
  }

  const saveDiscountAndNote = async () => {
    if (!activeQuoteId) return
    const parsedType = discountType === '' ? null : discountType
    const result = await setQuoteDiscountAndNote({
      quoteId: activeQuoteId,
      discountType: parsedType,
      discountValue: Number(discountValue),
      note,
    })

    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    addToast('success', 'Quote notes and discount saved')
    setSavedAt(new Date())
    await loadSnapshot(activeQuoteId)
  }

  const sendQuote = async () => {
    if (!activeQuoteId || !selectedClient) return
    if (!window.confirm('Send this quote to the client now?')) return

    const result = await sendQuoteToClient({ quoteId: activeQuoteId })
    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    addToast('success', `Quote sent to ${selectedClient.name}`)
    setShareLink(`/portal/${result.data.shareToken}`)
    await loadSnapshot(activeQuoteId)
  }

  const makeRevision = async () => {
    if (!activeQuoteId) return
    const result = await createQuoteRevision({ quoteId: activeQuoteId })
    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    addToast('success', `Revision v${result.data.revisionNumber} created`)
    await loadSnapshot(result.data.quoteId)
  }

  const toggleLock = async (lock: boolean) => {
    if (!activeQuoteId) return
    const confirmText = lock ? 'Lock this quote?' : 'Unlock this quote for editing?'
    if (!window.confirm(confirmText)) return

    const result = await setQuoteLockState({ quoteId: activeQuoteId, lock })
    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    addToast('success', lock ? 'Quote locked' : 'Quote unlocked')
    await loadSnapshot(activeQuoteId)
  }

  const exportPdf = async () => {
    if (!activeQuoteId) return
    const result = await buildQuotePdf({ quoteId: activeQuoteId })
    if (!result.success) {
      addToast('error', `${result.error.message} Retry export and check quote data.`)
      return
    }

    const binary = window.atob(result.data.contentBase64)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = result.data.filename
    anchor.click()
    URL.revokeObjectURL(href)
    addToast('success', 'PDF export prepared')
  }

  const copyShareLink = async () => {
    if (!activeQuoteId) return
    const result = await buildShareableQuoteLink({ quoteId: activeQuoteId })
    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    await navigator.clipboard.writeText(result.data.url)
    setShareLink(result.data.url)
    addToast('success', 'Link copied to clipboard')
    await loadSnapshot(activeQuoteId)
  }

  const updateLineQuantity = (lineId: string, quantity: number) => {
    setLineItems((current) => current.map((line) => (line.id === lineId ? { ...line, quantity: Math.max(0.01, quantity) } : line)))
    setDirty(true)
  }

  const savedText = isSaving ? 'Saving...' : formatSavedTime(savedAt)
  const isQuoteLocked = activeQuote?.status === 'locked'

  return (
    <main className="flex-1 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Quotes</h1>
          <p className="mt-1 text-sm text-neutral-600">{savedText}</p>
        </div>
      </div>

      <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900">Create Quote from Confirmed Recipes</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <select
            value={selectedClientId}
            onChange={(event) => {
              setSelectedClientId(event.target.value)
            }}
            className="h-11 rounded-md border border-neutral-300 bg-white px-3 text-sm"
          >
            <option value="">Select client</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>

          <div className="rounded-md border border-neutral-300 p-2">
            <p className="text-xs font-medium text-neutral-700">Confirmed recipes</p>
            <div className="mt-2 max-h-36 space-y-1 overflow-auto">
              {recipes.map((recipe) => (
                <label key={recipe.id} className="flex items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={selectedRecipeIds.includes(recipe.id)}
                    onChange={(event) => {
                      setSelectedRecipeIds((current) => (
                        event.target.checked
                          ? [...current, recipe.id]
                          : current.filter((id) => id !== recipe.id)
                      ))
                    }}
                  />
                  {recipe.name}
                </label>
              ))}
            </div>
          </div>
        </div>

        <Button type="button" className="mt-3" onClick={() => { void createQuote() }}>
          Create quote
        </Button>
      </section>

      {isLoading ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : quotes.length === 0 ? (
        <section className="mt-6 rounded-lg border border-dashed border-neutral-300 bg-white p-6">
          <p className="text-sm text-neutral-600">
            Create your first quote, then use custom items, discounts, notes, and sharing actions here.
          </p>
        </section>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
            <p className="text-xs font-medium text-neutral-700">Quote list</p>
            <div className="mt-2 space-y-2">
              {quotes.map((quote) => (
                <button
                  key={quote.id}
                  type="button"
                  onClick={() => {
                    applyQuoteToEditor(quote)
                  }}
                  className={[
                    'w-full rounded-md border px-3 py-2 text-left text-sm',
                    quote.id === activeQuoteId
                      ? 'border-brand-500 bg-brand-50 text-brand-800'
                      : 'border-neutral-300 bg-white text-neutral-700',
                  ].join(' ')}
                >
                  <p className="font-medium">{quote.title}</p>
                  <p className="text-xs">{quote.status} · v{quote.revisionNumber}</p>
                </button>
              ))}
            </div>
          </aside>

          <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            {!activeQuote ? (
              <p className="text-sm text-neutral-600">Select a quote to edit.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-neutral-900">{activeQuote.title}</h2>
                    <p className="text-xs text-neutral-600">Status: {activeQuote.status} · Revision v{activeQuote.revisionNumber}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => { void sendQuote() }} disabled={activeQuote.status === 'locked'}>
                      Send quote
                    </Button>
                    <Button type="button" variant="outline" onClick={() => { void makeRevision() }}>
                      New revision
                    </Button>
                    <Button type="button" variant="outline" onClick={() => { void exportPdf() }}>
                      Export PDF
                    </Button>
                    <Button type="button" variant="outline" onClick={() => { void copyShareLink() }}>
                      Copy shareable link
                    </Button>
                    {isQuoteLocked ? (
                      <Button type="button" variant="outline" onClick={() => { void toggleLock(false) }}>
                        Unlock to edit
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" onClick={() => { void toggleLock(true) }}>
                        Lock quote
                      </Button>
                    )}
                  </div>
                </div>

                {isQuoteLocked ? (
                  <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Quote locked — event is within the configured lock window.
                  </p>
                ) : null}

                {shareLink ? <p className="text-xs text-neutral-600">Latest share link: {shareLink}</p> : null}

                <ul className="space-y-2">
                  {lineItems.map((line) => (
                    <li key={line.id} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-neutral-900">{line.description}</p>
                          <p className="text-xs text-neutral-600">
                            {formatMoney(line.unitCostSnapshot)} per unit · {line.lineType}
                          </p>
                          {line.hasPriceDelta && line.lineType === 'inventory' ? (
                            <p className="text-xs text-amber-700">Current cost now {formatMoney(line.currentUnitCost)} (snapshot preserved)</p>
                          ) : null}
                        </div>
                        <p className="text-sm font-semibold text-neutral-900">{formatMoney(line.quantity * line.unitCostSnapshot)}</p>
                      </div>
                      <label className="mt-2 block text-xs text-neutral-600">
                        Quantity
                        <input
                          type="number"
                          min={0.01}
                          step={0.01}
                          disabled={isQuoteLocked}
                          value={line.quantity}
                          onChange={(event) => {
                            updateLineQuantity(line.id, Number(event.target.value))
                          }}
                          className="mt-1 h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"
                        />
                      </label>
                    </li>
                  ))}
                </ul>

                <div className="grid gap-3 rounded-md border border-neutral-200 p-3 md:grid-cols-3">
                  <label className="text-xs text-neutral-600">
                    Custom item description
                    <input
                      type="text"
                      value={customDescription}
                      disabled={isQuoteLocked}
                      onChange={(event) => {
                        setCustomDescription(event.target.value)
                      }}
                      className="mt-1 h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"
                    />
                  </label>
                  <label className="text-xs text-neutral-600">
                    Quantity
                    <input
                      type="number"
                      min={0.01}
                      step={0.01}
                      value={customQuantity}
                      disabled={isQuoteLocked}
                      onChange={(event) => {
                        setCustomQuantity(event.target.value)
                      }}
                      className="mt-1 h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"
                    />
                  </label>
                  <label className="text-xs text-neutral-600">
                    Unit price
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={customUnitPrice}
                      disabled={isQuoteLocked}
                      onChange={(event) => {
                        setCustomUnitPrice(event.target.value)
                      }}
                      className="mt-1 h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"
                    />
                  </label>
                  <div className="md:col-span-3">
                    <Button type="button" variant="outline" onClick={() => { void addCustomItem() }} disabled={isQuoteLocked}>
                      Add custom item
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 rounded-md border border-neutral-200 p-3 md:grid-cols-2">
                  <label className="text-xs text-neutral-600">
                    Discount type
                    <select
                      value={discountType}
                      disabled={isQuoteLocked}
                      onChange={(event) => {
                        const value = event.target.value as 'percent' | 'fixed' | ''
                        setDiscountType(value)
                      }}
                      className="mt-1 h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm"
                    >
                      <option value="">None</option>
                      <option value="percent">Percent</option>
                      <option value="fixed">Fixed amount</option>
                    </select>
                  </label>
                  <label className="text-xs text-neutral-600">
                    Discount value
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      disabled={isQuoteLocked}
                      value={discountValue}
                      onChange={(event) => {
                        setDiscountValue(event.target.value)
                      }}
                      className="mt-1 h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"
                    />
                  </label>
                  <label className="text-xs text-neutral-600 md:col-span-2">
                    Notes
                    <textarea
                      value={note}
                      disabled={isQuoteLocked}
                      onChange={(event) => {
                        setNote(event.target.value)
                      }}
                      className="mt-1 min-h-24 w-full rounded-md border border-neutral-300 px-2 py-2 text-sm"
                    />
                  </label>
                  <div className="md:col-span-2">
                    <Button type="button" variant="outline" onClick={() => { void saveDiscountAndNote() }} disabled={isQuoteLocked}>
                      Save discount and notes
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border border-neutral-200 p-3">
                  <p className="text-xs text-neutral-600">Pricing summary</p>
                  <div className="mt-2 space-y-1 text-sm text-neutral-800">
                    <p>Subtotal: {formatMoney(subtotal)}</p>
                    <p>Discount: -{formatMoney(discountAmount)}</p>
                    <p className="font-semibold">Total: {formatMoney(total)}</p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-md border border-neutral-200 p-3">
                    <p className="text-xs text-neutral-600">Revision history</p>
                    <div className="mt-2 space-y-2">
                      {revisionHistory.map((revision) => (
                        <button
                          key={revision.id}
                          type="button"
                          className={[
                            'w-full rounded-md border px-3 py-2 text-left text-sm',
                            revision.id === activeQuoteId
                              ? 'border-brand-500 bg-brand-50 text-brand-800'
                              : 'border-neutral-300 bg-white text-neutral-700',
                          ].join(' ')}
                          onClick={() => {
                            applyQuoteToEditor(revision)
                          }}
                        >
                          <p className="font-medium">Revision v{revision.revisionNumber}</p>
                          <p className="text-xs">{revision.status}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border border-neutral-200 p-3">
                    <p className="text-xs text-neutral-600">Quote audit log</p>
                    <ul className="mt-2 max-h-64 space-y-2 overflow-auto">
                      {auditEntries.map((entry) => (
                        <li key={entry.id} className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
                          <p className="font-medium text-neutral-900">{entry.actionType}</p>
                          <p>{new Date(entry.createdAt).toLocaleString()}</p>
                          <p>User: {entry.performedBy ?? 'system'}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  )
}
