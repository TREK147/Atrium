import type { DataScope } from '../mock/types'

/** 辅导员可见辖区块（单 scope 或多 scopes） */
export function counselorScopeBlocks(user: {
  role?: string
  scope?: DataScope
  scopes?: DataScope[]
}): DataScope[] {
  if (user.role !== 'COUNSELOR') return []
  if (user.scopes && user.scopes.length > 0) return user.scopes
  if (user.scope && (user.scope.collegeId || user.scope.collegeName)) return [user.scope]
  return []
}

/** 去重后的学院名称列表 */
export function counselorCollegeNames(user: {
  role?: string
  scope?: DataScope
  scopes?: DataScope[]
}): string[] {
  const blocks = counselorScopeBlocks(user)
  return [...new Set(blocks.map((s) => (s.collegeName || '').trim()).filter(Boolean))]
}

/** 是否跨学院（≥2 个不同学院名） */
export function isMultiCollegeCounselor(user: {
  role?: string
  scope?: DataScope
  scopes?: DataScope[]
}): boolean {
  return user.role === 'COUNSELOR' && counselorCollegeNames(user).length >= 2
}
