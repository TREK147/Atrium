export type RoleCode = 'ADMIN' | 'COUNSELOR'

export type DataScope = {
  collegeId: string
  collegeName: string
  grade: string
  major: string
  classIds: string[]
}

export type UserAccountStatus = 'ACTIVE' | 'FROZEN' | 'DISABLED' | 'LOCKED'

export type User = {
  id: string
  staffNo: string
  name: string
  role: RoleCode
  roleName: string
  scope?: DataScope
  /** 辅导员多辖区（与后端 scope_json.scopes 一致）；单辖区时通常仅有 scope */
  scopes?: DataScope[]
  passwordHash: string
  passwordSalt: string
  status: UserAccountStatus
  failedLoginCount: number
  lockedUntil?: number
  createdAt: number
  lastLoginAt?: number
}

export type Session = {
  token: string
  userId: string
  staffNo: string
  createdAt: number
  lastSeenAt: number
  revokedAt?: number
}

export type StudentBase = {
  studentNo: string
  name: string
  collegeId: string
  collegeName: string
  grade: string
  major: string
  classId: string
  className: string
  phone: string
  idCardNo: string
}

export type EmotionPoint = {
  ts: number
  score: number // 0-100
  mood: '积极' | '中性' | '消极'
  source: '自评' | '数字人交互' | '辅导员记录' | '人脸识别' | string
}

export type AssessmentReportKind = 'legacy' | 'daily' | 'hourly'

export type AssessmentReport = {
  id: string
  studentNo: string
  createdAt: number
  summary: string
  riskLevel: '低' | '中' | '高' | '危'
  tags: string[]
  modality: Array<'文本' | '语音' | '表情' | string>
  /** 后端：legacy 为旧数据；daily/hourly 为定时脱敏汇总 */
  reportKind?: AssessmentReportKind
  periodStartMs?: number | null
  periodEndMs?: number | null
}

export type AlertStatus = 'NEW' | 'FOLLOWED' | 'CLEARED'

export type AlertItem = {
  id: string
  studentNo: string
  studentName: string
  createdAt: number
  level: '低' | '中' | '高' | '危'
  reason: string
  assignedCounselorStaffNo: string
  status: AlertStatus
  note?: string
  updatedAt?: number
}

export type AuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAIL'
  | 'PASSWORD_CHANGE'
  | 'ACCOUNT_FREEZE'
  | 'ACCOUNT_DISABLE'
  | 'ACCOUNT_ENABLE'
  | 'ACCOUNT_FORCE_LOGOUT'
  | 'ROLE_SCOPE_UPDATE'
  | 'THRESHOLD_UPDATE'
  | 'ARCHIVE_VIEW'
  | 'EXPORT_REPORT'

export type AuditLog = {
  id: string
  action: AuditAction
  actorStaffNo?: string
  actorName?: string
  targetStudentNo?: string
  targetStaffNo?: string
  detail: string
  ts: number
  ip: string
  device: string
}

export type ThresholdConfig = {
  updatedAt: number
  updatedBy?: string
  sensitivity: number // 0-100
  levelRules: Array<{ level: '低' | '中' | '高' | '危'; minScore: number; maxScore: number }>
}

export type UserFeedback = {
  id: number
  user_id: number
  username: string
  email: string
  content: string
  screenshot_url?: string
  allow_contact: 0 | 1
  created_at: string
}

