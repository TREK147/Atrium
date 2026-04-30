import { PlusOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Form, Select, Space, App as AntApp, Typography, Input } from 'antd'
import { useAuth } from '../../state/auth'
import { api } from '../../mock/api'
import type { DataScope, RoleCode } from '../../mock/types'
import { isMultiCollegeCounselor } from '../../utils/counselorDisplay'

type AccountRow = {
  staffNo: string
  name: string
  role: RoleCode
  roleName: string
  scope?: DataScope
  scopes?: DataScope[]
}

type ScopeFormRow = {
  collegeId?: string
  grade?: string
  major?: string
  classIds?: string[]
}

const colleges = [
  { id: 'C021', name: '软件学院' },
  { id: 'C005', name: '计算机学院' },
  { id: 'C030', name: '经济学院' },
]

const majorsByCollege: Record<string, string[]> = {
  C021: ['软件工程'],
  C005: ['计算机科学与技术', '信息安全'],
  C030: ['金融工程'],
}

const classIdsByCombo: Record<string, Array<{ id: string; name: string }>> = {
  'C021|2024|软件工程': [
    { id: 'CL2401', name: '软工2401班' },
    { id: 'CL2402', name: '软工2402班' },
  ],
  'C021|2025|软件工程': [
    { id: 'CL2501', name: '软工2501班' },
    { id: 'CL2502', name: '软工2502班' },
  ],
  'C005|2024|计算机科学与技术': [{ id: 'CL2401', name: '2024级1班' }],
  'C005|2025|计算机科学与技术': [{ id: 'CL2501', name: '2025级1班' }],
  'C005|2024|信息安全': [{ id: 'CL2401', name: '2024级1班' }],
  'C005|2025|信息安全': [{ id: 'CL2501', name: '2025级1班' }],
  'C030|2024|金融工程': [{ id: 'CL2401', name: '2024级1班' }],
  'C030|2025|金融工程': [{ id: 'CL2501', name: '2025级1班' }],
}

function buildRoleName(role: RoleCode, collegeId: string | undefined): string {
  if (!collegeId) return ''
  const collegeName = colleges.find((c) => c.id === collegeId)?.name ?? collegeId
  if (role === 'ADMIN') return `${collegeName}管理员`
  if (role === 'COUNSELOR') return `${collegeName}辅导员`
  return ''
}

function accountToScopeFieldRows(account: AccountRow): ScopeFormRow[] {
  if (account.scopes && account.scopes.length > 0) {
    return account.scopes.map((s) => ({
      collegeId: s.collegeId,
      grade: s.grade,
      major: s.major,
      classIds: [...(s.classIds ?? [])],
    }))
  }
  if (account.scope && (account.scope.collegeId || account.scope.collegeName)) {
    return [
      {
        collegeId: account.scope.collegeId,
        grade: account.scope.grade,
        major: account.scope.major,
        classIds: [...(account.scope.classIds ?? [])],
      },
    ]
  }
  return [{}]
}

function classOptionsForRow(row: ScopeFormRow | undefined) {
  const key = `${row?.collegeId ?? ''}|${row?.grade ?? ''}|${row?.major ?? ''}`
  return (classIdsByCombo[key] ?? []).map((x) => ({ label: `${x.name}（${x.id}）`, value: x.id }))
}

export function RoleScopeAdminPage() {
  const { token, user } = useAuth()
  const collegeScoped =
    user?.role === 'ADMIN' &&
    user?.staffNo !== 'SuperManager' &&
    !!(user?.scope?.collegeId || user?.scope?.collegeName)

  const pinnedCollegeId = useMemo(() => {
    if (!collegeScoped || !user?.scope) return undefined
    if (user.scope.collegeId) return user.scope.collegeId as string
    const nm = (user.scope.collegeName || '').trim()
    if (!nm) return undefined
    return colleges.find((c) => c.name === nm)?.id
  }, [collegeScoped, user?.scope])
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [accounts, setAccounts] = useState<AccountRow[]>([])

  async function refresh() {
    setLoading(true)
    const r = await api.adminListAccounts(token)
    setLoading(false)
    if (!r.ok) {
      message.error(r.message)
      return
    }
    setAccounts(r.data.filter((a) => a.staffNo !== 'SuperManager'))
  }

  useEffect(() => {
    void refresh()
  }, [token])

  const selectedStaffNo = Form.useWatch('staffNo', form) as string | undefined
  useEffect(() => {
    if (selectedStaffNo === 'SuperManager') {
      form.resetFields()
    }
  }, [selectedStaffNo, form])

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.staffNo === selectedStaffNo),
    [accounts, selectedStaffNo],
  )

  const role = Form.useWatch('role', form) as RoleCode | undefined
  const collegeId = Form.useWatch('collegeId', form) as string | undefined
  const grade = Form.useWatch('grade', form) as string | undefined
  const major = Form.useWatch('major', form) as string | undefined

  useEffect(() => {
    if (!selectedAccount) return
    const pinCollege = collegeScoped ? pinnedCollegeId : undefined
    if (collegeScoped) {
      const pin = (pinCollege || '').trim()
      const pick =
        (selectedAccount.scopes || []).find((s) => (s.collegeId || '').trim() === pin) ||
        selectedAccount.scope
      form.setFieldsValue({
        role: 'COUNSELOR',
        collegeId: pinCollege || pick?.collegeId,
        grade: pick?.grade,
        major: pick?.major,
        classIds: pick?.classIds,
        roleName: selectedAccount.roleName,
      })
      return
    }
    form.setFieldsValue({
      role: selectedAccount.role,
      collegeId: selectedAccount.scope?.collegeId,
      grade: undefined,
      major: undefined,
      classIds: undefined,
      scopes: selectedAccount.role === 'COUNSELOR' ? accountToScopeFieldRows(selectedAccount) : [{}],
      roleName: selectedAccount.roleName,
    })
  }, [selectedAccount, collegeScoped, pinnedCollegeId, form])

  const classOptions = useMemo(() => {
    const key = `${collegeId ?? ''}|${grade ?? ''}|${major ?? ''}`
    return (classIdsByCombo[key] ?? []).map((x) => ({ label: `${x.name}（${x.id}）`, value: x.id }))
  }, [collegeId, grade, major])

  const showMultiCounselorScopes = !collegeScoped && role === 'COUNSELOR'

  return (
    <div className="page">
      <Card title="角色与数据管辖范围配置">
        {collegeScoped && selectedAccount && isMultiCollegeCounselor({
          role: 'COUNSELOR',
          scopes: selectedAccount.scopes,
          scope: selectedAccount.scope,
        }) ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="跨学院辅导员（同一工号）"
            description="该教职工在全校配置中带有多个学院辖区。您作为学院管理员：可在账号列表中看到其与本学院相关；学生数据按辖区并集生效。「角色/范围」修改需由全校管理员操作，避免误删其他学院辖区。"
          />
        ) : null}
        <Form
          form={form}
          layout="vertical"
          onFinish={async (v) => {
            const effRole = (collegeScoped ? 'COUNSELOR' : v.role) as RoleCode

            if (collegeScoped) {
              if (
                selectedAccount &&
                isMultiCollegeCounselor({
                  role: 'COUNSELOR',
                  scopes: selectedAccount.scopes,
                  scope: selectedAccount.scope,
                })
              ) {
                message.warning('跨学院多辖区辅导员（同一工号）的角色/范围仅全校管理员可保存；请勿提交以免覆盖其他学院配置。')
                return
              }
              const collegeId0 = pinnedCollegeId as string
              const collegeName = colleges.find((c) => c.id === collegeId0)?.name ?? collegeId0
              const roleName = (v.roleName || '').trim() || buildRoleName('COUNSELOR', collegeId0) || `${collegeName}辅导员`
              const scope: DataScope = {
                collegeId: collegeId0,
                collegeName,
                grade: v.grade,
                major: v.major,
                classIds: v.classIds ?? [],
              }
              const r = await api.adminUpdateRoleScope(token, {
                staffNo: v.staffNo,
                role: 'COUNSELOR',
                roleName,
                scope,
              })
              if (!r.ok) {
                message.error(r.message)
                return
              }
              message.success('已更新角色/范围')
              await refresh()
              return
            }

            if (effRole === 'ADMIN') {
              const cid = v.collegeId as string | undefined
              const collegeName = colleges.find((c) => c.id === cid)?.name ?? cid ?? ''
              const roleName = (v.roleName || '').trim() || buildRoleName('ADMIN', cid) || '管理员'
              const scope: DataScope = {
                collegeId: cid ?? '',
                collegeName,
                grade: '',
                major: '',
                classIds: [],
              }
              const r = await api.adminUpdateRoleScope(token, {
                staffNo: v.staffNo,
                role: 'ADMIN',
                roleName,
                scope,
              })
              if (!r.ok) {
                message.error(r.message)
                return
              }
              message.success('已更新角色/范围')
              await refresh()
              return
            }

            const rawRows = (v.scopes ?? []) as ScopeFormRow[]
            const scopes: DataScope[] = rawRows
              .map((row) => ({
                collegeId: row.collegeId ?? '',
                collegeName: colleges.find((c) => c.id === row.collegeId)?.name ?? row.collegeId ?? '',
                grade: row.grade ?? '',
                major: row.major ?? '',
                classIds: row.classIds ?? [],
              }))
              .filter((s) => s.collegeId && s.grade && s.major && (s.classIds?.length ?? 0) > 0)

            if (scopes.length === 0) {
              message.error('请至少配置一条完整辖区（学院、年级、专业、班级）')
              return
            }

            let roleName = (v.roleName || '').trim()
            if (!roleName) {
              const cns = [...new Set(scopes.map((s) => s.collegeName).filter(Boolean))]
              roleName = cns.length > 1 ? `${cns.join('、')}辅导员` : `${cns[0]}辅导员`
            }

            const r = await api.adminUpdateRoleScope(token, {
              staffNo: v.staffNo,
              role: 'COUNSELOR',
              roleName,
              scopes,
            })
            if (!r.ok) {
              message.error(r.message)
              return
            }
            message.success('已更新角色/范围')
            await refresh()
          }}
        >
          <Form.Item label="选择账号" name="staffNo" rules={[{ required: true, message: '请选择账号' }]}>
            <Select
              placeholder="请选择教职工账号"
              options={accounts.map((a) => ({ label: `${a.name}（${a.staffNo}）`, value: a.staffNo }))}
            />
          </Form.Item>

          <Form.Item label="角色" name="role" rules={[{ required: true, message: '请选择角色' }]} style={{ maxWidth: 360 }}>
            <Select
              disabled={collegeScoped}
              options={
                collegeScoped
                  ? [{ label: '辅导员（COUNSELOR）', value: 'COUNSELOR' }]
                  : [
                      { label: '管理员（ADMIN）', value: 'ADMIN' },
                      { label: '辅导员（COUNSELOR）', value: 'COUNSELOR' },
                    ]
              }
              onChange={(r0: RoleCode) => {
                if (r0 === 'ADMIN') {
                  form.setFieldsValue({ scopes: [{}], grade: undefined, major: undefined, classIds: [] })
                } else {
                  form.setFieldsValue({
                    collegeId: undefined,
                    grade: undefined,
                    major: undefined,
                    classIds: [],
                    scopes: selectedAccount ? accountToScopeFieldRows(selectedAccount) : [{}],
                  })
                }
              }}
            />
          </Form.Item>

          {!collegeScoped && (role === 'COUNSELOR' || role === 'ADMIN') ? (
            <Form.Item
              label="职务名称（可自定义）"
              name="roleName"
              tooltip="辅导员多学院时留空将按学院名自动生成，例如「软件学院、计算机学院辅导员」"
            >
              <Input placeholder="例如：软件学院与计算机学院辅导员" allowClear style={{ maxWidth: 480 }} />
            </Form.Item>
          ) : null}

          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Typography.Title level={5} style={{ marginTop: 8, marginBottom: 0 }}>
              数据管辖范围
            </Typography.Title>

            {showMultiCounselorScopes ? (
              <Form.List name="scopes">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map((f) => (
                      <Card
                        key={f.key}
                        size="small"
                        title={`辖区 ${f.name + 1}`}
                        extra={
                          fields.length > 1 ? (
                            <Button type="link" danger onClick={() => remove(f.name)}>
                              删除
                            </Button>
                          ) : null
                        }
                      >
                        <Space wrap align="start">
                          <Form.Item
                            label="学院"
                            name={[f.name, 'collegeId']}
                            rules={[{ required: true, message: '请选择学院' }]}
                            style={{ width: 220 }}
                          >
                            <Select
                              options={colleges.map((c) => ({ label: `${c.name}（${c.id}）`, value: c.id }))}
                              onChange={() => {
                                form.setFieldValue(['scopes', f.name, 'grade'], undefined)
                                form.setFieldValue(['scopes', f.name, 'major'], undefined)
                                form.setFieldValue(['scopes', f.name, 'classIds'], [])
                              }}
                            />
                          </Form.Item>
                          <Form.Item
                            label="年级"
                            name={[f.name, 'grade']}
                            rules={[{ required: true, message: '请选择年级' }]}
                            style={{ width: 160 }}
                          >
                            <Select
                              options={['2023', '2024', '2025'].map((g) => ({ label: g, value: g }))}
                              onChange={() => {
                                form.setFieldValue(['scopes', f.name, 'major'], undefined)
                                form.setFieldValue(['scopes', f.name, 'classIds'], [])
                              }}
                            />
                          </Form.Item>
                          <Form.Item dependencies={[['scopes', f.name, 'collegeId']]} noStyle>
                            {() => {
                              const row = (form.getFieldValue('scopes') || [])[f.name] as ScopeFormRow | undefined
                              const cid = row?.collegeId
                              return (
                                <Form.Item
                                  label="专业"
                                  name={[f.name, 'major']}
                                  rules={[{ required: true, message: '请选择专业' }]}
                                  style={{ width: 220 }}
                                >
                                  <Select
                                    options={(majorsByCollege[cid ?? ''] ?? []).map((m) => ({ label: m, value: m }))}
                                    onChange={() => {
                                      form.setFieldValue(['scopes', f.name, 'classIds'], [])
                                    }}
                                  />
                                </Form.Item>
                              )
                            }}
                          </Form.Item>
                          <Form.Item
                            dependencies={[
                              ['scopes', f.name, 'collegeId'],
                              ['scopes', f.name, 'grade'],
                              ['scopes', f.name, 'major'],
                            ]}
                            noStyle
                          >
                            {() => {
                              const row = (form.getFieldValue('scopes') || [])[f.name] as ScopeFormRow | undefined
                              return (
                                <Form.Item
                                  label="班级（可多选）"
                                  name={[f.name, 'classIds']}
                                  rules={[{ required: true, message: '请选择班级' }]}
                                  style={{ width: 360 }}
                                >
                                  <Select mode="multiple" options={classOptionsForRow(row)} allowClear />
                                </Form.Item>
                              )
                            }}
                          </Form.Item>
                        </Space>
                      </Card>
                    ))}
                    <Button type="dashed" onClick={() => add({})} icon={<PlusOutlined />}>
                      添加辖区（跨学院/多班级）
                    </Button>
                  </>
                )}
              </Form.List>
            ) : null}

            {!showMultiCounselorScopes && (collegeScoped || role === 'ADMIN') ? (
              <Space size={12} align="start" wrap style={{ width: '100%' }}>
                <Form.Item label="学院" name="collegeId" rules={[{ required: true, message: '请选择学院' }]} style={{ width: 220 }}>
                  <Select
                    disabled={collegeScoped}
                    options={colleges.map((c) => ({ label: `${c.name}（${c.id}）`, value: c.id }))}
                    allowClear={!collegeScoped}
                    onChange={() => {
                      form.setFieldsValue({ grade: undefined, major: undefined, classIds: [] })
                    }}
                  />
                </Form.Item>
                {collegeScoped ? (
                  <>
                    <Form.Item label="年级" name="grade" rules={[{ required: true, message: '请选择年级' }]} style={{ width: 160 }}>
                      <Select
                        options={['2023', '2024', '2025'].map((g) => ({ label: g, value: g }))}
                        allowClear
                        onChange={() => {
                          form.setFieldsValue({ major: undefined, classIds: [] })
                        }}
                      />
                    </Form.Item>
                    <Form.Item label="专业" name="major" rules={[{ required: true, message: '请选择专业' }]} style={{ width: 220 }}>
                      <Select
                        options={(majorsByCollege[collegeId ?? ''] ?? []).map((m) => ({ label: m, value: m }))}
                        allowClear
                        onChange={() => {
                          form.setFieldsValue({ classIds: [] })
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      label="班级（可多选）"
                      name="classIds"
                      rules={[{ required: true, message: '请选择班级' }]}
                      style={{ width: 360 }}
                    >
                      <Select mode="multiple" options={classOptions} allowClear />
                    </Form.Item>
                  </>
                ) : null}
              </Space>
            ) : null}

            <Form.Item style={{ marginBottom: 0 }}>
              <Space>
                <Button type="primary" htmlType="submit" loading={loading}>
                  保存配置
                </Button>
                <Button onClick={() => form.resetFields()}>重置</Button>
              </Space>
            </Form.Item>
          </div>
        </Form>
      </Card>
    </div>
  )
}
