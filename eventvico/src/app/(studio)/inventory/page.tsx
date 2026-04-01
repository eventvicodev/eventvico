'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import {
  allocateInventoryToEvent,
  applyInventoryScan,
  createAllocationEvent,
  createInventoryItem,
  deleteInventoryItem,
  fetchInventoryItems,
  linkInventoryBarcode,
  listAllocationEvents,
  resolveInventoryBarcode,
  updateInventoryItem,
} from '@/lib/actions/inventory'
import { createClient } from '@/lib/supabase/client'

type Category = 'flowers' | 'decor' | 'consumables'

type InventoryItem = {
  id: string
  name: string
  category: Category
  unit: string
  cost: number
  quantityOnHand: number
  quantityCommitted: number
  quantityAvailable: number
  sku: string
  barcodeValue: string | null
}
type AllocationEvent = {
  id: string
  name: string
  startAt: string
  endAt: string
}
type SyncState = 'synced' | 'pending' | 'syncing' | 'error'

const categoryLabels: Record<Category, string> = {
  flowers: 'Flowers',
  decor: 'Decor',
  consumables: 'Consumables',
}
const scanQueueStorageKey = 'eventvico_inventory_scan_queue_v1'

export default function InventoryPage() {
  const supabase = useMemo(() => createClient(), [])
  const { addToast } = useToast()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [tenantId, setTenantId] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [barcodeItem, setBarcodeItem] = useState<InventoryItem | null>(null)
  const [barcodeCode, setBarcodeCode] = useState('')
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [collision, setCollision] = useState<{ itemId: string; itemName: string; code: string } | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [scanCode, setScanCode] = useState('')
  const [scanQuantity, setScanQuantity] = useState('')
  const [resolvedScanItem, setResolvedScanItem] = useState<{ id: string; name: string; unit: string } | null>(null)
  const [scanMessage, setScanMessage] = useState<string | null>(null)
  const [syncState, setSyncState] = useState<SyncState>('synced')
  const [allocationItem, setAllocationItem] = useState<InventoryItem | null>(null)
  const [allocationEvents, setAllocationEvents] = useState<AllocationEvent[]>([])
  const [allocationEventId, setAllocationEventId] = useState('')
  const [allocationQuantity, setAllocationQuantity] = useState('')
  const [allocationWarning, setAllocationWarning] = useState<string | null>(null)
  const [newEventName, setNewEventName] = useState('')
  const [newEventStartAt, setNewEventStartAt] = useState('')
  const [newEventEndAt, setNewEventEndAt] = useState('')
  const [formValues, setFormValues] = useState({
    name: '',
    category: 'flowers' as Category,
    unit: '',
    cost: '',
    quantityOnHand: '',
    sku: '',
  })

  const loadInventory = async () => {
    setIsLoading(true)
    const result = await fetchInventoryItems()
    setIsLoading(false)

    if (!result.success) {
      setItems([])
      addToast('error', result.error.message)
      return
    }

    setTenantId(result.data.tenantId)
    setItems(result.data.items)
  }

  const loadAllocationEvents = async () => {
    const result = await listAllocationEvents()
    if (!result.success) {
      addToast('error', result.error.message)
      setAllocationEvents([])
      return
    }
    setAllocationEvents(result.data.events)
  }

  useEffect(() => {
    void loadInventory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!tenantId) return

    const channel = supabase
      .channel(`inventory-realtime-${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inventory_items',
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          void loadInventory()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inventory_allocations',
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          void loadInventory()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          void loadAllocationEvents()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, tenantId])

  const grouped = useMemo(() => {
    const base: Record<Category, InventoryItem[]> = {
      flowers: [],
      decor: [],
      consumables: [],
    }

    for (const item of items) {
      base[item.category].push(item)
    }
    return base
  }, [items])

  const resetForm = () => {
    setEditingId(null)
    setErrors({})
    setFormValues({
      name: '',
      category: 'flowers',
      unit: '',
      cost: '',
      quantityOnHand: '',
      sku: '',
    })
  }

  const handleSave = async () => {
    setIsSaving(true)
    setErrors({})

    const payload = {
      ...formValues,
      id: editingId ?? undefined,
    }

    if (editingId) {
      const result = await updateInventoryItem(payload)
      setIsSaving(false)

      if (!result.success) {
        if (result.error.fields) {
          setErrors(result.error.fields)
          return
        }
        addToast('error', result.error.message)
        return
      }

      if (result.data.priceChanged) {
        addToast(
          'success',
          `Price updated — ${result.data.repricedRecipeCount} recipes and ${result.data.repricedQuoteCount} quotes repriced`
        )
      } else {
        addToast('success', 'Inventory item updated')
      }
    } else {
      const result = await createInventoryItem(payload)
      setIsSaving(false)

      if (!result.success) {
        if (result.error.fields) {
          setErrors(result.error.fields)
          return
        }
        addToast('error', result.error.message)
        return
      }

      addToast('success', 'Inventory item created')
    }

    resetForm()
    await loadInventory()
  }

  const handleEdit = (item: InventoryItem) => {
    setEditingId(item.id)
    setErrors({})
    setFormValues({
      name: item.name,
      category: item.category,
      unit: item.unit,
      cost: item.cost.toString(),
      quantityOnHand: item.quantityOnHand.toString(),
      sku: item.sku,
    })
  }

  const handleRemove = async (item: InventoryItem) => {
    const confirmed = window.confirm(
      `Remove "${item.name}"?\n\nWarning: if this item is currently allocated to any active event, removing it can impact fulfillment planning.`
    )
    if (!confirmed) return

    const result = await deleteInventoryItem({ id: item.id })
    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    addToast('warning', 'Inventory item removed')
    await loadInventory()
  }

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
    }
    setStream(null)
    setCameraActive(false)
  }

  const startCamera = async () => {
    setCameraError(null)
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera is not available in this browser. Use manual barcode entry.')
        return
      }
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      setStream(media)
      setCameraActive(true)
    } catch {
      setCameraError('Camera access failed. You can still enter barcode manually.')
      setCameraActive(false)
    }
  }

  const openBarcodeLinker = async (item: InventoryItem) => {
    setBarcodeItem(item)
    setBarcodeCode(item.barcodeValue ?? '')
    setCollision(null)
    await startCamera()
  }

  const closeBarcodeLinker = () => {
    setBarcodeItem(null)
    setBarcodeCode('')
    setCollision(null)
    stopCamera()
  }

  const openAllocator = async (item: InventoryItem) => {
    setAllocationItem(item)
    setAllocationQuantity(item.quantityAvailable > 0 ? item.quantityAvailable.toString() : '')
    setAllocationEventId('')
    setAllocationWarning(null)
    setNewEventName('')
    setNewEventStartAt('')
    setNewEventEndAt('')
    await loadAllocationEvents()
  }

  const closeAllocator = () => {
    setAllocationItem(null)
    setAllocationEventId('')
    setAllocationQuantity('')
    setAllocationWarning(null)
    setNewEventName('')
    setNewEventStartAt('')
    setNewEventEndAt('')
  }

  const submitBarcode = async (reassign: boolean) => {
    if (!barcodeItem) return
    const result = await linkInventoryBarcode({
      itemId: barcodeItem.id,
      code: barcodeCode,
      reassign,
    })

    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    if ('status' in result.data && result.data.status === 'collision') {
      setCollision({
        itemId: result.data.existingItemId,
        itemName: result.data.existingItemName,
        code: result.data.barcodeValue,
      })
      return
    }

    addToast('success', `Barcode linked: ${result.data.barcodeValue}`)
    closeBarcodeLinker()
    await loadInventory()
  }

  const createEventForAllocation = async () => {
    const result = await createAllocationEvent({
      name: newEventName,
      startAt: newEventStartAt,
      endAt: newEventEndAt,
    })

    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    addToast('success', 'Event created')
    await loadAllocationEvents()
    setAllocationEventId(result.data.eventId)
    setNewEventName('')
    setNewEventStartAt('')
    setNewEventEndAt('')
  }

  const saveAllocation = async (force: boolean) => {
    if (!allocationItem) return
    const quantity = Number(allocationQuantity)
    if (!allocationEventId || Number.isNaN(quantity) || quantity <= 0) {
      setAllocationWarning('Select an event and enter a valid quantity.')
      return
    }

    const result = await allocateInventoryToEvent({
      inventoryItemId: allocationItem.id,
      eventId: allocationEventId,
      quantityCommitted: quantity,
      force,
    })

    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    if ('status' in result.data && result.data.status === 'warning') {
      setAllocationWarning(result.data.message)
      return
    }

    addToast('success', 'Allocation saved')
    closeAllocator()
    await loadInventory()
  }

  useEffect(() => {
    if (!videoRef.current || !stream) return
    videoRef.current.srcObject = stream
  }, [stream])

  const readQueue = () => {
    try {
      const raw = localStorage.getItem(scanQueueStorageKey)
      if (!raw) return [] as Array<{ code: string; quantityOnHand: number }>
      const parsed = JSON.parse(raw) as Array<{ code: string; quantityOnHand: number }>
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return [] as Array<{ code: string; quantityOnHand: number }>
    }
  }

  const writeQueue = (queue: Array<{ code: string; quantityOnHand: number }>) => {
    localStorage.setItem(scanQueueStorageKey, JSON.stringify(queue))
  }

  const flushQueue = async () => {
    const queue = readQueue()
    if (queue.length === 0) {
      setSyncState('synced')
      return
    }

    setSyncState('syncing')
    const remaining: Array<{ code: string; quantityOnHand: number }> = []
    for (const payload of queue) {
      try {
        const response = await fetch('/api/inventory-scans', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          remaining.push(payload)
        }
      } catch {
        remaining.push(payload)
      }
    }
    writeQueue(remaining)
    if (remaining.length > 0) {
      setSyncState('error')
      return
    }
    setSyncState('synced')
    await loadInventory()
  }

  const lookupScannedCode = async () => {
    setScanMessage(null)
    const result = await resolveInventoryBarcode(scanCode)
    if (!result.success) {
      setResolvedScanItem(null)
      setScanMessage(result.error.message)
      return
    }

    setResolvedScanItem({
      id: result.data.item.id,
      name: result.data.item.name,
      unit: result.data.item.unit,
    })
    setScanQuantity(result.data.item.quantityOnHand.toString())
    setScanMessage(null)
  }

  const applyScanUpdate = async () => {
    const normalizedCode = scanCode.trim()
    const quantity = Number(scanQuantity)
    if (!normalizedCode || Number.isNaN(quantity) || quantity < 0) {
      setScanMessage('Enter a valid code and non-negative quantity.')
      return
    }

    if (!navigator.onLine) {
      const queue = readQueue()
      queue.push({ code: normalizedCode, quantityOnHand: quantity })
      writeQueue(queue)
      setSyncState('pending')
      addToast('warning', 'Scan queued offline. It will sync automatically when online.')
      return
    }

    const result = await applyInventoryScan({
      code: normalizedCode,
      quantityOnHand: quantity,
    })
    if (!result.success) {
      setSyncState('error')
      setScanMessage(result.error.message)
      addToast('error', result.error.message)
      return
    }

    setSyncState('synced')
    addToast('success', 'Stock updated from scan')
    await loadInventory()
  }

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [stream])

  useEffect(() => {
    const queue = readQueue()
    setSyncState(queue.length > 0 ? 'pending' : 'synced')

    const handleOnline = () => {
      void flushQueue()
    }
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('online', handleOnline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="flex-1 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Inventory</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Track live stock levels across flowers, decor, and consumables.
          </p>
        </div>
        <button
          type="button"
          className="hidden min-h-11 items-center gap-2 rounded-md border border-brand-500 bg-brand-50 px-3 text-sm font-medium text-brand-700 md:inline-flex lg:hidden"
        >
          <ScanLine className="h-4 w-4" />
          Open scanner
        </button>
      </div>

      <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-900">Scanner</h2>
          <div
            aria-live="polite"
            className={[
              'rounded-full px-2 py-0.5 text-xs font-medium',
              syncState === 'synced' ? 'bg-emerald-100 text-emerald-800' : '',
              syncState === 'pending' ? 'bg-amber-100 text-amber-800 animate-pulse' : '',
              syncState === 'syncing' ? 'bg-blue-100 text-blue-800 animate-pulse' : '',
              syncState === 'error' ? 'bg-red-100 text-red-800' : '',
            ].join(' ')}
          >
            Sync: {syncState}
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            value={scanCode}
            onChange={(event) => {
              setScanCode(event.target.value)
              setResolvedScanItem(null)
            }}
            placeholder="Scan or enter barcode value"
            className="h-11 rounded-md border border-neutral-300 px-3 text-sm"
          />
          <Button type="button" variant="secondary" onClick={() => { void lookupScannedCode() }}>
            Identify item
          </Button>
        </div>

        {resolvedScanItem ? (
          <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-sm font-medium text-neutral-900">{resolvedScanItem.name}</p>
            <label className="mt-2 block text-xs text-neutral-600">
              New quantity on hand ({resolvedScanItem.unit})
              <input
                value={scanQuantity}
                onChange={(event) => {
                  setScanQuantity(event.target.value)
                }}
                type="number"
                min="0"
                step="0.01"
                className="mt-1 h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"
              />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" onClick={() => { void applyScanUpdate() }}>
                Apply quantity
              </Button>
              {syncState === 'error' ? (
                <Button type="button" variant="secondary" onClick={() => { void flushQueue() }}>
                  Retry sync
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {scanMessage ? (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p>{scanMessage}</p>
            {scanMessage.includes('No item linked') ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() => {
                  const first = items[0]
                  if (!first) return
                  void openBarcodeLinker(first)
                }}
              >
                Link it now
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900">
          {editingId ? 'Edit inventory item' : 'Add inventory item'}
        </h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <div>
            <input
              value={formValues.name}
              onChange={(event) => {
                setFormValues((current) => ({ ...current, name: event.target.value }))
              }}
              placeholder="Item name"
              className="h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            />
            {errors.name?.[0] ? <p className="mt-1 text-xs text-red-600">{errors.name[0]}</p> : null}
          </div>

          <div>
            <select
              value={formValues.category}
              onChange={(event) => {
                setFormValues((current) => ({ ...current, category: event.target.value as Category }))
              }}
              className="h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              <option value="flowers">Flowers</option>
              <option value="decor">Decor</option>
              <option value="consumables">Consumables</option>
            </select>
            {errors.category?.[0] ? <p className="mt-1 text-xs text-red-600">{errors.category[0]}</p> : null}
          </div>

          <div>
            <input
              value={formValues.unit}
              onChange={(event) => {
                setFormValues((current) => ({ ...current, unit: event.target.value }))
              }}
              placeholder="Unit (e.g., stems)"
              className="h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            />
            {errors.unit?.[0] ? <p className="mt-1 text-xs text-red-600">{errors.unit[0]}</p> : null}
          </div>

          <div>
            <input
              value={formValues.cost}
              onChange={(event) => {
                setFormValues((current) => ({ ...current, cost: event.target.value }))
              }}
              placeholder="Unit cost"
              type="number"
              min="0"
              step="0.01"
              className="h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            />
            {errors.cost?.[0] ? <p className="mt-1 text-xs text-red-600">{errors.cost[0]}</p> : null}
          </div>

          <div>
            <input
              value={formValues.quantityOnHand}
              onChange={(event) => {
                setFormValues((current) => ({ ...current, quantityOnHand: event.target.value }))
              }}
              placeholder="Quantity on hand"
              type="number"
              min="0"
              step="0.01"
              className="h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            />
            {errors.quantityOnHand?.[0] ? <p className="mt-1 text-xs text-red-600">{errors.quantityOnHand[0]}</p> : null}
          </div>

          <div>
            <input
              value={formValues.sku}
              onChange={(event) => {
                setFormValues((current) => ({ ...current, sku: event.target.value }))
              }}
              placeholder="SKU"
              className="h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            />
            {errors.sku?.[0] ? <p className="mt-1 text-xs text-red-600">{errors.sku[0]}</p> : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" onClick={() => { void handleSave() }} disabled={isSaving} className="min-h-11">
            {isSaving ? 'Saving...' : editingId ? 'Save item' : 'Add item'}
          </Button>
          {editingId ? (
            <Button type="button" variant="secondary" onClick={resetForm} className="min-h-11">
              Cancel edit
            </Button>
          ) : null}
        </div>
      </section>

      {allocationItem ? (
        <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900">Allocate Inventory · {allocationItem.name}</h2>
          <p className="mt-2 text-xs text-neutral-600">
            Committed: {allocationItem.quantityCommitted} {allocationItem.unit} · Available: {allocationItem.quantityAvailable} {allocationItem.unit}
          </p>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs text-neutral-700">
              Event
              <select
                value={allocationEventId}
                onChange={(event) => {
                  setAllocationEventId(event.target.value)
                  setAllocationWarning(null)
                }}
                className="mt-1 h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900"
              >
                <option value="">Select event</option>
                {allocationEvents.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name} · {new Date(event.startAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs text-neutral-700">
              Quantity to commit ({allocationItem.unit})
              <input
                value={allocationQuantity}
                onChange={(event) => {
                  setAllocationQuantity(event.target.value)
                  setAllocationWarning(null)
                }}
                type="number"
                min="0.01"
                step="0.01"
                className="mt-1 h-11 w-full rounded-md border border-neutral-300 px-3 text-sm text-neutral-900"
              />
            </label>
          </div>

          <div className="mt-3 rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3">
            <p className="text-xs font-medium text-neutral-700">Quick create event</p>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <input
                value={newEventName}
                onChange={(event) => {
                  setNewEventName(event.target.value)
                }}
                placeholder="Event name"
                className="h-10 rounded-md border border-neutral-300 px-2 text-sm"
              />
              <input
                value={newEventStartAt}
                onChange={(event) => {
                  setNewEventStartAt(event.target.value)
                }}
                type="datetime-local"
                className="h-10 rounded-md border border-neutral-300 px-2 text-sm"
              />
              <input
                value={newEventEndAt}
                onChange={(event) => {
                  setNewEventEndAt(event.target.value)
                }}
                type="datetime-local"
                className="h-10 rounded-md border border-neutral-300 px-2 text-sm"
              />
            </div>
            <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => { void createEventForAllocation() }}>
              Create event
            </Button>
          </div>

          {allocationWarning ? (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              {allocationWarning}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={() => { void saveAllocation(false) }}>
              Save allocation
            </Button>
            {allocationWarning?.includes('Only ') ? (
              <Button type="button" variant="secondary" onClick={() => { void saveAllocation(true) }}>
                Proceed anyway
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={closeAllocator}>
              Cancel
            </Button>
          </div>
        </section>
      ) : null}

      {barcodeItem ? (
        <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900">Link Barcode/QR · {barcodeItem.name}</h2>
          {cameraActive ? (
            <p className="mt-2 text-xs text-emerald-700">Camera active. Position the code in view, or enter manually below.</p>
          ) : (
            <p className="mt-2 text-xs text-neutral-600">Camera inactive. You can still link by entering the code manually.</p>
          )}
          {cameraError ? <p className="mt-1 text-xs text-red-600">{cameraError}</p> : null}
          {cameraActive ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="mt-2 h-36 w-full rounded-md border border-neutral-200 bg-neutral-100 object-cover"
            />
          ) : null}

          <input
            value={barcodeCode}
            onChange={(event) => {
              setBarcodeCode(event.target.value)
              setCollision(null)
            }}
            placeholder="Scan or type barcode value"
            className="mt-3 h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          />

          {collision ? (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p>
                This code is already linked to {collision.itemName}. Reassign or cancel.
              </p>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                void submitBarcode(false)
              }}
              disabled={!barcodeCode.trim()}
            >
              Link code
            </Button>
            {collision ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void submitBarcode(true)
                }}
              >
                Reassign code
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={closeBarcodeLinker}>
              Cancel
            </Button>
          </div>
        </section>
      ) : null}

      {isLoading ? (
        <div className="mt-6 space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : items.length === 0 ? (
        <section className="mt-6 rounded-lg border border-dashed border-neutral-300 bg-white p-6">
          <p className="text-sm text-neutral-600">
            Import your inventory to get started — download the template below
          </p>
          <Link
            href="/inventory/import"
            className="mt-3 inline-flex min-h-11 items-center rounded-md border border-brand-500 bg-brand-500 px-3 text-sm font-medium text-white hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Import inventory
          </Link>
        </section>
      ) : (
        <div className="mt-6 space-y-4">
          {(['flowers', 'decor', 'consumables'] as const).map((category) => (
            <section key={category} className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-neutral-900">{categoryLabels[category]}</h2>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                  {grouped[category].length}
                </span>
              </div>

              {grouped[category].length === 0 ? (
                <p className="mt-3 rounded-md border border-dashed border-neutral-300 p-3 text-xs text-neutral-600">
                  No items in this category yet.
                </p>
              ) : (
                <ul className="mt-3 grid gap-3 md:grid-cols-2">
                  {grouped[category].map((item) => (
                    <li key={item.id} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-neutral-900">{item.name}</p>
                          <p className="mt-1 text-xs text-neutral-600">
                            SKU: {item.sku} · {item.quantityOnHand} {item.unit} on hand · ${item.cost.toFixed(2)} per unit
                          </p>
                          <p className="mt-1 text-xs text-neutral-600">
                            Committed: {item.quantityCommitted} {item.unit} · Available: {item.quantityAvailable} {item.unit}
                          </p>
                          <p className="mt-1 text-xs text-neutral-500">
                            Barcode: {item.barcodeValue ?? 'Not linked'}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button type="button" variant="secondary" size="sm" onClick={() => { handleEdit(item) }}>
                            Edit
                          </Button>
                          <Button type="button" variant="secondary" size="sm" onClick={() => { void openBarcodeLinker(item) }}>
                            Link Barcode/QR
                          </Button>
                          <Button type="button" variant="secondary" size="sm" onClick={() => { void openAllocator(item) }}>
                            Allocate
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => { void handleRemove(item) }}>
                            Remove
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
