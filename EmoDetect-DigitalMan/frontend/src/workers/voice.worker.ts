/**
 * Web Worker：接收原始音频样本，计算波形与音量等级，减轻主线程负担
 */

const WAVEFORM_LENGTH = 64

function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]
    sum += v * v
  }
  return Math.sqrt(sum / samples.length)
}

function downsampleToWaveform(samples: Float32Array, length: number): number[] {
  const step = samples.length / length
  const out: number[] = []
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * step)
    const end = Math.min(Math.floor((i + 1) * step), samples.length)
    let sum = 0
    for (let j = start; j < end; j++) sum += samples[j]
    out.push(sum / (end - start || 1))
  }
  return out
}

self.onmessage = (e: MessageEvent<{ type: string; data: ArrayBuffer }>) => {
  const { type, data } = e.data
  if (type !== 'process' || !data) return
  const samples = new Float32Array(data)
  const level = Math.min(1, rms(samples) * 4) // 放大便于显示
  const waveform = downsampleToWaveform(samples, WAVEFORM_LENGTH)
  self.postMessage({ type: 'result', level, waveform })
}
