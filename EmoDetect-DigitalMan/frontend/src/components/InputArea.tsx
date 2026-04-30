import { useState, useRef, useCallback } from 'react'
import { Send, Paperclip, Mic, Square, Smile } from 'lucide-react'
import clsx from 'clsx'
import { MAX_FILE_SIZE_LABEL } from '@/utils/api'

const DEFAULT_ROWS = 2
const MAX_ROWS = 8

const EMOJI_LIST = [
  '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂',
  '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '🙂', '🤗',
  '👍', '👎', '👏', '🙌', '🤝', '🙏', '❤️', '💙', '💚', '💛',
  '🔥', '⭐', '✨', '💯', '✅', '❌', '📌', '💡', '🎉', '🚀',
]

interface PendingImage {
  url: string
  fileName?: string
}

interface PendingVideo {
  url: string
  fileName?: string
}

interface PendingFile {
  fileName?: string
}

interface InputAreaProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onFileSelect?: (files: File[]) => void
  onVoiceRecordStart?: () => void | Promise<void>
  onVoiceRecordStop?: () => void | Promise<void>
  /**
   * 与 useVoiceRecorder().isRecording 同步，避免「开始录音」异步失败时 UI 仍显示录制中、停止后无有效音频。
   * 不传时回退为内部 state（仅兼容旧用法）。
   */
  voiceRecording?: boolean
  /** 待发送的图片（有图时无文字也可发送） */
  pendingImage?: PendingImage | null
  /** 待发送的视频（有视频时无文字也可发送） */
  pendingVideo?: PendingVideo | null
  /** 待发送的语音（有条时无文字也可发送） */
  pendingVoice?: { url: string; fileName: string } | null
  /** 待发送的文件（有文件时无文字也可发送） */
  pendingFile?: PendingFile | null
  placeholder?: string
  disabled?: boolean
}

export default function InputArea({
  value,
  onChange,
  onSubmit,
  onFileSelect,
  onVoiceRecordStart,
  onVoiceRecordStop,
  voiceRecording,
  pendingImage = null,
  pendingVideo = null,
  pendingVoice = null,
  pendingFile = null,
  placeholder = '输入消息...',
  disabled = false,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [fallbackVoiceRecording, setFallbackVoiceRecording] = useState(false)
  const isRecording =
    voiceRecording !== undefined
      ? voiceRecording
      : fallbackVoiceRecording
  const canSubmit = value.trim() || pendingImage != null || pendingVideo != null || pendingVoice != null || pendingFile != null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || disabled) return
    onSubmit()
  }

  const insertAtCursor = useCallback((before: string, after = '') => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const text = el.value
    const newText = text.slice(0, start) + before + (text.slice(start, end) || '') + after + text.slice(end)
    onChange(newText)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + before.length + (end - start) + after.length
      el.setSelectionRange(pos, pos)
    })
  }, [onChange])

  const insertEmoji = useCallback((emoji: string) => {
    insertAtCursor(emoji, '')
  }, [insertAtCursor])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files?.length && onFileSelect) {
      onFileSelect(Array.from(files))
    }
    e.target.value = ''
  }

  const handleVoiceClick = async () => {
    if (isRecording) {
      if (voiceRecording === undefined) setFallbackVoiceRecording(false)
      await onVoiceRecordStop?.()
    } else {
      // 仅在旧用法（未传 voiceRecording）下使用 fallback 状态
      if (voiceRecording === undefined) setFallbackVoiceRecording(true)
      try {
        await onVoiceRecordStart?.()
      } catch {
        if (voiceRecording === undefined) setFallbackVoiceRecording(false)
      }
    }
  }

  return (
    <div className="border-t border-gray-200 dark:border-zinc-700/60 bg-white dark:bg-[#121212] p-2 sm:p-3 md:p-3">
      <form onSubmit={handleSubmit} className="flex gap-1.5 sm:gap-2 pt-1 sm:pt-2">
        {/* 左侧：附件、表情 */}
        <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.txt"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="p-2 sm:p-2.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800/70 disabled:opacity-50 touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
            title={`上传文件（图片、视频、文档），单文件最大 ${MAX_FILE_SIZE_LABEL}`}
            aria-label="上传文件"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              disabled={disabled}
              className="p-2 sm:p-2.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800/70 disabled:opacity-50 touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
              title="表情"
              aria-label="选择表情"
            >
              <Smile className="w-5 h-5" />
            </button>
            {emojiOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  aria-hidden
                  onClick={() => setEmojiOpen(false)}
                />
                <div className="absolute bottom-full left-0 mb-1 p-2 rounded-xl bg-white dark:bg-[#1a1a1c] border border-gray-200 dark:border-zinc-700/60 shadow-lg z-20 w-[min(280px,90vw)] sm:w-64 max-h-40 sm:max-h-48 overflow-y-auto">
                  <div className="grid grid-cols-8 gap-0.5 sm:gap-1">
                    {EMOJI_LIST.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          insertEmoji(emoji)
                          setEmojiOpen(false)
                        }}
                        className="p-1.5 text-base sm:text-lg hover:bg-gray-100 dark:hover:bg-zinc-800/70 rounded touch-manipulation"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 多行输入框 */}
        <div className="flex-1 min-w-0 flex flex-col min-h-[44px]">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(e)
              }
            }}
            placeholder={placeholder}
            rows={DEFAULT_ROWS}
            className={clsx(
              'w-full min-h-[44px] sm:min-h-[52px] md:min-h-[60px] max-h-[120px] sm:max-h-[160px] md:max-h-[180px] resize-y px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg sm:rounded-xl text-base',
              'border border-gray-200 dark:border-zinc-700/60 bg-gray-50 dark:bg-[#1a1a1c]',
              'text-gray-800 dark:text-gray-200 placeholder-gray-400',
              'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent'
            )}
          />
        </div>

        {/* 语音 + 发送 */}
        <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={handleVoiceClick}
            disabled={disabled}
            className={clsx(
              'p-2.5 sm:p-3 rounded-lg sm:rounded-xl transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center',
              isRecording
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800/70 disabled:opacity-50'
            )}
            title={isRecording ? '停止录制' : '语音输入'}
            aria-label={isRecording ? '停止录制' : '语音输入'}
          >
            {isRecording ? (
              <Square className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>
          <button
            type="submit"
            disabled={!canSubmit || disabled}
            className="p-2.5 sm:p-3 rounded-lg sm:rounded-xl bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center active:scale-95"
            aria-label="发送"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  )
}
