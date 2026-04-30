import { create } from 'zustand'
import type { User, Conversation, Message } from '@/types'

interface ChatState {
  // ---------- 用户状态 ----------
  user: User | null
  setUser: (user: User | null) => void
  /** 是否正在根据 token 恢复用户（未完成前不判定为未登录） */
  authRestoring: boolean
  setAuthRestoring: (v: boolean) => void
  logout: () => void
  isLoggedIn: () => boolean

  // ---------- 对话列表 ----------
  conversations: Conversation[]
  setConversations: (list: Conversation[]) => void
  addConversation: (conv: Conversation) => void
  updateConversation: (id: string, patch: Partial<Conversation>) => void
  removeConversation: (id: string) => void

  // ---------- 当前对话消息 ----------
  currentConversationId: string | null
  messages: Message[]
  setCurrentConversationId: (id: string | null) => void
  setMessages: (messages: Message[]) => void
  addMessage: (message: Message) => void
  updateMessage: (id: string, patch: Partial<Message>) => void
  clearMessages: () => void

  // ---------- UI 状态 ----------
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  // 用户状态
  user: null,
  setUser: (user) => set({ user }),
  authRestoring: false,
  setAuthRestoring: (v) => set({ authRestoring: v }),
  logout: () =>
    set({
      user: null,
      currentConversationId: null,
      messages: [],
      conversations: [],
    }),
  isLoggedIn: () => get().user != null,

  // 对话列表
  conversations: [],
  setConversations: (list) => set({ conversations: list }),
  addConversation: (conv) =>
    set((s) => ({ conversations: [conv, ...s.conversations] })),
  updateConversation: (id, patch) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, ...patch } : c
      ),
    })),
  removeConversation: (id) =>
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      currentConversationId:
        s.currentConversationId === id ? null : s.currentConversationId,
      messages: s.currentConversationId === id ? [] : s.messages,
    })),

  // 当前对话消息
  currentConversationId: null,
  messages: [],
  /** 仅切换当前会话 id，不清空 messages；切换/新建会话时由调用方 setMessages 或 clearMessages */
  setCurrentConversationId: (id) => set({ currentConversationId: id }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),
  updateMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  clearMessages: () => set({ messages: [] }),

  // UI 状态
  sidebarOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}))
