import { useState, useRef, useEffect } from 'react'
import clsx from 'clsx'

export type Expression = 'neutral' | 'happy' | 'sad' | 'thinking' | 'surprised'

interface DigitalHumanProps {
  /** 表情：根据对话内容切换 */
  expression?: Expression
  /** 是否正在说话（用于口型同步） */
  isSpeaking?: boolean
  /** 语音音量 0-1，用于口型开合幅度 */
  speechLevel?: number
  /** 是否启用呼吸与眨眼动画 */
  animate?: boolean
  /** 是否启用肢体动作 */
  bodyMotion?: boolean
  /** 点击数字人触发，例如开启实时对话 */
  onClick?: () => void
  /** 是否处于实时对话模式，用于展示提示文案 */
  realtimeMode?: boolean
  /** 纯净模式：仅渲染数字人，不显示底部文案 */
  minimal?: boolean
  className?: string
}

const EPSILON_SRC = '/digital-human/previews/Hiyori/Hiyori.png'
const BASE_AVATAR_SCALE = 2.05

function getExpressionFilter(expression: Expression): string {
  switch (expression) {
    case 'happy':
      return 'saturate(1.08) brightness(1.04)'
    case 'sad':
      return 'saturate(0.9) brightness(0.95)'
    case 'surprised':
      return 'saturate(1.1) brightness(1.06)'
    case 'thinking':
      return 'saturate(0.95) contrast(1.02)'
    default:
      return 'none'
  }
}

function isNearBlack(r: number, g: number, b: number) {
  return r < 68 && g < 68 && b < 68
}

function isVeryDark(r: number, g: number, b: number) {
  return r < 38 && g < 38 && b < 38
}

function buildTransparentAvatar(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(src)
        return
      }

      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const { data, width, height } = imageData
      const visited = new Uint8Array(width * height)
      const queue = new Uint32Array(width * height)
      let head = 0
      let tail = 0

      const enqueueIfBg = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return
        const idx = y * width + x
        if (visited[idx]) return
        const di = idx * 4
        const r = data[di]
        const g = data[di + 1]
        const b = data[di + 2]
        const a = data[di + 3]
        if (a === 0 || isNearBlack(r, g, b)) {
          visited[idx] = 1
          queue[tail++] = idx
        }
      }

      for (let x = 0; x < width; x++) {
        enqueueIfBg(x, 0)
        enqueueIfBg(x, height - 1)
      }
      for (let y = 0; y < height; y++) {
        enqueueIfBg(0, y)
        enqueueIfBg(width - 1, y)
      }

      while (head < tail) {
        const idx = queue[head++]
        const x = idx % width
        const y = (idx / width) | 0
        const di = idx * 4
        data[di + 3] = 0
        enqueueIfBg(x - 1, y)
        enqueueIfBg(x + 1, y)
        enqueueIfBg(x, y - 1)
        enqueueIfBg(x, y + 1)
      }

      const hasTransparentNeighbor = (x: number, y: number) => {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true
            const ni = (ny * width + nx) * 4
            if (data[ni + 3] === 0) return true
          }
        }
        return false
      }

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const di = (y * width + x) * 4
          if (data[di + 3] === 0) continue
          const r = data[di]
          const g = data[di + 1]
          const b = data[di + 2]
          if (isNearBlack(r, g, b) && hasTransparentNeighbor(x, y)) {
            data[di + 3] = 0
          }
        }
      }

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const di = (y * width + x) * 4
          if (data[di + 3] === 0) continue
          const r = data[di]
          const g = data[di + 1]
          const b = data[di + 2]
          if (isVeryDark(r, g, b)) {
            data[di + 3] = 0
          }
        }
      }

      ctx.putImageData(imageData, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => resolve(src)
    img.src = src
  })
}

export default function DigitalHuman({
  expression = 'neutral',
  isSpeaking = false,
  speechLevel = 0,
  animate = true,
  bodyMotion = true,
  onClick,
  realtimeMode = false,
  minimal = false,
  className,
}: DigitalHumanProps) {
  const [breath, setBreath] = useState(0)
  const [sway, setSway] = useState(0)
  const [bob, setBob] = useState(0)
  const [blinkScale, setBlinkScale] = useState(1)
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null)
  const blinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    buildTransparentAvatar(EPSILON_SRC).then((result) => {
      if (!cancelled) {
        setAvatarSrc(result)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 眨眼：随机间隔触发
  useEffect(() => {
    if (!animate) return
    const scheduleNext = () => {
      const delay = 2000 + Math.random() * 3000
      blinkTimeoutRef.current = setTimeout(() => {
        setBlinkScale(0.94)
        setTimeout(() => setBlinkScale(1), 150)
        scheduleNext()
      }, delay)
    }
    scheduleNext()
    return () => {
      if (blinkTimeoutRef.current) {
        clearTimeout(blinkTimeoutRef.current)
      }
    }
  }, [animate])

  // 呼吸 + 轻微摇摆
  useEffect(() => {
    if (!animate && !bodyMotion) return
    const tick = (t: number) => {
      const tSec = t / 1000
      if (animate) {
        setBreath(Math.sin(tSec * 1.2) * 0.5 + 0.5) // 0~1 呼吸周期
      }
      if (bodyMotion) {
        setSway(Math.sin(tSec * 0.5) * 1) // 减小左右摇摆，避免角色看起来歪
        setBob(Math.sin(tSec * 0.8) * 2) // 轻微上下浮动
      }
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [animate, bodyMotion])

  const breathScale = 1 + (animate ? (breath * 0.04 - 0.02) : 0)
  const speechBoost = isSpeaking ? Math.min(0.08, speechLevel * 0.12) : 0
  const imageFilter = getExpressionFilter(expression)
  const imageTransform = `translateY(${bob}px) scale(${(breathScale + speechBoost) * BASE_AVATAR_SCALE}) rotate(${sway}deg) scaleY(${blinkScale})`

  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center w-full',
        onClick &&
          'cursor-pointer select-none hover:opacity-90 active:scale-[0.98] transition-transform',
        className
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={onClick ? (realtimeMode ? '点击关闭实时对话' : '点击开启实时对话') : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      <div className="w-full flex items-center justify-center mt-16 sm:mt-20 pt-6 sm:pt-8 mb-7 sm:mb-8">
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt="Digital human appearance"
            className="w-full h-auto max-w-[270px] max-h-[324px] sm:max-w-[310px] sm:max-h-[372px] md:max-w-[340px] md:max-h-[408px] lg:max-w-[380px] lg:max-h-[456px] portrait:max-h-[340px] landscape:max-md:max-h-[260px] object-contain select-none pointer-events-none"
            style={{
              transform: imageTransform,
              transformOrigin: 'center bottom',
              filter: imageFilter,
              transition: 'transform 120ms linear, filter 180ms ease-out',
            }}
            draggable={false}
          />
        ) : (
          <div
            className="w-full h-[324px] sm:h-[372px] md:h-[408px] lg:h-[456px] max-w-[270px] sm:max-w-[310px] md:max-w-[340px] lg:max-w-[380px] portrait:h-[340px] landscape:max-md:h-[260px]"
            aria-hidden="true"
          />
        )}
      </div>
      {!minimal && (
        <>
          <p className="mt-1 sm:mt-2 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
            {realtimeMode ? '实时对话已开启 · 回复将语音播报' : '数字人助手'}
          </p>
          {onClick && !realtimeMode && (
            <p className="mt-0.5 text-[11px] sm:text-xs text-primary-500 dark:text-primary-400">
              点击开启实时对话
            </p>
          )}
        </>
      )}
    </div>
  )
}
