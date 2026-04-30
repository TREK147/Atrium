import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import type { Message } from '@/types'
import MessageBubble from '@/components/MessageBubble'
import InputArea from '@/components/InputArea'
import DigitalHuman from '@/components/DigitalHuman'
import VirtualMessageList from '@/components/VirtualMessageList'
import WeeklyCalendar from '@/components/WeeklyCalendar'
import ScheduleSuggestion from '@/components/ScheduleSuggestion'
import AssistantNoticeBar from '@/components/AssistantNoticeBar'
import { useChatStore } from '@/stores/useChatStore'
import { useToastStore } from '@/stores/useToastStore'
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder'
import {
  chatWithAIStream,
  convertAudioBlobToWavFile,
  uploadFile,
  ApiError,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  createConversation,
  invalidateConversationMessages,
  getInterestNewsFromWeb,
  consumeInterestNewsCard,
  getAssistantChatPrompts,
  getProactivePending,
  ackProactiveTrigger,
  type ProactiveTrigger,
} from '@/utils/api'

const VIRTUAL_SCROLL_THRESHOLD = 30
type InterestCardPayload = {
  newsItems?: Array<{ title: string; link?: string }>
  newsInterests?: string[]
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

interface PendingImage {
  url: string
  fileName: string
}

interface PendingVideo {
  url: string
  fileName: string
}

interface PendingVoice {
  blob: Blob
  url: string
  fileName: string
}

interface PendingAttachment {
  url: string
  fileName: string
  category: 'file' | 'voice'
}

const DEFAULT_PROMPT_POOL = [
  '你可以对我说：“帮我梳理一下今天的实验进度安排。”',
  '你可以对我说：“今天太忙了，帮我把不紧急的日程延后吧。”',
  '你可以对我说：“帮我生成一份明早的日程简报。”',
  '你可以对我说：“下午要开组会，提醒我提前准备好材料。”',
  '你可以对我说：“今天状态不太好，想找人聊聊天。”',
  '你可以对我说：“最近写代码总是疯狂报错，我有点烦躁。”',
  '你可以对我说：“感觉最近压力好大，能给我放段舒缓的音乐吗？”',
  '你可以对我说：“我有点焦虑，帮我做个深呼吸放松吧。”',
  '你可以对我说：“今天合肥天气不错，有推荐的骑行路线吗？”',
  '你可以对我说：“周末想带无人机去大蜀山航拍，帮我查查风力。”',
  '你可以对我说：“一直坐着有点累，提醒我起来活动一下。”',
  '你可以对我说：“晚上想看部电影放松，有什么好推荐吗？”',
  '你可以对我说：“用脱口秀的语气给我讲个笑话吧。”',
  '你可以对我说：“考考我刚才背的那些软工知识点。”',
  '不知道聊什么？试试对我说：“给我分享一个今天的好消息。”',
]

export default function ChatPage() {
  const location = useLocation()
  const [inputValue, setInputValue] = useState('')
  const [isAiLoading, setIsAiLoading] = useState(false)
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null)
  const [pendingVideo, setPendingVideo] = useState<PendingVideo | null>(null)
  const [pendingVoice, setPendingVoice] = useState<PendingVoice | null>(null)
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null)
  const [realtimePopupOpen, setRealtimePopupOpen] = useState(false)
  const [proactive, setProactive] = useState<ProactiveTrigger | null>(null)
  const [guideStep, setGuideStep] = useState<number>(-1)
  const [guideHighlightRect, setGuideHighlightRect] = useState<DOMRect | null>(null)
  const [guideFocusMessageId, setGuideFocusMessageId] = useState<string | null>(null)
  const [guideFocusMessageContent, setGuideFocusMessageContent] = useState<string | null>(null)
  const [guideFadingOut, setGuideFadingOut] = useState(false)
  const [guideFocusMessageHidden, setGuideFocusMessageHidden] = useState(false)
  const [guideHintVisible, setGuideHintVisible] = useState(true)
  const [guideTransitioningToAvatar, setGuideTransitioningToAvatar] = useState(false)
  const [promptIndex, setPromptIndex] = useState(0)
  const [promptFade, setPromptFade] = useState(true)
  const [promptPool, setPromptPool] = useState<string[]>(DEFAULT_PROMPT_POOL)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const realtimeWindowRef = useRef<Window | null>(null)
  const realtimeWindowWatchRef = useRef<number | null>(null)
  const digitalHumanWrapRef = useRef<HTMLDivElement | null>(null)
  const digitalHumanTargetRef = useRef<HTMLDivElement | null>(null)
  const proactiveBubbleRef = useRef<HTMLButtonElement | null>(null)
  const guideProactiveMsgSentRef = useRef(false)
  const guideProactiveClickLockRef = useRef(false)

  const messages = useChatStore((s) => s.messages)
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const user = useChatStore((s) => s.user)
  const addMessage = useChatStore((s) => s.addMessage)
  const setMessages = useChatStore((s) => s.setMessages)
  const updateMessage = useChatStore((s) => s.updateMessage)
  const addConversation = useChatStore((s) => s.addConversation)
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId)
  const updateConversation = useChatStore((s) => s.updateConversation)
  const toast = useToastStore((s) => s.show)
  const { startRecording, stopRecording, isRecording } = useVoiceRecorder()

  const useVirtualScroll = messages.length >= VIRTUAL_SCROLL_THRESHOLD
  const shouldHideGuideMessage = (msg: Message) =>
    guideFocusMessageHidden
    && (
      msg.id === guideFocusMessageId
      || (guideFocusMessageContent != null && msg.sender === 'ai' && msg.content === guideFocusMessageContent)
    )
  const renderedMessages = messages.filter((msg) => !shouldHideGuideMessage(msg))

  const refreshProactive = useCallback(async () => {
    try {
      const p = await getProactivePending()
      setProactive(p)
    } catch {
      setProactive(null)
    }
  }, [])

  useEffect(() => {
    if (messages.length > 0 && !useVirtualScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, useVirtualScroll])

  useEffect(() => {
    let alive = true
    const loadPrompts = async () => {
      try {
        const res = await getAssistantChatPrompts()
        const next = (res.prompts ?? []).map((x) => (x || '').trim()).filter(Boolean)
        if (!alive || next.length === 0) return
        setPromptPool(next)
      } catch {
        // keep defaults
      }
    }
    void loadPrompts()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!promptPool.length) return
    const interval = setInterval(() => {
      setPromptFade(false)
      setTimeout(() => {
        setPromptIndex((prev) => (prev + 1) % promptPool.length)
        setPromptFade(true)
      }, 1000)
    }, 7000) // 6秒停留 + 1秒切换
    return () => clearInterval(interval)
  }, [promptPool.length])

  useEffect(() => {
    if (!guideFocusMessageId) return
    const timer = window.setTimeout(() => {
      const target = document.querySelector(`[data-message-anchor-id="${guideFocusMessageId}"]`) as HTMLElement | null
      const scroller = messagesContainerRef.current
      if (target && scroller) {
        const targetTop = target.offsetTop
        const targetHeight = target.offsetHeight
        const nextTop = Math.max(0, targetTop - (scroller.clientHeight - targetHeight) / 2)
        scroller.scrollTo({ top: nextTop, behavior: 'smooth' })
      } else {
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 80)
    return () => {
      window.clearTimeout(timer)
    }
  }, [guideFocusMessageId, messages.length])

  useEffect(() => {
    return () => {
      if (realtimeWindowWatchRef.current != null) {
        window.clearInterval(realtimeWindowWatchRef.current)
      }
    }
  }, [])

  useEffect(() => {
    void refreshProactive()
    const timer = window.setInterval(() => {
      void refreshProactive()
    }, 6000)
    return () => {
      window.clearInterval(timer)
    }
  }, [refreshProactive])

  useEffect(() => {
    if (!location.pathname.startsWith('/chat')) return
    if (!user?.id) return
    // 首次登录欢迎流程未完成时，不展示新手引导，避免与“想怎么称呼你”弹窗冲突
    if (user.onboarding_done === false) {
      setGuideStep(-1)
      return
    }
    const guideVersionKey = `newbie-guide-chat-version:${user.id}`
    const latestGuideVersion = '2'
    const forceByQuery = new URLSearchParams(location.search).get('guide') === '1'
    const pending = window.localStorage.getItem(`newbie-guide-chat-pending:${user.id}`)
    const shouldReplayByVersion = window.localStorage.getItem(guideVersionKey) !== latestGuideVersion
    if (forceByQuery || pending === '1' || shouldReplayByVersion) {
      setGuideFadingOut(false)
      setGuideFocusMessageHidden(false)
      setGuideFocusMessageContent(null)
      setGuideHintVisible(true)
      setGuideTransitioningToAvatar(false)
      setGuideStep(0)
    }
  }, [user?.id, user?.onboarding_done, location.pathname, location.search])

  useEffect(() => {
    if (guideStep < 0) {
      setGuideHighlightRect(null)
      return
    }
    const measure = () => {
      const target =
        guideStep === 0
          ? digitalHumanTargetRef.current
          : guideStep === 1
            ? proactiveBubbleRef.current
            : guideStep === 2
              ? (guideFocusMessageId
                ? (document.querySelector(`[data-message-anchor-id="${guideFocusMessageId}"]`) as HTMLElement | null)
                : null)
              : guideStep === 3
                ? (document.querySelector('[data-guide="header-avatar-trigger"]') as HTMLElement | null)
                : ((document.querySelector('[data-guide="header-profile-entry"]') as HTMLElement | null)
                  ?? (document.querySelector('[data-guide="header-avatar-trigger"]') as HTMLElement | null))
      setGuideHighlightRect(target ? target.getBoundingClientRect() : null)
    }
    const raf = window.requestAnimationFrame(measure)
    const timer = window.setTimeout(measure, 120)
    const scroller = messagesContainerRef.current
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    scroller?.addEventListener('scroll', measure, { passive: true })
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(timer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      scroller?.removeEventListener('scroll', measure)
    }
  }, [guideStep, proactive, guideFocusMessageId, messages.length])

  useEffect(() => {
    if (guideStep !== 3 && guideStep !== 4) return
    const handleGuideTargetClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (guideStep === 3 && target.closest('[data-guide="header-avatar-trigger"]')) {
        window.setTimeout(() => {
          setGuideStep(4)
        }, 60)
        return
      }
      if (guideStep === 4 && target.closest('[data-guide="header-profile-entry"]')) {
        if (user?.id) {
          window.localStorage.setItem(`newbie-guide-chat-pending:${user.id}`, '0')
          window.localStorage.setItem(`newbie-guide-chat-version:${user.id}`, '2')
          window.localStorage.setItem(`newbie-guide-profile-pending:${user.id}`, '1')
        }
        setGuideStep(-1)
      }
    }
    document.addEventListener('click', handleGuideTargetClick, true)
    return () => {
      document.removeEventListener('click', handleGuideTargetClick, true)
    }
  }, [guideStep, user?.id])

  const handleDigitalHumanClick = useCallback(() => {
    const existing = realtimeWindowRef.current
    if (existing && !existing.closed) {
      existing.focus()
      return
    }
    const width = 420
    const height = 680
    const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - width) / 2))
    const top = Math.max(0, Math.floor(window.screenY + (window.outerHeight - height) / 2))
    const popup = window.open(
      '/realtime-window',
      'realtime-voice-window',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`
    )
    if (!popup) {
      toast('无法打开实时对话窗口，请检查浏览器弹窗拦截设置')
      return
    }
    realtimeWindowRef.current = popup
    setRealtimePopupOpen(true)
    popup.focus()

    if (realtimeWindowWatchRef.current != null) {
      window.clearInterval(realtimeWindowWatchRef.current)
    }
    realtimeWindowWatchRef.current = window.setInterval(() => {
      const w = realtimeWindowRef.current
      if (!w || w.closed) {
        if (realtimeWindowWatchRef.current != null) {
          window.clearInterval(realtimeWindowWatchRef.current)
          realtimeWindowWatchRef.current = null
        }
        realtimeWindowRef.current = null
        setRealtimePopupOpen(false)
      }
    }, 400)
  }, [toast])

  const handleAckProactive = useCallback(async () => {
    if (!proactive) return
    try {
      const res = await ackProactiveTrigger(proactive.id)
      const care = res?.careMessage
      if (care?.conversationId && care?.message && currentConversationId === care.conversationId) {
        addMessage({
          ...care.message,
          timestamp: care.message.timestamp ? new Date(care.message.timestamp) : new Date(),
        })
      }
    } catch {
      // ignore
    } finally {
      setProactive(null)
    }
  }, [proactive, currentConversationId, addMessage])

  const handleAckProactiveNoRefresh = useCallback(async () => {
    if (!proactive) return
    try {
      await ackProactiveTrigger(proactive.id)
    } catch {
      // ignore
    } finally {
      setProactive(null)
    }
  }, [proactive])

  const emitGuideProactiveMessage = useCallback(async (): Promise<string | null> => {
    if (guideProactiveMsgSentRef.current) return guideFocusMessageId
    // 先置位，避免异步创建会话期间被重复点击二次触发
    guideProactiveMsgSentRef.current = true
    const callName = (user?.preferred_name || user?.username || '你').trim()
    const content = `你好${callName}，今天心情怎么样呀，有没有想我`
    let convId = currentConversationId
    if (!convId) {
      try {
        const conv = await createConversation({ title: '小Q主动问候' })
        addConversation(conv)
        setCurrentConversationId(conv.id)
        setMessages([])
        convId = conv.id
      } catch {
        guideProactiveMsgSentRef.current = false
        return null
      }
    }
    const mid = generateId()
    setGuideFocusMessageId(mid)
    setGuideFocusMessageContent(content)
    setGuideFocusMessageHidden(false)
    addMessage({
      id: mid,
      content,
      sender: 'ai',
      timestamp: new Date(),
      type: 'text',
    })
    updateConversation(convId, {
      lastMessage: content,
      updatedAt: new Date(),
      messageCount: messages.length + 1,
    })
    return mid
  }, [user?.preferred_name, user?.username, currentConversationId, addConversation, setCurrentConversationId, setMessages, addMessage, updateConversation, messages.length, guideFocusMessageId])

  const sendRecordedVoice = async (
    voiceToSend: PendingVoice,
    options?: { clearPending?: boolean; revokeSourceUrl?: boolean }
  ) => {
    if (!voiceToSend.blob || voiceToSend.blob.size === 0) {
      toast('语音数据为空，请重新录制后再发送')
      return
    }
    if (options?.clearPending) setPendingVoice(null)
    const convId = await ensureConversation()
    setIsAiLoading(true)
    const aiMsgId = generateId()
    try {
      const wavName = voiceToSend.fileName.replace(/\.[^.]+$/, '.wav')
      const file = await convertAudioBlobToWavFile(voiceToSend.blob, wavName)
      const { url: uploadedUrl, fileName: name } = await uploadFile(file)
      const userMsg: Message = {
        id: generateId(),
        content: '[语音]',
        sender: 'user',
        timestamp: new Date(),
        type: 'voice',
        fileUrl: uploadedUrl,
        fileName: name,
      }
      addMessage(userMsg)
      addMessage({
        id: aiMsgId,
        content: '',
        sender: 'ai',
        timestamp: new Date(),
        type: 'text',
      })
      updateConversation(convId, { lastMessage: userMsg.content, updatedAt: new Date(), messageCount: messages.length + 1 })

      await chatWithAIStream(
        convId,
        '',
        (chunk) => {
          const prev = useChatStore.getState().messages.find((m) => m.id === aiMsgId)
          updateMessage(aiMsgId, { content: (prev?.content ?? '') + chunk })
        },
        {
          audioUrl: uploadedUrl,
          voiceFileName: name,
          onAssistantAudio: ({ audioUrl, fileName: fn }) => {
            updateMessage(aiMsgId, { fileUrl: audioUrl, fileName: fn })
          },
        }
      )
      invalidateConversationMessages(convId)
      void refreshProactive()
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? (err.message || '语音处理或 AI 回复失败')
          : (err instanceof Error ? err.message : '网络异常，请检查后端服务与网络后重试')
      toast(msg)
      updateMessage(aiMsgId, { content: `[请求失败] ${msg}` })
    } finally {
      if (options?.revokeSourceUrl && voiceToSend.url) {
        URL.revokeObjectURL(voiceToSend.url)
      }
      setIsAiLoading(false)
    }
    setInputValue('')
  }

  const handleSubmit = async () => {
    const content = inputValue.trim()
    const hasImage = pendingImage != null
    const hasVideo = pendingVideo != null
    const hasVoice = pendingVoice != null
    const hasAttachment = pendingAttachment != null
    if ((!content && !hasImage && !hasVideo && !hasVoice && !hasAttachment) || isAiLoading) return

    if (hasVoice && !hasImage && !hasVideo && !hasAttachment) {
      const voiceToSend = pendingVoice!
      await sendRecordedVoice(voiceToSend, { clearPending: true, revokeSourceUrl: true })
      return
    }

    const attachmentToSend = pendingAttachment
    const displayContent =
      content
      || (hasImage
        ? '请描述或分析这张图片'
        : hasVideo
          ? '请描述或分析这个视频'
          : hasAttachment && attachmentToSend
            ? `请结合附件内容回复：${attachmentToSend.fileName}`
            : '（无文字内容）')
    const convId = await ensureConversation()
    updateConversation(convId, {
      lastMessage: displayContent,
      updatedAt: new Date(),
      messageCount: messages.length + 1,
    })

    const userMessage: Message = {
      id: generateId(),
      content: displayContent,
      sender: 'user',
      timestamp: new Date(),
      type: hasImage ? 'image' : hasVideo ? 'video' : hasAttachment && attachmentToSend ? attachmentToSend.category : 'text',
      ...(hasImage && pendingImage ? { fileUrl: pendingImage.url, fileName: pendingImage.fileName } : {}),
      ...(hasVideo && pendingVideo ? { fileUrl: pendingVideo.url, fileName: pendingVideo.fileName } : {}),
      ...(hasAttachment && attachmentToSend ? { fileUrl: attachmentToSend.url, fileName: attachmentToSend.fileName } : {}),
    }
    const imageToSend = pendingImage
    const videoToSend = pendingVideo
    const attachmentCategory = attachmentToSend?.category ?? null
    addMessage(userMessage)
    setInputValue('')
    setPendingImage(null)
    setPendingVideo(null)
    setPendingAttachment(null)
    setIsAiLoading(true)

    const aiMsgId = generateId()
    addMessage({
      id: aiMsgId,
      content: '',
      sender: 'ai',
      timestamp: new Date(),
      type: 'text',
    })

    try {
      await chatWithAIStream(
        convId,
        displayContent,
        (chunk) => {
          const prev = useChatStore.getState().messages.find((m) => m.id === aiMsgId)
          updateMessage(aiMsgId, { content: (prev?.content ?? '') + chunk })
        },
        {
          ...(hasImage && imageToSend ? { imageUrl: imageToSend.url } : {}),
          ...(hasVideo && videoToSend ? { videoUrl: videoToSend.url } : {}),
          ...(hasAttachment && attachmentToSend
            ? attachmentCategory === 'voice'
              ? { audioUrl: attachmentToSend.url, voiceFileName: attachmentToSend.fileName }
              : { fileUrl: attachmentToSend.url, fileName: attachmentToSend.fileName }
            : {}),
          onAssistantAudio: ({ audioUrl, fileName: fn }) => {
            updateMessage(aiMsgId, { fileUrl: audioUrl, fileName: fn })
          },
        }
      )
      invalidateConversationMessages(convId)
      void refreshProactive()
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'AI 回复失败，请稍后重试'
      toast(msg)
      updateMessage(aiMsgId, { content: `[请求失败] ${msg}` })
    } finally {
      setIsAiLoading(false)
    }
  }

  const ensureConversation = async (): Promise<string> => {
    if (currentConversationId) return currentConversationId
    const conv = await createConversation({ title: '新对话' })
    addConversation(conv)
    setCurrentConversationId(conv.id)
    return conv.id
  }

  const handleInterestNewsFromNotice = useCallback(async (cardPayload?: InterestCardPayload) => {
    if (isAiLoading) {
      toast('请稍候，当前仍有对话在处理中')
      return
    }
    setIsAiLoading(true)
    try {
      // 点击即计次：让后端把本时段兴趣新闻卡记为已消费
      await consumeInterestNewsCard().catch(() => {})
      const cachedItems = cardPayload?.newsItems ?? []
      const cachedInterests = cardPayload?.newsInterests ?? []
      const fetched = cachedItems.length > 0 ? null : await getInterestNewsFromWeb()
      const interests = fetched?.interests ?? cachedInterests
      const items = fetched?.items ?? cachedItems
      const convId = await ensureConversation()
      const interestLine = interests.length ? interests.join('、') : '学习、计划管理'
      const headlineBlock =
        items.length > 0
          ? items
              .slice(0, 12)
              .map((it, i) => `${i + 1}. ${it.title}${it.link ? `\n   链接：${it.link}` : ''}`)
              .join('\n')
          : '（本次未能从网络拉取到新闻标题，请根据我的兴趣说明可检索的关键词与今日资讯方向。）'
      const displayContent = [
        '【系统指令】用户点击了“兴趣相关新闻”卡片。请你作为小Q，根据下面我从网络抓取的、与用户最近聊天兴趣相关的新闻标题，用中文写一段简明资讯简报。',
        '要求：',
        '1. 语气要像朋友一样自然，不要像机器播报。',
        '2. 先概括整体动向，再按条简要说明与用户兴趣的相关性。',
        '3. 必须基于下方提供的标题列表，不要编造未在列表中出现的具体事实或标题。',
        '',
        `用户的兴趣倾向：${interestLine}`,
        '',
        '来自网络的标题列表：',
        headlineBlock,
      ].join('\n')

      updateConversation(convId, {
        lastMessage: '正在为你整理相关新闻简报...',
        updatedAt: new Date(),
        messageCount: useChatStore.getState().messages.length + 1,
      })
      
      // 不再添加 user 消息到前端状态，直接添加 ai 消息
      const aiMsgId = generateId()
      addMessage({
        id: aiMsgId,
        content: '',
        sender: 'ai',
        timestamp: new Date(),
        type: 'text',
      })
      await chatWithAIStream(convId, displayContent, (chunk) => {
        const prev = useChatStore.getState().messages.find((m) => m.id === aiMsgId)
        updateMessage(aiMsgId, { content: (prev?.content ?? '') + chunk })
      }, {
        hideUserMessage: true // 告诉后端不要保存这条用户消息
      })
      
      // 阅后即焚/更新：生成完简报后，后台强制刷新一次新闻缓存，以便下次展示新内容
      getInterestNewsFromWeb(true).catch(() => {})
      
      invalidateConversationMessages(convId)
      void refreshProactive()
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '整理兴趣新闻失败，请稍后重试'
      toast(msg)
    } finally {
      setIsAiLoading(false)
    }
  }, [
    isAiLoading,
    toast,
    addMessage,
    updateMessage,
    updateConversation,
    addConversation,
    setCurrentConversationId,
    currentConversationId,
    refreshProactive,
  ])

  const handleInterestNewsDismiss = useCallback(async () => {
    // 关闭兴趣新闻卡也计一次，防止同时间窗内再次弹出
    await consumeInterestNewsCard().catch(() => {})
  }, [])

  const handleFileSelect = async (files: File[]) => {
    const file = files[0]
    if (!file || isAiLoading) return
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast(`文件过大，单文件最大支持 ${MAX_FILE_SIZE_LABEL}，请选择更小的文件`)
      return
    }
    const clearPendingVoiceIfAny = () => {
      setPendingVoice((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url)
        return null
      })
    }

    try {
      const { url, fileName: name, category } = await uploadFile(file)
      if (category === 'image') {
        setPendingVideo(null)
        setPendingAttachment(null)
        clearPendingVoiceIfAny()
        setPendingImage({ url, fileName: name })
        return
      }
      if (category === 'video') {
        setPendingImage(null)
        setPendingAttachment(null)
        clearPendingVoiceIfAny()
        setPendingVideo({ url, fileName: name })
        return
      }
      setPendingImage(null)
      setPendingVideo(null)
      clearPendingVoiceIfAny()
      setPendingAttachment({
        url,
        fileName: name,
        category: category === 'voice' ? 'voice' : 'file',
      })
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '上传失败'
      toast(msg)
    }
  }

  const handleVoiceRecordStart = async () => {
    try {
      await startRecording()
      toast('语音录制开始')
    } catch {
      toast('无法访问麦克风')
    }
  }

  const handleVoiceRecordStop = async () => {
    toast('语音录制结束，正在处理…')
    const blob = await stopRecording()
    if (!blob) {
      toast('未获取到有效录音，请稍等 1 秒后重试')
      return
    }
    if (isAiLoading) {
      toast('当前有请求处理中，请稍后再录音发送')
      return
    }
    if (blob.size === 0) {
      toast('录制内容为空，请重新录制')
      return
    }
    const fileName = `voice-${Date.now()}.webm`
    const url = URL.createObjectURL(blob)
    await sendRecordedVoice({ blob, url, fileName }, { revokeSourceUrl: true })
  }

  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const showProactiveBubble = Boolean(proactive || guideStep === 1 || guideStep === 2 || guideFadingOut)
  const highlightedRect = guideHighlightRect

  useEffect(() => {
    // 组件挂载一小段时间后，解除初始加载状态，这样后续的位移就会有动画
    const timer = window.setTimeout(() => {
      setIsInitialLoad(false)
    }, 100)
    return () => window.clearTimeout(timer)
  }, [])

  const handleGuideNext = () => {
    if (guideStep === 0) {
      setGuideStep(1)
      return
    }
    if (guideStep === 2) {
      if (guideTransitioningToAvatar) return
      setGuideTransitioningToAvatar(true)
      setGuideHintVisible(false)
      setGuideStep(3)
      // 聚焦圈移动完成后，再显示“请点击”提示
      window.setTimeout(() => {
        setGuideHintVisible(true)
        setGuideTransitioningToAvatar(false)
      }, 760)
    }
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col md:flex-row">
      <style>{`
        @keyframes iosGlassBubbleMotion {
          0%, 100% { transform: translate(-50%, -90%) scale(1); }
          50% { transform: translate(-50%, calc(-90% - 6px)) scale(1.035); }
        }
      `}</style>
      <aside className="hidden md:flex relative z-30 flex-col flex-shrink-0 w-56 lg:w-60 xl:w-72 border-r border-slate-200/80 dark:border-zinc-700/60 bg-slate-50/75 dark:bg-[#121212] items-center justify-start pt-32 px-3 pb-3 md:px-4 md:pb-4 landscape:max-md:hidden overflow-visible">
        <div className="flex flex-col items-center w-full max-w-[240px] gap-4 pb-4 overflow-visible">
          {/* 顶部区域：数字人 */}
          <div className="relative z-[80] w-full flex flex-col items-center justify-center shrink-0 min-h-[200px] mt-8 overflow-visible">
            {realtimePopupOpen ? (
              <div className="w-full text-center px-3">
                <p className="text-sm text-primary-500 dark:text-primary-400">实时对话窗口已打开</p>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">关闭实时窗口后，数字人会回到这里</p>
              </div>
            ) : (
              <div ref={digitalHumanWrapRef} className="relative w-full flex items-center justify-center pt-8 pb-2">
                <div ref={digitalHumanTargetRef} className="relative w-[160px] md:w-[180px] flex justify-center">
                  {/* 顶部通知栏（重合放置在气泡之上，不占布局高度） */}
                  <div 
                    className={`absolute left-1/2 top-0 z-[80] pointer-events-auto ${isInitialLoad ? '' : 'transition-transform duration-700 ease-in-out'}`}
                    style={{
                      transform: `translate(-50%, ${showProactiveBubble ? '-185px' : '-150px'})`
                    }}
                  >
                    <AssistantNoticeBar
                      onInterestNewsClick={handleInterestNewsFromNotice}
                      onInterestNewsDismiss={handleInterestNewsDismiss}
                      interestNewsBusy={isAiLoading}
                    />
                  </div>

                  {showProactiveBubble && (
                    <button
                      ref={proactiveBubbleRef}
                      type="button"
                      onClick={() => {
                        if (guideStep === 1) {
                          if (guideProactiveClickLockRef.current) return
                          guideProactiveClickLockRef.current = true
                          if (proactive) void handleAckProactiveNoRefresh()
                          void (async () => {
                            try {
                              const mid = await emitGuideProactiveMessage()
                              if (mid) setGuideStep(2)
                            } finally {
                              guideProactiveClickLockRef.current = false
                            }
                          })()
                          return
                        }
                        if (proactive) void handleAckProactive()
                      }}
                      className={`absolute left-1/2 top-0 z-20 w-max max-w-[200px] text-center rounded-2xl px-3 py-2.5 border border-white/35 dark:border-white/15 bg-white/40 dark:bg-white/10 backdrop-blur-xl shadow-[0_8px_30px_rgba(15,23,42,0.16)] hover:bg-white/55 dark:hover:bg-white/15 transition ${
                        guideFadingOut ? 'opacity-0 pointer-events-none duration-700' : 'opacity-100 duration-300'
                      }`}
                      style={{
                        transform: 'translate(-50%, -90%)',
                        animation: guideFadingOut ? 'none' : 'iosGlassBubbleMotion 3.8s ease-in-out infinite',
                      }}
                    >
                      <p className="text-xs font-medium text-slate-700/90 dark:text-slate-100/90">
                        小Q发现你最近不是很开心，希望和你聊一聊
                      </p>
                    </button>
                  )}
                  <DigitalHuman
                    expression="happy"
                    animate
                    bodyMotion
                    onClick={handleDigitalHumanClick}
                    realtimeMode={false}
                    className="w-full"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 中间区域：日历 */}
          <div className="relative z-[70] w-full shrink-0 flex items-start justify-center">
            <WeeklyCalendar />
          </div>

          {/* 底部区域：日程建议 */}
          <div className="w-full shrink-0 flex items-start justify-center">
            <ScheduleSuggestion />
          </div>
        </div>
      </aside>

      <div className="relative z-10 flex flex-col flex-1 min-w-0 min-h-0">
        {/* 主动关怀气泡挂在左侧数字人上方（md+）；小屏侧栏整体 hidden，在此补一条入口 */}
        {proactive ? (
          <div className="md:hidden flex-shrink-0 px-3 py-2 border-b border-amber-200/80 bg-amber-50/90 dark:border-amber-700/30 dark:bg-[#131316]">
            <button
              type="button"
              onClick={() => {
                void handleAckProactive()
              }}
              className="w-full text-left rounded-xl px-3 py-2.5 text-sm font-medium text-amber-900 dark:text-amber-100 bg-white/70 dark:bg-[#1a1a1c] border border-amber-200/80 dark:border-amber-700/30 active:scale-[0.99] transition"
            >
              小Q发现你最近不是很开心，希望和你聊一聊（点此）
            </button>
          </div>
        ) : null}
        <div
          className={`flex-1 min-h-0 flex flex-col transition-opacity duration-500 relative ${
            guideStep === 2 && guideFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          {renderedMessages.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p 
                className={`text-gray-400/60 dark:text-gray-500/50 text-sm md:text-base font-medium tracking-wide transition-opacity duration-1000 ease-in-out px-4 text-center ${
                  promptFade ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {promptPool[promptIndex % Math.max(1, promptPool.length)] || DEFAULT_PROMPT_POOL[0]}
              </p>
            </div>
          )}
          {useVirtualScroll ? (
            <VirtualMessageList messages={renderedMessages} scrollToEndRef={messagesEndRef} />
          ) : renderedMessages.length === 0 ? (
            <div className="flex-1 min-h-0" />
          ) : (
            <div ref={messagesContainerRef} className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 md:p-4 pb-2 landscape:max-md:pb-2">
              <ul className="space-y-3 sm:space-y-4">
                {renderedMessages.map((msg) => (
                  <li
                    key={msg.id}
                    className={msg.sender === 'user' ? 'flex justify-end' : 'flex justify-start'}
                  >
                    <div data-message-anchor-id={msg.id} className="inline-block">
                      <MessageBubble message={msg} />
                    </div>
                  </li>
                ))}
                <div ref={messagesEndRef} />
              </ul>
            </div>
          )}
        </div>

        {pendingImage && (
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <img src={pendingImage.url} alt={pendingImage.fileName} className="w-12 h-12 object-cover rounded-lg border border-gray-200 dark:border-gray-600" />
            <span className="text-sm text-gray-600 dark:text-gray-400 truncate flex-1 min-w-0">{pendingImage.fileName}</span>
            <button
              type="button"
              onClick={() => setPendingImage(null)}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-800 dark:hover:text-gray-200"
              title="移除图片"
              aria-label="移除图片"
            >
              ✕
            </button>
          </div>
        )}

        {pendingVideo && (
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <video
              src={pendingVideo.url}
              className="w-20 h-12 rounded-lg border border-gray-200 dark:border-gray-600 object-cover"
              preload="metadata"
              muted
            />
            <span className="text-sm text-gray-600 dark:text-gray-400 truncate flex-1 min-w-0">{pendingVideo.fileName}</span>
            <button
              type="button"
              onClick={() => setPendingVideo(null)}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-800 dark:hover:text-gray-200"
              title="移除视频"
              aria-label="移除视频"
            >
              ✕
            </button>
          </div>
        )}

        {pendingVoice && (
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <span className="text-sm text-gray-600 dark:text-gray-400 shrink-0">🎤 语音</span>
            <audio src={pendingVoice.url} controls className="flex-1 min-w-0 h-8 max-w-[200px] sm:max-w-[280px]" preload="metadata" />
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={isAiLoading}
              className="px-3 py-1.5 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 disabled:opacity-50 shrink-0"
              title="发送语音"
              aria-label="发送语音"
            >
              发送
            </button>
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(pendingVoice.url)
                setPendingVoice(null)
              }}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-800 dark:hover:text-gray-200 shrink-0"
              title="移除语音"
              aria-label="移除语音"
            >
              ✕
            </button>
          </div>
        )}

        {pendingAttachment && (
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <span className="text-sm text-gray-600 dark:text-gray-400 shrink-0">
              {pendingAttachment.category === 'voice' ? '🎤 语音文件' : '📄 文件'}
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-400 truncate flex-1 min-w-0">{pendingAttachment.fileName}</span>
            <button
              type="button"
              onClick={() => setPendingAttachment(null)}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-800 dark:hover:text-gray-200"
              title={pendingAttachment.category === 'voice' ? '移除语音文件' : '移除文件'}
              aria-label={pendingAttachment.category === 'voice' ? '移除语音文件' : '移除文件'}
            >
              ✕
            </button>
          </div>
        )}

        <div className="flex-shrink-0 pb-[env(safe-area-inset-bottom)]">
          <InputArea
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
            onFileSelect={handleFileSelect}
            onVoiceRecordStart={handleVoiceRecordStart}
            onVoiceRecordStop={handleVoiceRecordStop}
            voiceRecording={isRecording}
            pendingImage={pendingImage}
            pendingVideo={pendingVideo}
            pendingVoice={pendingVoice != null ? { url: pendingVoice.url, fileName: pendingVoice.fileName } : null}
            pendingFile={pendingAttachment != null ? { fileName: pendingAttachment.fileName } : null}
            disabled={isAiLoading}
            placeholder="输入消息..."
          />
        </div>
      </div>

      {guideStep >= 0 && highlightedRect && (
        <div className={`fixed inset-0 z-[80] pointer-events-none transition-opacity duration-700 ${guideFadingOut ? 'opacity-0' : 'opacity-100'}`}>
          <div className="absolute left-0 top-0 right-0 bg-transparent pointer-events-auto" style={{ height: Math.max(0, highlightedRect.top - 1) }} />
          <div className="absolute left-0 bg-transparent pointer-events-auto" style={{ top: Math.max(0, highlightedRect.top - 1), width: Math.max(0, highlightedRect.left - 1), height: highlightedRect.height + 2 }} />
          <div className="absolute right-0 bg-transparent pointer-events-auto" style={{ top: Math.max(0, highlightedRect.top - 1), width: Math.max(0, window.innerWidth - (highlightedRect.left + highlightedRect.width) - 1), height: highlightedRect.height + 2 }} />
          <div className="absolute left-0 right-0 bottom-0 bg-transparent pointer-events-auto" style={{ top: highlightedRect.top + highlightedRect.height + 1 }} />
          <div
            className="absolute rounded-full transition-all duration-700 ease-in-out"
            style={{
              left: highlightedRect.left - (guideStep === 2 ? 22 : 14),
              top: highlightedRect.top - (guideStep === 2 ? 22 : 14),
              width: highlightedRect.width + (guideStep === 2 ? 44 : 28),
              height: highlightedRect.height + (guideStep === 2 ? 44 : 28),
              background: 'transparent',
              boxShadow:
                '0 0 0 9999px rgba(6,10,18,0.30), 0 0 0 1px rgba(255,255,255,0.16), 0 0 22px 8px rgba(147,197,253,0.32), 0 0 44px 18px rgba(147,197,253,0.18)',
            }}
          />
          <div className={`absolute left-1/2 -translate-x-1/2 bottom-8 w-[min(92vw,560px)] pointer-events-auto rounded-2xl border border-white/20 bg-white/80 dark:bg-[#1a1a1c]/90 backdrop-blur-xl p-4 shadow-xl transition-opacity duration-300 ${
            guideHintVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}>
            <p className="text-sm text-gray-800 dark:text-gray-100">
              {guideStep === 0
                ? '点击数字人小Q可以开启实时对话。'
                : guideStep === 1
                  ? '小Q想和你对话，可以点击气泡开启对话哦。'
                  : guideStep === 2
                    ? '这条是小Q主动发起的问候消息。'
                    : guideStep === 3
                      ? '请点击右上角头像。'
                      : '请点击「个人中心」，进入个人主页。'}
            </p>
            {(guideStep === 0 || guideStep === 2) && (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={handleGuideNext}
                  disabled={guideStep === 2 && guideTransitioningToAvatar}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm hover:bg-primary-700"
                >
                  下一步
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
