import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import {
  ApiError,
  listFaceStudents,
  recognizeFaceImage,
  registerFaceStudent,
  type FaceDetection,
  type FaceStudent,
} from '@/utils/api'
import { useToastStore } from '@/stores/useToastStore'

/** EmotiEffLib 返回首字母大写英文类名，这里统一小写再映射 */
const EMOTION_ZH: Record<string, string> = {
  anger: '愤怒',
  contempt: '轻蔑',
  disgust: '厌恶',
  fear: '恐惧',
  happiness: '高兴',
  neutral: '平静',
  sadness: '悲伤',
  surprise: '惊讶',
}

function getEmotionLabel(raw: string): string {
  const key = String(raw).trim().toLowerCase()
  return EMOTION_ZH[key] ?? raw
}

/** 两次识别请求之间的间隔：上一帧请求返回后再等这么久（2 核 / 小内存服务器请勿改太小） */
const RECOGNIZE_INTERVAL_MS = 5000
/** 摄像头尚未产出有效画面时的重试间隔 */
const NO_FRAME_RETRY_MS = 400
/** 上传前最长边上限，减轻后端解码与推理压力 */
const UPLOAD_MAX_SIDE = 640
/** JPEG 质量，略降可减小体积与内存峰值 */
const UPLOAD_JPEG_QUALITY = 0.55

export default function FaceMonitorPage() {
  const navigate = useNavigate()
  const toast = useToastStore((s) => s.show)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const runningRef = useRef(false)
  const lastRecognizeErrorToastAt = useRef(0)

  const [students, setStudents] = useState<FaceStudent[]>([])
  const [detections, setDetections] = useState<FaceDetection[]>([])
  const [frameSize, setFrameSize] = useState({ width: 640, height: 480 })
  const [loading, setLoading] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [recognizeError, setRecognizeError] = useState<string | null>(null)
  const [showLongWaitHint, setShowLongWaitHint] = useState(false)

  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')

  const activeDetections = useMemo(
    () => detections.filter((d) => d.student_id && d.student_id !== 'unknown'),
    [detections]
  )

  const unknownFaceCount = useMemo(
    () => detections.filter((d) => !d.student_id || d.student_id === 'unknown').length,
    [detections]
  )

  const loadStudents = useCallback(async () => {
    try {
      const list = await listFaceStudents({ limit: 200 })
      setStudents(list)
    } catch {
      toast('加载学生列表失败')
    }
  }, [toast])

  useEffect(() => {
    loadStudents()
  }, [loadStudents])

  /** 首次下载/加载模型常超过数十秒，避免用户误以为死机 */
  useEffect(() => {
    if (!loading && !registering) {
      setShowLongWaitHint(false)
      return
    }
    const t = window.setTimeout(() => setShowLongWaitHint(true), 45_000)
    return () => {
      window.clearTimeout(t)
    }
  }, [loading, registering])

  const stopLoop = () => {
    runningRef.current = false
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const stopCamera = () => {
    stopLoop()
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCapturing(false)
    setDetections([])
    setFrameSize({ width: 640, height: 480 })
    setLoading(false)
    setRecognizeError(null)
  }

  const startCamera = async () => {
    if (capturing) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCapturing(true)
      runningRef.current = true
      runRecognitionLoop()
    } catch {
      toast('无法访问摄像头，请检查浏览器权限')
    }
  }

  const grabFrameBase64 = (): string | null => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return null
    let vw = video.videoWidth || 0
    let vh = video.videoHeight || 0
    if (vw <= 0 || vh <= 0) return null

    const m = Math.max(vw, vh)
    if (m > UPLOAD_MAX_SIDE) {
      const s = UPLOAD_MAX_SIDE / m
      vw = Math.round(vw * s)
      vh = Math.round(vh * s)
    }

    canvas.width = vw
    canvas.height = vh
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, vw, vh)
    const dataUrl = canvas.toDataURL('image/jpeg', UPLOAD_JPEG_QUALITY)
    return dataUrl
  }

  const runRecognitionLoop = async () => {
    if (!runningRef.current) return
    if (document.visibilityState !== 'visible') {
      timerRef.current = window.setTimeout(runRecognitionLoop, RECOGNIZE_INTERVAL_MS)
      return
    }
    const image_base64 = grabFrameBase64()
    if (!image_base64) {
      timerRef.current = window.setTimeout(runRecognitionLoop, NO_FRAME_RETRY_MS)
      return
    }
    setLoading(true)
    try {
      const res = await recognizeFaceImage({ image_base64 })
      // 用户可能在请求返回前点了「停止」，避免旧结果再次画上检测框
      if (!runningRef.current) return
      setDetections(res.detections ?? [])
      setFrameSize({ width: res.width || 640, height: res.height || 480 })
      setRecognizeError(null)
    } catch (e) {
      if (!runningRef.current) return
      let msg = '识别接口异常'
      if (e instanceof ApiError) msg = e.message || msg
      else if (axios.isAxiosError(e)) {
        const d = e.response?.data as { error?: string; message?: string } | undefined
        msg = d?.error ?? d?.message ?? e.message ?? msg
      }
      setRecognizeError(msg)
      const now = Date.now()
      if (now - lastRecognizeErrorToastAt.current > 10_000) {
        lastRecognizeErrorToastAt.current = now
        toast(msg)
      }
    } finally {
      setLoading(false)
      if (runningRef.current) {
        timerRef.current = window.setTimeout(runRecognitionLoop, RECOGNIZE_INTERVAL_MS)
      }
    }
  }

  const handleRegister = async () => {
    const sid = studentId.trim()
    const nm = name.trim()
    if (!sid || !nm) {
      toast('请输入学号和姓名')
      return
    }
    if (!capturing) {
      toast('请先点击「启动摄像头」并等待画面出现')
      return
    }
    const image_base64 = grabFrameBase64()
    if (!image_base64) {
      toast('当前无法截取画面，请等待摄像头就绪后再试（画面需清晰、勿最小化窗口）')
      return
    }
    setRegistering(true)
    try {
      await registerFaceStudent({ student_id: sid, name: nm, image_base64 })
      toast('注册成功，已写入后端人脸库')
      setStudentId('')
      setName('')
      await loadStudents()
    } catch (e) {
      const fallback = '注册失败，请确认已登录、后端已启动，且画面中为清晰正脸'
      if (e instanceof ApiError) {
        toast(e.message || fallback)
      } else if (axios.isAxiosError(e)) {
        const data = e.response?.data as { error?: string } | undefined
        toast(data?.error ?? (e.message || fallback))
      } else {
        toast(fallback)
      }
    } finally {
      setRegistering(false)
    }
  }

  useEffect(() => () => stopCamera(), [])

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-[#0f0f10] dark:via-[#0f0f10] dark:to-[#131316]">
      <div className="mx-auto max-w-7xl p-4 md:p-6 space-y-4">
        <section className="rounded-2xl border border-gray-200/70 dark:border-zinc-700/60 bg-white/80 dark:bg-[#1a1a1c]/90 backdrop-blur p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-zinc-100">人脸识别 + 七类情绪识别</h2>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                type="button"
                onClick={() => navigate('/chat')}
                className="px-4 py-2 rounded-lg bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-[#1f1f22] dark:text-zinc-100 dark:border-zinc-700/60 dark:hover:bg-zinc-800/70"
              >
                返回聊天
              </button>
              <button
                type="button"
                onClick={startCamera}
                disabled={capturing}
                className="px-4 py-2 rounded-lg bg-zinc-700 text-white hover:bg-zinc-600 disabled:opacity-50"
              >
                启动摄像头
              </button>
              <button
                type="button"
                onClick={stopCamera}
                disabled={!capturing}
                className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
              >
                停止
              </button>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
          <div className="xl:col-span-2 self-start rounded-2xl border border-gray-200 dark:border-zinc-700/60 bg-black/90 overflow-hidden relative">
            {recognizeError && (
              <div className="absolute left-0 right-0 bottom-0 z-20 px-3 py-2 bg-red-900/90 text-red-100 text-xs sm:text-sm leading-snug border-t border-red-700">
                <span className="font-medium">识别接口错误：</span>
                {recognizeError}
              </div>
            )}
            <video ref={videoRef} className="block w-full h-auto max-h-[72vh] object-contain" muted playsInline />
            <canvas ref={canvasRef} className="hidden" />
            {detections.map((d, idx) => {
              const [x1, y1, x2, y2] = d.box
              const w = frameSize.width || 1
              const h = frameSize.height || 1
              const left = `${(x1 / w) * 100}%`
              const top = `${(y1 / h) * 100}%`
              const width = `${((x2 - x1) / w) * 100}%`
              const height = `${((y2 - y1) / h) * 100}%`
              return (
                <div key={`${d.student_id}-${idx}`} className="absolute border-2 border-emerald-400 rounded-md" style={{ left, top, width, height }}>
                  <div className="absolute -top-6 left-0 text-xs px-2 py-0.5 rounded bg-emerald-500 text-white whitespace-nowrap">
                    {d.student_id}:{getEmotionLabel(d.emotion)} ({d.confidence.toFixed(2)})
                  </div>
                </div>
              )
            })}
            {loading && (
              <div className="absolute right-3 top-3 z-10 max-w-[min(100%,20rem)] text-right space-y-1">
                <div className="inline-block px-2 py-1 rounded bg-black/50 text-white text-xs">识别中...</div>
                {showLongWaitHint && (
                  <div className="block text-[11px] leading-snug text-white/90 bg-black/55 rounded px-2 py-1.5 mt-1">
                    若已等待较久：多为后端首次下载权重或 CPU 加载模型。请看运行 Flask 的终端是否出现
                    <span className="font-mono"> [face]</span> 日志；也可先在 backend 执行{' '}
                    <span className="font-mono text-[10px]">python check_face_setup.py --download-models</span>{' '}
                    预下载后再试。
                  </div>
                )}
              </div>
            )}
            {registering && showLongWaitHint && !loading && (
              <div className="absolute left-3 bottom-12 z-10 max-w-[min(100%,22rem)] text-[11px] leading-snug text-white/95 bg-black/55 rounded px-2 py-1.5">
                注册也需等人脸引擎就绪（与首次「识别」共用同一次模型加载）。请看后端终端{' '}
                <span className="font-mono">[face]</span> 输出。
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 dark:border-zinc-700/60 bg-white dark:bg-[#1a1a1c] p-4">
              <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-100 mb-3">注册人脸</h3>
              <div className="space-y-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="姓名"
                  className="w-full rounded-lg border border-gray-300 dark:border-zinc-700/60 bg-white dark:bg-[#131316] px-3 py-2 text-sm"
                />
                <input
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  placeholder="学号"
                  className="w-full rounded-lg border border-gray-300 dark:border-zinc-700/60 bg-white dark:bg-[#131316] px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={handleRegister}
                  disabled={registering}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-700 text-white hover:bg-zinc-600 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {registering ? '注册中…' : '采集当前画面并注册'}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 dark:border-zinc-700/60 bg-white dark:bg-[#1a1a1c] p-4">
              <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-100">当前识别</h3>
              <div className="mt-2 space-y-2 text-sm">
                {detections.length > 0 && activeDetections.length === 0 && (
                  <p className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 px-3 py-2 text-xs leading-relaxed">
                    画面中已检测到 {unknownFaceCount} 张人脸，但身份均为「未入库 / 未匹配」。请先在左侧「采集当前画面并注册」录入人脸库，或调整光线与角度。画面上方绿框仍会显示情绪与 unknown 学号。
                  </p>
                )}
                {!capturing && (
                  <p className="text-gray-500 dark:text-gray-400">请先启动摄像头</p>
                )}
                {capturing && detections.length === 0 && !loading && !recognizeError && (
                  <p className="text-gray-500 dark:text-gray-400">
                    {students.length === 0
                      ? '未检测到人脸，或人脸库为空；正脸入镜后可先注册。'
                      : '未检测到人脸，请正脸入镜；若已注册仍长期如此，请检查光线与摄像头。'}
                  </p>
                )}
                {activeDetections.map((d, i) => (
                  <div key={`${d.student_id}-${i}`} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-100/80 dark:bg-zinc-800/45 px-3 py-2">
                    <p className="font-medium text-zinc-700 dark:text-zinc-200">{d.student_id}</p>
                    <p className="text-zinc-600/90 dark:text-zinc-300/90">
                      {getEmotionLabel(d.emotion)} / 置信度 {d.confidence.toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 dark:border-zinc-700/60 bg-white dark:bg-[#1a1a1c] p-4">
              <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-100">已注册学生</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-2">共 {students.length} 人（已过滤逻辑删除）</p>
              <div className="max-h-48 overflow-y-auto text-sm space-y-1">
                {students.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-md px-2 py-1.5 bg-gray-50 dark:bg-[#131316]">
                    <span className="font-medium">{s.student_id}</span>
                    <span className="text-gray-500">{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
