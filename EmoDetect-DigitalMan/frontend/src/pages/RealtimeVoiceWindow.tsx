import { useEffect, useRef, useState, useCallback } from 'react'
import DigitalHuman from '@/components/DigitalHuman'
import {
  ApiError,
  startRealtimeSession,
  appendRealtimeSessionAudio,
  subscribeRealtimeSessionEvents,
  stopRealtimeSession,
  type RealtimeSessionEvent,
} from '@/utils/api'

const REALTIME_OUTPUT_SAMPLE_RATE = 24000
const REALTIME_INPUT_SAMPLE_RATE = 16000

export default function RealtimeVoiceWindow() {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [speechLevel, setSpeechLevel] = useState(0)

  const sessionIdRef = useRef<string | null>(null)
  const eventsAbortRef = useRef<AbortController | null>(null)
  const audioSendChainRef = useRef<Promise<void>>(Promise.resolve())

  const micStreamRef = useRef<MediaStream | null>(null)
  const micContextRef = useRef<AudioContext | null>(null)
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)

  const outputQueueRef = useRef<string[]>([])
  const outputPlayingRef = useRef(false)
  const outputContextRef = useRef<AudioContext | null>(null)

  const downsampleFloat32ToPcm16Base64 = useCallback((
    input: Float32Array,
    sourceRate: number,
    targetRate = REALTIME_INPUT_SAMPLE_RATE
  ) => {
    if (!input.length) return ''
    const ratio = sourceRate / targetRate
    const outLength = Math.max(1, Math.floor(input.length / ratio))
    const pcm16 = new Int16Array(outLength)
    let offset = 0
    for (let i = 0; i < outLength; i++) {
      const nextOffset = Math.min(input.length, Math.floor((i + 1) * ratio))
      let sum = 0
      let count = 0
      for (let j = offset; j < nextOffset; j++) {
        sum += input[j] ?? 0
        count++
      }
      offset = nextOffset
      const sample = count > 0 ? sum / count : 0
      const clamped = Math.max(-1, Math.min(1, sample))
      pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    }
    const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    return btoa(binary)
  }, [])

  const processOutputQueue = useCallback(() => {
    if (outputPlayingRef.current || outputQueueRef.current.length === 0) return
    const b64 = outputQueueRef.current.shift()
    if (!b64) {
      processOutputQueue()
      return
    }
    outputPlayingRef.current = true
    setIsSpeaking(true)
    setSpeechLevel(0.5)

    const cleanup = () => {
      outputPlayingRef.current = false
      setIsSpeaking(false)
      setSpeechLevel(0)
      processOutputQueue()
    }

    try {
      const binary = atob(b64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const numSamples = Math.floor(bytes.length / 2)
      if (!numSamples) {
        cleanup()
        return
      }
      const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, numSamples)
      const float32 = new Float32Array(numSamples)
      for (let i = 0; i < numSamples; i++) {
        const s = int16[i]!
        float32[i] = s < 0 ? s / 0x8000 : s / 0x7fff
      }
      let ctx = outputContextRef.current
      if (!ctx || ctx.state === 'closed') {
        ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({
          sampleRate: REALTIME_OUTPUT_SAMPLE_RATE,
        })
        outputContextRef.current = ctx
      }
      const play = () => {
        try {
          const buffer = ctx!.createBuffer(1, numSamples, REALTIME_OUTPUT_SAMPLE_RATE)
          buffer.getChannelData(0)!.set(float32)
          const source = ctx!.createBufferSource()
          source.buffer = buffer
          source.connect(ctx!.destination)
          source.onended = cleanup
          source.addEventListener('error', cleanup)
          source.start(0)
        } catch {
          cleanup()
        }
      }
      if (ctx.state === 'suspended') ctx.resume().then(play).catch(cleanup)
      else play()
    } catch {
      cleanup()
    }
  }, [])

  const playRealtimePcmBase64 = useCallback((base64: string) => {
    if (!base64) return
    outputQueueRef.current.push(base64)
    processOutputQueue()
  }, [processOutputQueue])

  const cleanupMic = useCallback(async () => {
    if (micProcessorRef.current) {
      try { micProcessorRef.current.disconnect() } catch { /* ignore */ }
      micProcessorRef.current = null
    }
    if (micSourceRef.current) {
      try { micSourceRef.current.disconnect() } catch { /* ignore */ }
      micSourceRef.current = null
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop())
      micStreamRef.current = null
    }
    if (micContextRef.current && micContextRef.current.state !== 'closed') {
      try { await micContextRef.current.close() } catch { /* ignore */ }
    }
    micContextRef.current = null
  }, [])

  const cleanupOutput = useCallback(async () => {
    outputQueueRef.current = []
    outputPlayingRef.current = false
    setIsSpeaking(false)
    setSpeechLevel(0)
    if (outputContextRef.current && outputContextRef.current.state !== 'closed') {
      try { await outputContextRef.current.close() } catch { /* ignore */ }
    }
    outputContextRef.current = null
  }, [])

  const stopAll = useCallback(async () => {
    eventsAbortRef.current?.abort()
    eventsAbortRef.current = null
    await cleanupMic()
    await cleanupOutput()
    const sid = sessionIdRef.current
    sessionIdRef.current = null
    if (sid) {
      try {
        await stopRealtimeSession(sid)
      } catch {
        // ignore on close
      }
    }
  }, [cleanupMic, cleanupOutput])

  const startMicStreaming = useCallback(async (sessionId: string) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    micStreamRef.current = stream
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    micContextRef.current = ctx
    const source = ctx.createMediaStreamSource(stream)
    micSourceRef.current = source
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    micProcessorRef.current = processor
    const gainNode = ctx.createGain()
    gainNode.gain.value = 0
    source.connect(processor)
    processor.connect(gainNode)
    gainNode.connect(ctx.destination)
    processor.onaudioprocess = (ev) => {
      if (!sessionIdRef.current || sessionIdRef.current !== sessionId) return
      const input = ev.inputBuffer.getChannelData(0)
      const b64 = downsampleFloat32ToPcm16Base64(input, ev.inputBuffer.sampleRate)
      if (!b64) return
      audioSendChainRef.current = audioSendChainRef.current
        .then(() => appendRealtimeSessionAudio(sessionId, b64))
        .catch(() => undefined)
    }
  }, [downsampleFloat32ToPcm16Base64])

  const handleEvent = useCallback((event: RealtimeSessionEvent) => {
    if (event.type === 'audio_delta') {
      playRealtimePcmBase64(event.audio)
      return
    }
    if (event.type === 'response_done') return
    if (event.type === 'error') {
      console.error(event.error || '实时对话异常')
      return
    }
    if (event.type === 'session_closed') {
      setTimeout(() => {
        window.close()
      }, 300)
    }
  }, [playRealtimePcmBase64])

  useEffect(() => {
    let mounted = true
    const boot = async () => {
      try {
        const { sessionId } = await startRealtimeSession()
        if (!mounted) return
        sessionIdRef.current = sessionId
        const controller = new AbortController()
        eventsAbortRef.current = controller
        subscribeRealtimeSessionEvents(sessionId, handleEvent, controller.signal).catch((err) => {
          if (!mounted) return
          const msg = err instanceof ApiError ? err.message : '实时语音连接中断'
          console.error(msg)
          window.close()
        })
        await startMicStreaming(sessionId)
        if (!mounted) return
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : '无法开启实时语音，请检查麦克风权限'
        console.error(msg)
        if (mounted) window.close()
      }
    }
    boot()
    return () => {
      mounted = false
      stopAll().catch(() => undefined)
    }
  }, [handleEvent, startMicStreaming, stopAll])

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <DigitalHuman
        expression="neutral"
        isSpeaking={isSpeaking}
        speechLevel={speechLevel}
        animate
        bodyMotion
        realtimeMode
        minimal
        className="w-full max-w-[300px]"
      />
    </div>
  )
}
