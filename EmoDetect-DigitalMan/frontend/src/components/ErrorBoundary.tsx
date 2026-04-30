import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/** 捕获子组件运行时错误，避免白屏 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 dark:bg-gray-900 p-4">
          <h1 className="text-xl font-medium text-gray-800 dark:text-gray-200">页面出错了</h1>
          <pre className="text-sm text-red-600 dark:text-red-400 bg-gray-100 dark:bg-gray-800 p-4 rounded max-w-full overflow-auto">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
