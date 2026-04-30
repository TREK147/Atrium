import { useState, useRef, useCallback, useEffect } from 'react'

/** 波形数据长度（用于 canvas 等） */
const WAVEFORM_LENGTH = 64

/** 浏览器语音识别类型 */
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
  }
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList
  resultIndex: number
}

export interface UseVoiceRecorderReturn {
  // ---------- 录音 ----------
  isRecording: boolean
  startRecording: () => Promise<void>
  stopRecording: () => Promise<Blob | null>
  recordedBlob: Blob | null
  recordedUrl: string | null

  // ---------- 实时语音转文本 ----------
  transcript: string
  interimTranscript: string
  isListening: boolean

  // ---------- 波形可视化 ----------
  waveformData: number[]
  audioLevel: number

  // ---------- 打断（停止录音与播放） ----------
  stopAll: () => void

  // ---------- 播放控制 ----------
  isPlaying: boolean
  playbackProgress: number
  playbackDuration: number
  playRecorded: (blob?: Blob) => void
  pausePlayback: () => void
  stopPlayback: () => void
  error: string | null
}

export function useVoiceRecorder(): UseVoiceRecorderReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [waveformData, setWaveformData] = useState<number[]>(Array(WAVEFORM_LENGTH).fill(0))
  const [audioLevel, setAudioLevel] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackProgress, setPlaybackProgress] = useState(0)
  const [playbackDuration, setPlaybackDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const animationFrameRef = useRef<number>(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playbackBlobUrlRef = useRef<string | null>(null)
  const workerRef = useRef<Worker | null>(null)

  // 释放录音 URL
  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    }
  }, [recordedUrl])

  // 停止所有并清理
  const stopAll = useCallback(() => {
    // 停止录音
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.state !== 'inactive' && mediaRecorderRef.current.stop()
      } catch (_) {}
      mediaRecorderRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setIsRecording(false)
    chunksRef.current = []

    // 停止语音识别
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort()
      } catch (_) {}
      recognitionRef.current = null
    }
    setIsListening(false)
    setInterimTranscript('')

    // 停止波形
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    setWaveformData(Array(WAVEFORM_LENGTH).fill(0))
    setAudioLevel(0)
    if (scriptProcessorRef.current) {
      try {
        scriptProcessorRef.current.disconnect()
      } catch (_) {}
      scriptProcessorRef.current = null
    }
    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close()
    }
    audioContextRef.current = null
    analyserRef.current = null

    // 停止播放
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    setIsPlaying(false)
    setPlaybackProgress(0)
  }, [])

  // 开始录音
  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      setTranscript('')
      setInterimTranscript('')

      // MediaRecorder 录制（须传入 mimeType，否则部分浏览器默认类型与 chunks 不一致）
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : ''
      if (typeof MediaRecorder === 'undefined') {
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        throw new Error('当前浏览器不支持 MediaRecorder 录音')
      }
      const recorder =
        mime && MediaRecorder.isTypeSupported(mime)
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        if (chunksRef.current.length) {
          const blobType = recorder.mimeType || mime || 'audio/webm'
          const blob = new Blob(chunksRef.current, { type: blobType })
          setRecordedBlob(blob)
          const prev = recordedUrl
          if (prev) URL.revokeObjectURL(prev)
          setRecordedUrl(URL.createObjectURL(blob))
        }
      }
      // 使用分片间隔，确保各浏览器持续产出 ondataavailable；无参 start() 在部分环境下收尾数据不可靠
      try {
        recorder.start(250)
      } catch {
        try {
          recorder.start(100)
        } catch {
          recorder.start()
        }
      }

      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      audioContextRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      // 仅在 MediaRecorder + 音频图已成功建立后再标为录制中，避免后续步骤抛错时 catch 里关麦导致「从未进入录制态」或秒关麦克风
      setIsRecording(true)

      // 优先使用 Web Worker 处理波形，减轻主线程负担
      try {
        if (!workerRef.current) {
          workerRef.current = new Worker(
            new URL('../workers/voice.worker.ts', import.meta.url),
            { type: 'module' }
          )
          workerRef.current.onmessage = (ev: MessageEvent<{ type: string; level?: number; waveform?: number[] }>) => {
            if (ev.data.type === 'result') {
              if (ev.data.waveform) setWaveformData(ev.data.waveform)
              if (ev.data.level != null) setAudioLevel(ev.data.level)
            }
          }
        }
        const worker = workerRef.current
        const bufferSize = 4096
        const processor = ctx.createScriptProcessor(bufferSize, 1, 1)
        scriptProcessorRef.current = processor
        const gainNode = ctx.createGain()
        gainNode.gain.value = 0
        source.connect(processor)
        processor.connect(gainNode)
        gainNode.connect(ctx.destination)
        processor.onaudioprocess = (e) => {
          if (!worker) return
          const input = e.inputBuffer.getChannelData(0)
          worker.postMessage({ type: 'process', data: input.buffer.slice(0) })
        }
      } catch {
        // 回退：主线程 AnalyserNode
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.8
        source.connect(analyser)
        analyserRef.current = analyser
        const bufferLength = analyser.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        const updateWaveform = () => {
          if (!analyserRef.current) return
          analyserRef.current.getByteTimeDomainData(dataArray)
          const slice = Math.floor(bufferLength / WAVEFORM_LENGTH)
          const arr: number[] = []
          let sum = 0
          for (let i = 0; i < WAVEFORM_LENGTH; i++) {
            const v = (dataArray[i * slice] - 128) / 128
            arr.push(v)
            sum += Math.abs(v)
          }
          setWaveformData(arr)
          setAudioLevel(Math.min(1, sum / WAVEFORM_LENGTH))
          animationFrameRef.current = requestAnimationFrame(updateWaveform)
        }
        updateWaveform()
      }

      // 语音识别（可选）：start() 在部分浏览器会抛错或与 MediaRecorder 争用麦克风，绝不能拖垮主录音流程
      const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition()
          recognition.continuous = true
          recognition.interimResults = true
          recognition.lang = 'zh-CN'
          recognition.onresult = (e: SpeechRecognitionEvent) => {
            let interim = ''
            let final = ''
            for (let i = e.resultIndex; i < e.results.length; i++) {
              const r = e.results[i]
              const t = r[0].transcript
              if (r.isFinal) final += t
              else interim += t
            }
            if (final) setTranscript((prev) => prev + final)
            setInterimTranscript(interim)
          }
          recognition.onend = () => setIsListening(false)
          recognition.onerror = () => setIsListening(false)
          recognitionRef.current = recognition
          recognition.start()
          setIsListening(true)
        } catch {
          recognitionRef.current = null
          setIsListening(false)
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '无法访问麦克风'
      setError(message)
      setIsRecording(false)
      setIsListening(false)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      if (mediaRecorderRef.current) {
        try {
          if (mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop()
        } catch (_) {}
        mediaRecorderRef.current = null
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort()
        } catch (_) {}
        recognitionRef.current = null
      }
      if (scriptProcessorRef.current) {
        try {
          scriptProcessorRef.current.disconnect()
        } catch (_) {}
        scriptProcessorRef.current = null
      }
      if (audioContextRef.current?.state !== 'closed') {
        try {
          audioContextRef.current?.close()
        } catch (_) {}
      }
      audioContextRef.current = null
      analyserRef.current = null
      throw new Error(message)
    }
  }, [recordedUrl])

  // 停止录音
  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    const buildBlobFromChunks = (typeHint?: string): Blob | null => {
      const parts = [...chunksRef.current]
      if (!parts.length) return null
      const blob = new Blob(parts, { type: typeHint || 'audio/webm' })
      return blob.size > 0 ? blob : null
    }

    // 用户可能在 startRecording 尚未完成（getUserMedia / start 未执行）时点「停止」，短暂等待录音器就绪
    const deadline = Date.now() + 2500
    while (Date.now() < deadline) {
      const r = mediaRecorderRef.current
      if (r && r.state !== 'inactive') break
      await new Promise<void>((res) => setTimeout(res, 40))
    }

    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
        const blob = buildBlobFromChunks(mediaRecorderRef.current?.mimeType || 'audio/webm')
        if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        setIsRecording(false)
        if (recognitionRef.current) {
          try { recognitionRef.current.stop() } catch (_) {}
          recognitionRef.current = null
        }
        setIsListening(false)
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
        setWaveformData(Array(WAVEFORM_LENGTH).fill(0))
        setAudioLevel(0)
        if (blob) {
          setRecordedBlob(blob)
          setRecordedUrl((u) => {
            if (u) URL.revokeObjectURL(u)
            return URL.createObjectURL(blob)
          })
          resolve(blob)
          return
        }
        resolve(null)
        return
      }
      const mr = mediaRecorderRef.current
      try {
        if (typeof mr.requestData === 'function') mr.requestData()
      } catch (_) {}
      const mimeType = mr.mimeType || 'audio/webm'
      mr.onstop = () => {
        mediaRecorderRef.current = null

        const cleanupStreamAndUi = () => {
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop())
            streamRef.current = null
          }
          if (recognitionRef.current) {
            try {
              recognitionRef.current.stop()
            } catch (_) {}
            recognitionRef.current = null
          }
          setIsRecording(false)
          setIsListening(false)
          if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
          setWaveformData(Array(WAVEFORM_LENGTH).fill(0))
          setAudioLevel(0)
          if (scriptProcessorRef.current) {
            try {
              scriptProcessorRef.current.disconnect()
            } catch (_) {}
            scriptProcessorRef.current = null
          }
          if (audioContextRef.current?.state !== 'closed') {
            try {
              audioContextRef.current?.close()
            } catch (_) {}
          }
          audioContextRef.current = null
          analyserRef.current = null
        }

        const finish = (blob: Blob | null) => {
          cleanupStreamAndUi()
          if (blob && blob.size > 0) {
            setRecordedBlob(blob)
            setRecordedUrl((u) => {
              if (u) URL.revokeObjectURL(u)
              return URL.createObjectURL(blob)
            })
            resolve(blob)
            return
          }
          resolve(null)
        }

        /** 每次重试都从 chunksRef 读取：最终 ondataavailable 可能晚于 onstop；之前误用固定 snapshot 导致重试无效 */
        const tryResolve = (attempt: number) => {
          const blob = buildBlobFromChunks(mimeType)
          if (blob) {
            finish(blob)
            return
          }
          // 低性能设备/浏览器上最终音频分片可能明显晚于 onstop；适当拉长等待窗口，减少误判为空
          if (attempt < 36) {
            setTimeout(
              () => tryResolve(attempt + 1),
              attempt < 8 ? 40 : attempt < 20 ? 120 : 220
            )
          } else {
            finish(null)
          }
        }
        queueMicrotask(() => tryResolve(0))
      }
      mr.stop()
    })
  }, [])

  // 播放
  const playRecorded = useCallback((blob?: Blob) => {
    const toPlay = blob ?? recordedBlob
    if (!toPlay) return
    setError(null)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (playbackBlobUrlRef.current) URL.revokeObjectURL(playbackBlobUrlRef.current)
    const url = URL.createObjectURL(toPlay)
    playbackBlobUrlRef.current = url
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onloadedmetadata = () => setPlaybackDuration(audio.duration)
    audio.ontimeupdate = () => setPlaybackProgress(audio.currentTime / (audio.duration || 1))
    audio.onended = () => {
      setIsPlaying(false)
      setPlaybackProgress(1)
      if (playbackBlobUrlRef.current) {
        URL.revokeObjectURL(playbackBlobUrlRef.current)
        playbackBlobUrlRef.current = null
      }
      audioRef.current = null
    }
    audio.onerror = () => {
      setError('播放失败')
      setIsPlaying(false)
    }
    audio.play()
    setIsPlaying(true)
  }, [recordedBlob])

  const pausePlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      setIsPlaying(false)
    }
  }, [])

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current = null
    }
    if (playbackBlobUrlRef.current) {
      URL.revokeObjectURL(playbackBlobUrlRef.current)
      playbackBlobUrlRef.current = null
    }
    setIsPlaying(false)
    setPlaybackProgress(0)
  }, [])

  // 卸载时清理
  useEffect(() => {
    return () => {
      stopAll()
      if (playbackBlobUrlRef.current) URL.revokeObjectURL(playbackBlobUrlRef.current)
    }
  }, [stopAll])

  return {
    isRecording,
    startRecording,
    stopRecording,
    recordedBlob,
    recordedUrl,
    transcript,
    interimTranscript,
    isListening,
    waveformData,
    audioLevel,
    stopAll,
    isPlaying,
    playbackProgress,
    playbackDuration,
    playRecorded,
    pausePlayback,
    stopPlayback,
    error,
  }
}
