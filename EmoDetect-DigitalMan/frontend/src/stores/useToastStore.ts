import { create } from 'zustand'

interface ToastState {
  message: string
  visible: boolean
  show: (msg: string) => void
  hide: () => void
}

export const useToastStore = create<ToastState>((set) => ({
  message: '',
  visible: false,
  show: (message) => {
    set({ message, visible: true })
    setTimeout(() => set({ visible: false }), 2500)
  },
  hide: () => set({ visible: false }),
}))
