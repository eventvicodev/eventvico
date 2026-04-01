'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import {
  createRecipe,
  setInventoryItemUnavailable,
  fetchRecipeBuilderSnapshot,
  fetchRecipeItems,
  saveRecipeItems,
  suggestSubstitutions,
  updateRecipeMetadata,
} from '@/lib/actions/recipes'

type InventoryItem = {
  id: string
  name: string
  category: 'flowers' | 'decor' | 'consumables'
  unit: string
  cost: number
  unavailable: boolean
}

type Recipe = {
  id: string
  name: string
  eventType: string | null
  clientId: string | null
  tags: string[]
}

type ClientOption = {
  id: string
  name: string
}

type RecipeItem = {
  inventoryItemId: string
  name: string
  unit: string
  cost: number
  unavailable: boolean
  stemCount: number
  quantity: number
  position: number
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

export default function RecipesPage() {
  const { addToast } = useToast()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null)
  const [items, setItems] = useState<RecipeItem[]>([])
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [dirtySinceSave, setDirtySinceSave] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [substitutionTargetId, setSubstitutionTargetId] = useState<string | null>(null)
  const [substitutionSuggestions, setSubstitutionSuggestions] = useState<Array<{
    inventoryItemId: string
    name: string
    unit: string
    cost: number
    costDelta: number
  }>>([])
  const [previewSubstitution, setPreviewSubstitution] = useState<{
    targetId: string
    suggestion: {
      inventoryItemId: string
      name: string
      unit: string
      cost: number
      costDelta: number
    }
  } | null>(null)
  const [recipeEventTypeFilter, setRecipeEventTypeFilter] = useState('')
  const [recipeClientFilter, setRecipeClientFilter] = useState('')
  const [recipeTagFilter, setRecipeTagFilter] = useState('')
  const [metadataEventType, setMetadataEventType] = useState('')
  const [metadataClientId, setMetadataClientId] = useState('')
  const [metadataTags, setMetadataTags] = useState('')

  const activateRecipe = (recipe: Recipe) => {
    setActiveRecipeId(recipe.id)
    setMetadataEventType(recipe.eventType ?? '')
    setMetadataClientId(recipe.clientId ?? '')
    setMetadataTags(recipe.tags.join(', '))
  }

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      const snapshot = await fetchRecipeBuilderSnapshot()
      setIsLoading(false)

      if (!snapshot.success) {
        addToast('error', snapshot.error.message)
        return
      }

      setRecipes(snapshot.data.recipes)
      setClients(snapshot.data.clients)
      setInventoryItems(snapshot.data.inventoryItems)
      if (snapshot.data.recipes[0]) {
        activateRecipe(snapshot.data.recipes[0])
      }
    }

    void load()
  }, [addToast])

  useEffect(() => {
    const loadRecipeItems = async () => {
      if (!activeRecipeId) {
        setItems([])
        return
      }
      const result = await fetchRecipeItems(activeRecipeId)
      if (!result.success) {
        addToast('error', result.error.message)
        return
      }
      setItems(result.data.items)
      setDirtySinceSave(false)
    }

    void loadRecipeItems()
  }, [activeRecipeId, addToast])

  useEffect(() => {
    if (!activeRecipeId || !dirtySinceSave) return
    const timer = setTimeout(async () => {
      setIsSaving(true)
      const result = await saveRecipeItems({
        recipeId: activeRecipeId,
        items: items.map((item, index) => ({
          inventoryItemId: item.inventoryItemId,
          stemCount: item.stemCount,
          quantity: item.quantity,
          position: index,
        })),
      })
      setIsSaving(false)
      if (!result.success) {
        addToast('error', result.error.message)
        return
      }
      setSavedAt(new Date())
      setDirtySinceSave(false)
    }, 2000)

    return () => clearTimeout(timer)
  }, [activeRecipeId, addToast, dirtySinceSave, items])

  useEffect(() => {
    const baseTitle = 'Eventvico'
    if (dirtySinceSave) {
      document.title = `• ${baseTitle}`
    } else {
      document.title = baseTitle
    }
    return () => {
      document.title = baseTitle
    }
  }, [dirtySinceSave])

  const filteredInventory = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) return inventoryItems
    return inventoryItems.filter((item) => item.name.toLowerCase().includes(normalized))
  }, [inventoryItems, search])

  const filteredRecipes = useMemo(() => {
    return recipes.filter((recipe) => {
      if (recipeEventTypeFilter && recipe.eventType !== recipeEventTypeFilter) return false
      if (recipeClientFilter && recipe.clientId !== recipeClientFilter) return false
      if (recipeTagFilter) {
        const normalizedTag = recipeTagFilter.trim().toLowerCase()
        if (!recipe.tags.some((tag) => tag.toLowerCase().includes(normalizedTag))) return false
      }
      return true
    })
  }, [recipes, recipeClientFilter, recipeEventTypeFilter, recipeTagFilter])

  const recipeTotal = useMemo(() => {
    return items.reduce((sum, item) => {
      const activePreview = previewSubstitution?.targetId === item.inventoryItemId
        ? previewSubstitution.suggestion
        : null
      const cost = activePreview ? activePreview.cost : item.cost
      return sum + cost * item.quantity
    }, 0)
  }, [items, previewSubstitution])

  const addIngredient = (inventory: InventoryItem) => {
    setItems((current) => {
      const existing = current.find((item) => item.inventoryItemId === inventory.id)
      if (existing) {
        return current.map((item) =>
          item.inventoryItemId === inventory.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      }
      return [
        ...current,
        {
          inventoryItemId: inventory.id,
          name: inventory.name,
          unit: inventory.unit,
          cost: inventory.cost,
          unavailable: inventory.unavailable,
          stemCount: 10,
          quantity: 1,
          position: current.length,
        },
      ]
    })
    setDirtySinceSave(true)
  }

  const moveItem = async (index: number, direction: 'up' | 'down') => {
    const nextIndex = direction === 'up' ? index - 1 : index + 1
    if (nextIndex < 0 || nextIndex >= items.length) return

    const previous = items
    const next = [...items]
    const [currentItem] = next.splice(index, 1)
    next.splice(nextIndex, 0, currentItem)
    setItems(next.map((item, position) => ({ ...item, position })))
    setDirtySinceSave(true)

    if (!activeRecipeId) return
    const result = await saveRecipeItems({
      recipeId: activeRecipeId,
      items: next.map((item, position) => ({
        inventoryItemId: item.inventoryItemId,
        stemCount: item.stemCount,
        quantity: item.quantity,
        position,
      })),
    })
    if (!result.success) {
      setItems(previous)
      setDirtySinceSave(false)
      addToast('error', 'Update failed — changes reverted')
      return
    }
    setSavedAt(new Date())
    setDirtySinceSave(false)
  }

  const updateItem = (inventoryItemId: string, field: 'stemCount' | 'quantity', value: number) => {
    setItems((current) =>
      current.map((item) =>
        item.inventoryItemId === inventoryItemId
          ? { ...item, [field]: field === 'stemCount' ? Math.max(1, Math.floor(value)) : Math.max(0.01, value) }
          : item
      )
    )
    setDirtySinceSave(true)
  }

  const markUnavailable = async (inventoryItemId: string) => {
    const result = await setInventoryItemUnavailable({
      inventoryItemId,
      unavailable: true,
    })
    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    setItems((current) =>
      current.map((item) =>
        item.inventoryItemId === inventoryItemId
          ? { ...item, unavailable: true }
          : item
      )
    )
    setInventoryItems((current) =>
      current.map((item) =>
        item.id === inventoryItemId ? { ...item, unavailable: true } : item
      )
    )
    addToast('warning', 'Item marked unavailable')
  }

  const openSubstitutionPanel = async (inventoryItemId: string) => {
    const result = await suggestSubstitutions({ inventoryItemId })
    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    setSubstitutionTargetId(inventoryItemId)
    setSubstitutionSuggestions(result.data.suggestions)
    setPreviewSubstitution(null)
  }

  const confirmSubstitution = () => {
    if (!previewSubstitution) return

    setItems((current) => {
      const target = current.find((item) => item.inventoryItemId === previewSubstitution.targetId)
      if (!target) return current

      const existingReplacement = current.find(
        (item) => item.inventoryItemId === previewSubstitution.suggestion.inventoryItemId
      )

      if (existingReplacement) {
        return current
          .filter((item) => item.inventoryItemId !== previewSubstitution.targetId)
          .map((item) =>
            item.inventoryItemId === previewSubstitution.suggestion.inventoryItemId
              ? { ...item, quantity: item.quantity + target.quantity }
              : item
          )
      }

      return current.map((item) =>
        item.inventoryItemId === previewSubstitution.targetId
          ? {
              ...item,
              inventoryItemId: previewSubstitution.suggestion.inventoryItemId,
              name: previewSubstitution.suggestion.name,
              unit: previewSubstitution.suggestion.unit,
              cost: previewSubstitution.suggestion.cost,
              unavailable: false,
            }
          : item
      )
    })

    setDirtySinceSave(true)
    setSubstitutionTargetId(null)
    setSubstitutionSuggestions([])
    setPreviewSubstitution(null)
    addToast('success', 'Substitution confirmed')
  }

  const createNewRecipe = async () => {
    const result = await createRecipe({ name: `Recipe ${recipes.length + 1}` })
    if (!result.success) {
      addToast('error', result.error.message)
      return
    }
    const created: Recipe = {
      id: result.data.recipeId,
      name: `Recipe ${recipes.length + 1}`,
      eventType: null,
      clientId: null,
      tags: [],
    }
    setRecipes((current) => [created, ...current])
    activateRecipe(created)
    setItems([])
    setSavedAt(null)
    setDirtySinceSave(false)
  }

  const saveRecipeMetadata = async () => {
    if (!activeRecipeId) return
    const tags = metadataTags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)

    const result = await updateRecipeMetadata({
      recipeId: activeRecipeId,
      eventType: metadataEventType || null,
      clientId: metadataClientId || null,
      tags,
    })
    if (!result.success) {
      addToast('error', result.error.message)
      return
    }

    setRecipes((current) =>
      current.map((recipe) =>
        recipe.id === activeRecipeId
          ? {
              ...recipe,
              eventType: metadataEventType || null,
              clientId: metadataClientId || null,
              tags,
            }
          : recipe
      )
    )
    addToast('success', 'Recipe metadata saved')
  }

  const savedText = isSaving
    ? 'Saving...'
    : savedAt
      ? `Saved · ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(savedAt)}`
      : 'Not saved yet'

  if (isLoading) {
    return (
      <main className="flex-1 p-6">
        <p className="text-sm text-neutral-600">Loading recipe builder...</p>
      </main>
    )
  }

  if (recipes.length === 0) {
    return (
      <main className="flex-1 p-6">
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-6">
          <h1 className="text-xl font-semibold text-neutral-900">Recipes</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Build your first recipe — start from scratch or let AI inspire you
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" className="min-h-11" onClick={() => { void createNewRecipe() }}>
              Start from scratch
            </Button>
            <Link
              href="/recipes/ai"
              className="inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              Let AI inspire you
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Recipe Builder</h1>
          <p className="mt-1 text-sm text-neutral-600">{savedText}</p>
        </div>
        <Button type="button" variant="secondary" className="min-h-11" onClick={() => { void createNewRecipe() }}>
          New recipe
        </Button>
      </div>

      <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900">Recipe Library</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <select
            value={recipeEventTypeFilter}
            onChange={(event) => {
              setRecipeEventTypeFilter(event.target.value)
            }}
            className="h-11 rounded-md border border-neutral-300 bg-white px-3 text-sm"
          >
            <option value="">All event types</option>
            <option value="wedding">Wedding</option>
            <option value="corporate">Corporate</option>
            <option value="birthday">Birthday</option>
            <option value="other">Other</option>
          </select>
          <select
            value={recipeClientFilter}
            onChange={(event) => {
              setRecipeClientFilter(event.target.value)
            }}
            className="h-11 rounded-md border border-neutral-300 bg-white px-3 text-sm"
          >
            <option value="">All clients</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
          <input
            value={recipeTagFilter}
            onChange={(event) => {
              setRecipeTagFilter(event.target.value)
            }}
            placeholder="Filter by tag"
            className="h-11 rounded-md border border-neutral-300 px-3 text-sm"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {filteredRecipes.map((recipe) => (
            <button
              key={recipe.id}
              type="button"
              onClick={() => {
                activateRecipe(recipe)
              }}
              className={[
                'rounded-md border px-3 py-2 text-left text-sm',
                recipe.id === activeRecipeId
                  ? 'border-brand-500 bg-brand-50 text-brand-800'
                  : 'border-neutral-300 bg-white text-neutral-700',
              ].join(' ')}
            >
              {recipe.name}
            </button>
          ))}
          {filteredRecipes.length === 0 ? (
            <p className="text-xs text-neutral-600">No recipes match the selected filters.</p>
          ) : null}
        </div>
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-[340px_1fr]">
        <aside className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <label htmlFor="inventorySearch" className="text-xs font-medium text-neutral-700">
            Search inventory
          </label>
          <input
            id="inventorySearch"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
            className="mt-2 h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            placeholder="Search ingredients"
          />

          <ul className="mt-3 max-h-[420px] space-y-2 overflow-auto">
            {filteredInventory.map((item) => (
              <li key={item.id} className="rounded-md border border-neutral-200 p-2">
                <p className="text-sm font-medium text-neutral-900">{item.name}</p>
                <p className="mt-1 text-xs text-neutral-600">
                  {formatMoney(item.cost)} / {item.unit}
                </p>
                {item.unavailable ? (
                  <p className="mt-1 text-xs text-amber-700">⚠ Unavailable</p>
                ) : null}
                <Button type="button" size="sm" className="mt-2" onClick={() => { addIngredient(item) }}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm md:max-h-[70vh] md:overflow-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Ingredients</h2>
            <p className="text-sm font-semibold text-neutral-900">{formatMoney(recipeTotal)}</p>
          </div>

          <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-xs font-medium text-neutral-700">Recipe organization</p>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <select
                value={metadataEventType}
                onChange={(event) => {
                  setMetadataEventType(event.target.value)
                }}
                className="h-10 rounded-md border border-neutral-300 bg-white px-2 text-sm"
              >
                <option value="">Event type</option>
                <option value="wedding">Wedding</option>
                <option value="corporate">Corporate</option>
                <option value="birthday">Birthday</option>
                <option value="other">Other</option>
              </select>
              <select
                value={metadataClientId}
                onChange={(event) => {
                  setMetadataClientId(event.target.value)
                }}
                className="h-10 rounded-md border border-neutral-300 bg-white px-2 text-sm"
              >
                <option value="">No client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
              <input
                value={metadataTags}
                onChange={(event) => {
                  setMetadataTags(event.target.value)
                }}
                placeholder="Tags (comma separated)"
                className="h-10 rounded-md border border-neutral-300 bg-white px-2 text-sm"
              />
            </div>
            <Button type="button" size="sm" className="mt-2" onClick={() => { void saveRecipeMetadata() }}>
              Save metadata
            </Button>
          </div>

          {items.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed border-neutral-300 p-3 text-sm text-neutral-600">
              Add inventory items from the left panel to start building this recipe.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {items.map((item, index) => {
                const activePreview = previewSubstitution?.targetId === item.inventoryItemId
                  ? previewSubstitution.suggestion
                  : null
                const displayName = activePreview ? activePreview.name : item.name
                const displayUnit = activePreview ? activePreview.unit : item.unit
                const displayCost = activePreview ? activePreview.cost : item.cost
                const lineTotal = displayCost * item.quantity
                return (
                  <li key={item.inventoryItemId} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-neutral-900">🌿 {displayName}</p>
                        <p className="mt-1 text-xs text-neutral-600">
                          {formatMoney(displayCost)} / {displayUnit} · Line total {formatMoney(lineTotal)}
                        </p>
                        {item.unavailable ? (
                          <p className="mt-1 text-xs text-amber-700">⚠ This item is unavailable.</p>
                        ) : null}
                        {activePreview ? (
                          <p className="mt-1 text-xs text-blue-700">
                            Previewing substitution ({activePreview.costDelta >= 0 ? '+' : '-'}{formatMoney(Math.abs(activePreview.costDelta))})
                          </p>
                        ) : null}
                      </div>
                      <div className="flex gap-1">
                        <Button type="button" size="sm" variant="ghost" onClick={() => { void moveItem(index, 'up') }}>
                          ↑
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => { void moveItem(index, 'down') }}>
                          ↓
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="text-xs text-neutral-600">
                        Stem count
                        <input
                          type="number"
                          min={1}
                          value={item.stemCount}
                          onChange={(event) => {
                            updateItem(item.inventoryItemId, 'stemCount', Number(event.target.value))
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
                          value={item.quantity}
                          onChange={(event) => {
                            updateItem(item.inventoryItemId, 'quantity', Number(event.target.value))
                          }}
                          className="mt-1 h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"
                        />
                      </label>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.unavailable ? (
                        <Button type="button" size="sm" variant="secondary" onClick={() => { void openSubstitutionPanel(item.inventoryItemId) }}>
                          Find substitutions
                        </Button>
                      ) : (
                        <Button type="button" size="sm" variant="secondary" onClick={() => { void markUnavailable(item.inventoryItemId) }}>
                          Mark unavailable
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {substitutionTargetId ? (
            <div className="mt-4 rounded-md border border-neutral-200 bg-white p-3">
              <p className="text-sm font-semibold text-neutral-900">Substitution Panel</p>
              {substitutionSuggestions.length === 0 ? (
                <p className="mt-2 text-xs text-neutral-600">No substitutions available right now.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {substitutionSuggestions.map((suggestion) => (
                    <li key={suggestion.inventoryItemId} className="rounded-md border border-neutral-200 bg-neutral-50 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-neutral-900">{suggestion.name}</p>
                          <p className="text-xs text-neutral-600">
                            {formatMoney(suggestion.cost)} / {suggestion.unit}
                          </p>
                        </div>
                        <p className={suggestion.costDelta > 0 ? 'text-xs text-red-700' : 'text-xs text-emerald-700'}>
                          {suggestion.costDelta > 0 ? '+' : '-'}{formatMoney(Math.abs(suggestion.costDelta))}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="mt-2"
                        onClick={() => {
                          setPreviewSubstitution({
                            targetId: substitutionTargetId,
                            suggestion,
                          })
                        }}
                      >
                        Preview
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" onClick={confirmSubstitution} disabled={!previewSubstitution}>
                  Confirm
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setSubstitutionTargetId(null)
                    setSubstitutionSuggestions([])
                    setPreviewSubstitution(null)
                  }}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  )
}
