import { useState, useCallback, useRef } from 'react'
import { Upload, X, FileText, Film } from 'lucide-react'
import clsx from 'clsx'

/** 允许的扩展名与 MIME 类型 */
const ACCEPT_CONFIG = {
  image: { extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'], mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] },
  video: { extensions: ['mp4', 'mov', 'webm'], mimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'] },
  document: {
    extensions: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt'],
    mimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
    ],
  },
} as const

const ALL_ACCEPT = [
  ...ACCEPT_CONFIG.image.extensions,
  ...ACCEPT_CONFIG.video.extensions,
  ...ACCEPT_CONFIG.document.extensions,
].join(',')

const ACCEPT_MIME = [
  ...ACCEPT_CONFIG.image.mimeTypes,
  ...ACCEPT_CONFIG.video.mimeTypes,
  ...ACCEPT_CONFIG.document.mimeTypes,
]

function getFileCategory(file: File): 'image' | 'video' | 'document' {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const mime = file.type?.toLowerCase()
  if (ACCEPT_CONFIG.image.extensions.some((e) => e === ext) || ACCEPT_CONFIG.image.mimeTypes.includes(mime))
    return 'image'
  if (ACCEPT_CONFIG.video.extensions.some((e) => e === ext) || ACCEPT_CONFIG.video.mimeTypes.includes(mime))
    return 'video'
  return 'document'
}

function isValidFileType(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const mime = file.type?.toLowerCase()
  return (
    ALL_ACCEPT.includes(ext ?? '') ||
    ACCEPT_MIME.some((m) => mime === m)
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface FileItem {
  id: string
  file: File
  category: 'image' | 'video' | 'document'
  previewUrl?: string
  status: 'pending' | 'uploading' | 'done' | 'error'
  progress: number
  error?: string
}

interface FileUploadProps {
  /** 选择/上传变更后的文件列表（含上传状态） */
  value?: FileItem[]
  onChange?: (items: FileItem[]) => void
  /** 是否多选 */
  multiple?: boolean
  /** 最大文件数，不传则不限制 */
  maxFiles?: number
  /** 自定义上传逻辑；不传则仅选择不自动上传，进度可外部设置 */
  onUpload?: (file: File, reportProgress: (percent: number) => void) => Promise<void>
  /** 上传失败时的错误信息 */
  getUploadError?: (file: File, err: unknown) => string
  /** 禁用 */
  disabled?: boolean
  className?: string
}

export default function FileUpload({
  value,
  onChange,
  multiple = true,
  maxFiles,
  onUpload,
  getUploadError,
  disabled = false,
  className,
}: FileUploadProps) {
  const [internalItems, setInternalItems] = useState<FileItem[]>([])
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const items = value ?? internalItems
  const setItems = useCallback(
    (updater: (prev: FileItem[]) => FileItem[]) => {
      const next = updater(value ?? internalItems)
      if (onChange) onChange(next)
      else setInternalItems(next)
    },
    [value, internalItems, onChange]
  )

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList)
      const valid = files.filter(isValidFileType)
      const invalidCount = files.length - valid.length
      if (invalidCount > 0) {
        console.warn(`已忽略 ${invalidCount} 个不支持的文件类型。仅支持：图片(jpg,png,gif,webp)、视频(mp4,mov,webm)、文档(pdf,doc,docx,ppt,pptx,txt)`)
      }
      const current = value ?? internalItems
      const remaining = maxFiles != null ? Math.max(0, maxFiles - current.length) : valid.length
      const toAdd = valid.slice(0, remaining).map((file) => {
        const category = getFileCategory(file)
        const id = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`
        const item: FileItem = {
          id,
          file,
          category,
          status: 'pending',
          progress: 0,
        }
        if (category === 'image') {
          item.previewUrl = URL.createObjectURL(file)
        }
        return item
      })
      setItems(() => [...current, ...toAdd])
    },
    [value, internalItems, maxFiles, setItems]
  )

  const removeItem = useCallback(
    (id: string) => {
      const current = value ?? internalItems
      const item = current.find((i) => i.id === id)
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      setItems((prev) => prev.filter((i) => i.id !== id))
    },
    [value, internalItems, setItems]
  )

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    setDragActive(e.type === 'dragenter' || e.type === 'dragover')
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (disabled) return
    const files = e.dataTransfer?.files
    if (files?.length) addFiles(files)
  }

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files?.length) addFiles(files)
    e.target.value = ''
  }

  const startUpload = useCallback(async () => {
    if (!onUpload) return
    const current = value ?? internalItems
    const pending = current.filter((i) => i.status === 'pending')
    for (const item of pending) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, status: 'uploading' as const, progress: 0 } : i
        )
      )
      try {
        await onUpload(item.file, (percent) => {
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id ? { ...i, progress: percent } : i
            )
          )
        })
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, status: 'done' as const, progress: 100 } : i
          )
        )
      } catch (err) {
        const message = getUploadError?.(item.file, err) ?? '上传失败'
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, status: 'error' as const, error: message } : i
          )
        )
      }
    }
  }, [value, internalItems, onUpload, getUploadError, setItems])

  const acceptStr = `.${ACCEPT_CONFIG.image.extensions.join(',.')},.${ACCEPT_CONFIG.video.extensions.join(',.')},.${ACCEPT_CONFIG.document.extensions.join(',.')}`

  return (
    <div className={clsx('space-y-2 sm:space-y-3', className)}>
      {/* 拖拽区域 */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={clsx(
          'border-2 border-dashed rounded-lg sm:rounded-xl p-4 sm:p-5 md:p-6 text-center transition-colors cursor-pointer touch-manipulation',
          dragActive && 'border-primary-500 bg-primary-50 dark:bg-primary-900/20',
          !dragActive && 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          accept={acceptStr}
          onChange={handleSelect}
          className="hidden"
          disabled={disabled}
        />
        <Upload className="w-8 h-8 sm:w-10 sm:h-10 mx-auto text-gray-400 dark:text-gray-500 mb-1.5 sm:mb-2" />
        <p className="text-sm text-gray-600 dark:text-gray-400 px-2">
          拖拽文件到此处，或点击选择
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500 mt-1 px-2">
          支持图片(jpg/png/gif/webp)、视频(mp4/mov/webm)、文档(pdf/doc/docx/ppt/pptx/txt)
        </p>
        {maxFiles != null && (
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">最多 {maxFiles} 个文件</p>
        )}
      </div>

      {/* 文件列表与预览 */}
      {items.length > 0 && (
        <div className="space-y-1.5 sm:space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50"
            >
              {/* 预览 */}
              <div className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                {item.category === 'image' && item.previewUrl ? (
                  <img
                    src={item.previewUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : item.category === 'video' ? (
                  <Film className="w-6 h-6 text-gray-500" />
                ) : (
                  <FileText className="w-6 h-6 text-gray-500" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                  {item.file.name}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {formatSize(item.file.size)}
                  {item.status === 'error' && item.error && (
                    <span className="text-red-500 ml-1">· {item.error}</span>
                  )}
                </p>
                {(item.status === 'uploading' || item.status === 'pending') && onUpload && (
                  <div className="mt-1.5 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full transition-all duration-300"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  removeItem(item.id)
                }}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-700"
                aria-label="移除"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}

          {onUpload && items.some((i) => i.status === 'pending') && (
            <button
              type="button"
              onClick={startUpload}
              className="w-full py-2.5 sm:py-2 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 transition-colors touch-manipulation"
            >
              开始上传
            </button>
          )}
        </div>
      )}
    </div>
  )
}
