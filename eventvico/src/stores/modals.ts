import { create } from 'zustand'

type ModalId = 'quote-send' | 'inventory-add' | 'client-create' | 'event-create' | 'recipe-confirm'

type ModalState = {
  openModal: ModalId | null
  open: (id: ModalId) => void
  close: () => void
}

export const useModalStore = create<ModalState>((set) => ({
  openModal: null,
  open: (id) => set({ openModal: id }),
  close: () => set({ openModal: null }),
}))
