import { useToastStore } from '@/stores/useToastStore'

export default function Toast() {
  const { message, visible, hide } = useToastStore()

  if (!visible) return null

  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-4 py-2.5 rounded-lg bg-gray-800 dark:bg-gray-700 text-white text-sm shadow-lg pointer-events-auto"
    >
      {message}
      <button
        type="button"
        onClick={hide}
        className="ml-2 inline text-gray-300 hover:text-white"
        aria-label="关闭"
      >
        ×
      </button>
    </div>
  )
}
