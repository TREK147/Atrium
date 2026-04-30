import { useRef, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Message } from '@/types'
import MessageBubble from '@/components/MessageBubble'

const ESTIMATE_HEIGHT = 80
const OVERSCAN = 5

interface VirtualMessageListProps {
  messages: Message[]
  className?: string
  /** 滚动到底部的锚元素 ref，用于新消息时滚动 */
  scrollToEndRef?: React.RefObject<HTMLDivElement | null>
}

export default function VirtualMessageList({
  messages,
  className = '',
  scrollToEndRef,
}: VirtualMessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATE_HEIGHT,
    overscan: OVERSCAN,
  })

  const items = virtualizer.getVirtualItems()

  // 新消息时滚动到底部
  useEffect(() => {
    if (messages.length === 0) return
    const lastIndex = messages.length - 1
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(lastIndex, { align: 'end', behavior: 'smooth' })
    })
  }, [messages.length])

  if (messages.length === 0) {
    return (
      <div
        className={`flex-1 min-h-0 flex items-center justify-center text-gray-500 dark:text-gray-400 text-sm px-4 ${className}`}
      >
        发送消息开始对话
      </div>
    )
  }

  return (
    <div
      ref={parentRef}
      className={`flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 md:p-4 pb-2 ${className}`}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {items.map((virtualRow) => {
          const msg = messages[virtualRow.index]
          return (
            <div
              key={msg.id}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="pb-3 sm:pb-4"
            >
              <div
                className={msg.sender === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <MessageBubble message={msg} />
              </div>
            </div>
          )
        })}
      </div>
      <div ref={scrollToEndRef} />
    </div>
  )
}
