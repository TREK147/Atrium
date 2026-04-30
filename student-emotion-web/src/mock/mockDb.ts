import md5 from 'blueimp-md5'
import type {
  AlertItem,
  AssessmentReport,
  AuditLog,
  Session,
  StudentBase,
  ThresholdConfig,
  User,
} from './types'

function now() {
  return Date.now()
}

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${now()}`
}

export function hashPasswordMd5WithDynamicSalt(plain: string, salt: string) {
  return md5(`${salt}:${plain}`)
}

function randomSalt() {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
}

function buildUser(params: Omit<User, 'id' | 'createdAt' | 'passwordSalt' | 'passwordHash'> & { password: string }) {
  const passwordSalt = randomSalt()
  const passwordHash = hashPasswordMd5WithDynamicSalt(params.password, passwordSalt)
  const { password, ...rest } = params
  return {
    id: id('usr'),
    createdAt: now(),
    passwordSalt,
    passwordHash,
    ...rest,
  } satisfies User
}

const users: User[] = [
  buildUser({
    staffNo: 'SuperManager',
    name: 'SuperManager',
    role: 'ADMIN',
    roleName: '管理员',
    status: 'ACTIVE',
    failedLoginCount: 0,
    password: '123456',
  }),
  buildUser({
    staffNo: '2011800051',
    name: '孙晓',
    role: 'COUNSELOR',
    roleName: '信息工程学院教师',
    scope: {
      collegeId: 'C01',
      collegeName: '信息工程学院',
      grade: '2024',
      major: '软件工程',
      classIds: ['CL2401', 'CL2402'],
    },
    status: 'ACTIVE',
    failedLoginCount: 0,
    password: '123456',
  }),
  buildUser({
    staffNo: '1999800037',
    name: '徐本柱',
    role: 'COUNSELOR',
    roleName: '管理学院教师',
    scope: {
      collegeId: 'C02',
      collegeName: '管理学院',
      grade: '2023',
      major: '工商管理',
      classIds: ['CL2301'],
    },
    status: 'ACTIVE',
    failedLoginCount: 0,
    password: '123456',
  }),
]

const students: StudentBase[] = [
  {
    studentNo: '20240001',
    name: '李雷',
    collegeId: 'C01',
    collegeName: '信息工程学院',
    grade: '2024',
    major: '软件工程',
    classId: 'CL2401',
    className: '软工2401班',
    phone: '13912346705',
    idCardNo: '320101200601019999',
  },
  {
    studentNo: '20240002',
    name: '韩梅梅',
    collegeId: 'C01',
    collegeName: '信息工程学院',
    grade: '2024',
    major: '软件工程',
    classId: 'CL2402',
    className: '软工2402班',
    phone: '13877776666',
    idCardNo: '320101200602028888',
  },
  {
    studentNo: '20230011',
    name: '王强',
    collegeId: 'C02',
    collegeName: '管理学院',
    grade: '2023',
    major: '工商管理',
    classId: 'CL2301',
    className: '工管2301班',
    phone: '13700001111',
    idCardNo: '320101200501017777',
  },
]

const emotionTimelineByStudentNo: Record<string, Array<{ ts: number; score: number; mood: '积极' | '中性' | '消极'; source: '自评' | '数字人交互' | '辅导员记录' }>> =
  {}

function seedEmotion(studentNo: string, base: number) {
  const list: Array<{ ts: number; score: number; mood: '积极' | '中性' | '消极'; source: '自评' | '数字人交互' | '辅导员记录' }> =
    []
  const oneDay = 24 * 3600 * 1000
  for (let i = 30; i >= 0; i--) {
    const score = Math.max(
      0,
      Math.min(100, Math.round(base + Math.sin(i / 2) * 8 + (Math.random() - 0.5) * 10)),
    )
    const mood = score >= 66 ? '积极' : score >= 45 ? '中性' : '消极'
    const source = i % 7 === 0 ? '数字人交互' : '自评'
    list.push({ ts: now() - i * oneDay, score, mood, source })
  }
  emotionTimelineByStudentNo[studentNo] = list
}

seedEmotion('20240001', 62)
seedEmotion('20240002', 55)
seedEmotion('20230011', 48)

const reports: AssessmentReport[] = [
  {
    id: id('rpt'),
    studentNo: '20240001',
    createdAt: now() - 3 * 24 * 3600 * 1000,
    summary: '近一周情绪整体偏稳定，数字人交互中出现轻度压力主题，建议关注学习与作息。',
    riskLevel: '低',
    tags: ['学习压力', '作息'],
    modality: ['文本', '表情'],
  },
  {
    id: id('rpt'),
    studentNo: '20240002',
    createdAt: now() - 2 * 24 * 3600 * 1000,
    summary: '情绪波动较明显，负向词频上升，建议进行一次线下谈话与支持性干预。',
    riskLevel: '中',
    tags: ['情绪波动', '人际'],
    modality: ['文本', '语音'],
  },
]

const sessions: Session[] = []

const auditLogs: AuditLog[] = []

const thresholdConfig: ThresholdConfig = {
  updatedAt: now(),
  sensitivity: 70,
  levelRules: [
    { level: '低', minScore: 60, maxScore: 100 },
    { level: '中', minScore: 45, maxScore: 59.99 },
    { level: '高', minScore: 30, maxScore: 44.99 },
    { level: '危', minScore: 0, maxScore: 29.99 },
  ],
}

const alerts: AlertItem[] = [
  {
    id: id('alt'),
    studentNo: '20240002',
    studentName: '韩梅梅',
    createdAt: now() - 6 * 3600 * 1000,
    level: '中',
    reason: '今日负向情绪占比上升，且连续 3 天均值下降。',
    assignedCounselorStaffNo: '2011800051',
    status: 'NEW',
  },
]

export const db = {
  now,
  id,
  users,
  students,
  emotionTimelineByStudentNo,
  reports,
  sessions,
  auditLogs,
  thresholdConfig,
  alerts,
}

