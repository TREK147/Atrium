import { useState, useRef, useEffect } from 'react'
import { Copy, Check, FileText, Image as ImageIcon, Volume2 } from 'lucide-react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import clsx from 'clsx'
import type { Message } from '@/types'
import { resolveApiAssetUrl } from '@/utils/api'
import { useToastStore } from '@/stores/useToastStore'

interface MessageBubbleProps {
  message: Message
  /** 文件类型时可传入大小（字节），用于展示 */
  fileSize?: number
}

/** 全局仅允许一个助手语音在播；后点击会打断先前播放。 */
let activeAssistantAudio: HTMLAudioElement | null = null

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getCopyContent(message: Message): string {
  if (message.type === 'text') return message.content
  if (message.type === 'file' && message.fileName) return message.fileName
  if (message.type === 'image' && message.fileUrl) return message.fileUrl
  if (message.type === 'video' && message.fileUrl) return message.fileUrl
  if (message.type === 'voice' && message.fileUrl) return message.fileUrl
  return message.content
}

export default function MessageBubble({ message, fileSize }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)
  const isUser = message.sender === 'user'
  const isTextMessage = message.type === 'text'
  const ttsRef = useRef<HTMLAudioElement | null>(null)
  const toast = useToastStore((s) => s.show)

  useEffect(() => {
    return () => {
      if (activeAssistantAudio && ttsRef.current && activeAssistantAudio === ttsRef.current) {
        activeAssistantAudio.pause()
        activeAssistantAudio.currentTime = 0
        activeAssistantAudio = null
      } else {
        ttsRef.current?.pause()
      }
      ttsRef.current = null
    }
  }, [])

  const handlePlayAssistantAudio = () => {
    if (isUser || !message.fileUrl) return
    const url = resolveApiAssetUrl(message.fileUrl)
    if (!ttsRef.current) ttsRef.current = new Audio()
    const el = ttsRef.current

    if (activeAssistantAudio && activeAssistantAudio !== el) {
      activeAssistantAudio.pause()
      activeAssistantAudio.currentTime = 0
    }
    activeAssistantAudio = el

    el.pause()
    el.currentTime = 0
    el.src = url
    el.load()
    el.onended = () => {
      if (activeAssistantAudio === el) activeAssistantAudio = null
    }
    el.onpause = () => {
      if (activeAssistantAudio === el && el.currentTime === 0) activeAssistantAudio = null
    }
    void el.play().catch(() => {
      if (activeAssistantAudio === el) activeAssistantAudio = null
      toast('无法播放语音，请确认后端已生成音频且可访问上传文件')
    })
  }

  const handleCopy = async () => {
    const text = getCopyContent(message)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  const timeStr = format(new Date(message.timestamp), 'HH:mm', { locale: zhCN })

  return (
    <div
      className={clsx(
        'flex gap-2 sm:gap-3 max-w-[95%] sm:max-w-[90%] md:max-w-[85%]',
        isUser && 'flex-row-reverse ml-auto'
      )}
    >
      {/* 气泡主体 */}
      <div
        className={clsx(
          'w-fit rounded-xl sm:rounded-2xl px-3 py-2 sm:px-4 sm:py-2.5 text-sm shadow-sm',
          isUser
            ? 'bg-primary-500 text-white'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
        )}
        style={isTextMessage ? { maxWidth: 'min(30em, 72vw)' } : undefined}
      >
        {/* 内容区 */}
        <div className="break-words">
          {message.type === 'text' && <p className="whitespace-pre-wrap">{message.content}</p>}

          {message.type === 'image' && (
            <div className="space-y-2">
              {message.fileUrl ? (
                <a
                  href={message.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg overflow-hidden max-w-full border border-white/20"
                >
                  <img
                    src={message.fileUrl}
                    alt={message.content || '图片'}
                    loading="lazy"
                    decoding="async"
                    className="max-h-48 sm:max-h-56 md:max-h-64 w-auto object-contain rounded-lg"
                  />
                </a>
              ) : (
                <div className="flex items-center gap-2 py-2 text-gray-500 dark:text-gray-400">
                  <ImageIcon className="w-4 h-4 shrink-0" />
                  <span>图片消息</span>
                </div>
              )}
              {message.content && (
                <p className="whitespace-pre-wrap text-sm opacity-90 mt-1">
                  {message.content}
                </p>
              )}
            </div>
          )}

          {message.type === 'video' && (
            <div className="space-y-2">
              {message.fileUrl ? (
                <video
                  src={message.fileUrl}
                  controls
                  className="max-w-full max-h-64 rounded-lg border border-gray-200 dark:border-gray-600"
                  preload="metadata"
                />
              ) : null}
              {message.fileName && (
                <p className="text-xs opacity-80 truncate">{message.fileName}</p>
              )}
              {message.content && (
                <p className="whitespace-pre-wrap text-sm opacity-90 mt-1">
                  {message.content}
                </p>
              )}
            </div>
          )}

          {message.type === 'file' && (
            <div className="space-y-2">
              <a
                href={message.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={clsx(
                  'flex items-center gap-3 p-3 rounded-lg border min-w-0',
                  isUser
                    ? 'border-white/30 hover:bg-white/10'
                    : 'border-gray-300 dark:border-gray-600 hover:bg-gray-200/50 dark:hover:bg-gray-600/50'
                )}
              >
                <FileText className="w-8 h-8 shrink-0 opacity-80" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">
                    {message.fileName || '未命名文件'}
                  </p>
                  {fileSize != null && (
                    <p className="text-xs opacity-80 mt-0.5">
                      {formatFileSize(fileSize)}
                    </p>
                  )}
                  <p className="text-xs opacity-80 mt-0.5">点击下载</p>
                </div>
              </a>
              {message.content && (
                <p className="whitespace-pre-wrap text-sm opacity-90">
                  {message.content}
                </p>
              )}
            </div>
          )}

          {message.type === 'voice' && (
            <div className="flex flex-col gap-2 py-1">
              <div className="flex items-center gap-2">
                <span className="opacity-80">🎤 语音消息</span>
                {message.fileName && (
                  <span className="text-xs opacity-70 truncate">{message.fileName}</span>
                )}
              </div>
              {message.fileUrl && (
                <audio
                  src={message.fileUrl}
                  controls
                  className="max-w-full h-8"
                  preload="metadata"
                />
              )}
              {message.content && (
                <p className="whitespace-pre-wrap text-sm opacity-90">
                  {message.content}
                </p>
              )}
            </div>
          )}
        </div>

        {/* 底部：时间 + 复制 */}
        <div
          className={clsx(
            'flex items-center gap-1.5 sm:gap-2 mt-1.5 sm:mt-2 pt-1 sm:pt-1.5 border-t',
            isUser ? 'border-white/20' : 'border-gray-200 dark:border-gray-600'
          )}
        >
          <span className="text-xs opacity-80">{timeStr}</span>
          {!isUser && message.fileUrl && message.type === 'text' && (
            <button
              type="button"
              onClick={handlePlayAssistantAudio}
              className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors touch-manipulation flex items-center justify-center"
              title="播放语音"
              aria-label="播放助手语音"
            >
              <Volume2 className="w-3.5 h-3.5 opacity-80" />
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors touch-manipulation flex items-center justify-center"
            title="复制"
            aria-label="复制消息"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-300 dark:text-green-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 opacity-80" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
