/**
 * 聊天会话与消息的 localStorage 持久化（按用户隔离）。
 * 刷新后仅恢复对话列表，当前界面为“新聊天”；从历史记录点选可恢复该会话消息。
 */
import type { Conversation, Message } from '@/types'

const CONVERSATIONS_KEY = 'chat_conversations'
const MESSAGES_KEY = 'chat_messages'

function storageKey(userId: string, suffix: string): string {
  return `${suffix}_${userId}`
}

function toPlainConversation(c: Conversation): Record<string, unknown> {
  return {
    ...c,
    updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt,
  }
}

function fromPlainConversation(p: Record<string, unknown>): Conversation {
  return {
    ...p,
    updatedAt: new Date((p.updatedAt as string) || Date.now()),
  } as Conversation
}

function toPlainMessage(m: Message): Record<string, unknown> {
  return {
    ...m,
    timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
  }
}

function fromPlainMessage(p: Record<string, unknown>): Message {
  return {
    ...p,
    timestamp: new Date((p.timestamp as string) || Date.now()),
  } as Message
}

export function loadConversations(userId: string): Conversation[] {
  try {
    const key = storageKey(userId, CONVERSATIONS_KEY)
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const arr = JSON.parse(raw) as Record<string, unknown>[]
    return (arr || []).map(fromPlainConversation)
  } catch {
    return []
  }
}

export function saveConversations(userId: string, list: Conversation[]): void {
  try {
    const key = storageKey(userId, CONVERSATIONS_KEY)
    localStorage.setItem(key, JSON.stringify(list.map(toPlainConversation)))
  } catch {
    // ignore
  }
}

export function loadMessages(userId: string, conversationId: string): Message[] {
  try {
    const key = storageKey(userId, MESSAGES_KEY)
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const map = JSON.parse(raw) as Record<string, Record<string, unknown>[]>
    const arr = map?.[conversationId]
    if (!Array.isArray(arr)) return []
    return arr.map(fromPlainMessage)
  } catch {
    return []
  }
}

export function saveMessages(
  userId: string,
  conversationId: string,
  messages: Message[]
): void {
  try {
    const key = storageKey(userId, MESSAGES_KEY)
    const raw = localStorage.getItem(key)
    const map: Record<string, Record<string, unknown>[]> = raw ? JSON.parse(raw) : {}
    map[conversationId] = messages.map(toPlainMessage)
    localStorage.setItem(key, JSON.stringify(map))
  } catch {
    // ignore
  }
}

export function deleteMessagesForConversation(
  userId: string,
  conversationId: string
): void {
  try {
    const key = storageKey(userId, MESSAGES_KEY)
    const raw = localStorage.getItem(key)
    if (!raw) return
    const map = JSON.parse(raw) as Record<string, unknown>
    delete map[conversationId]
    localStorage.setItem(key, JSON.stringify(map))
  } catch {
    // ignore
  }
}
