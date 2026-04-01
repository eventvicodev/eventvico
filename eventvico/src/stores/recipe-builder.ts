import { create } from 'zustand'

// Recipe builder UI state — server data is managed by TanStack Query, NOT here
type RecipeBuilderState = {
  activeIngredientId: string | null
  panelOpen: boolean
  setActiveIngredient: (id: string | null) => void
  openPanel: () => void
  closePanel: () => void
}

export const useRecipeBuilderStore = create<RecipeBuilderState>((set) => ({
  activeIngredientId: null,
  panelOpen: false,
  setActiveIngredient: (id) => set({ activeIngredientId: id }),
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
}))
