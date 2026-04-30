import { useEffect, useMemo, useState } from 'react'
import { Card, Table, Tag, Space, Button, App as AntApp, Modal, Form, Input, Select } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { useAuth } from '../../state/auth'
import { api } from '../../mock/api'
import type { DataScope, RoleCode, UserAccountStatus } from '../../mock/types'

function isCollegeScopedAdmin(user: { role?: string; staffNo?: string; scope?: DataScope } | undefined) {
  if (!user || user.role !== 'ADMIN' || user.staffNo === 'SuperManager') return false
  return Boolean(user.scope?.collegeId || user.scope?.collegeName)
}

type Row = {
  id: string
  staffNo: string
  name: string
  role: RoleCode
  roleName: string
  scope?: DataScope
  status: UserAccountStatus
  failedLoginCount: number
  lockedUntil?: number
  lastLoginAt?: number
}

export function AccountAdminPage() {
  const { token, user } = useAuth()
  const { message } = AntApp.useApp()
  const [createForm] = Form.useForm()
  const [resetForm] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetTarget, setResetTarget] = useState<Row | null>(null)

  async function refresh() {
    setLoading(true)
    const r = await api.adminListAccounts(token)
    setLoading(false)
    if (!r.ok) {
      message.error(r.message)
      return
    }
    setRows(r.data)
  }

  useEffect(() => {
    void refresh()
  }, [token])

  const columns = useMemo<ColumnsType<Row>>(
    () => [
      { title: '工号', dataIndex: 'staffNo', width: 110 },
      { title: '姓名', dataIndex: 'name', width: 100 },
      {
        title: '角色',
        dataIndex: 'roleName',
        width: 180,
        render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span>,
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 110,
        render: (v) => <Tag color={v === 'ACTIVE' ? 'green' : v === 'LOCKED' ? 'gold' : 'red'}>{v}</Tag>,
      },
      { title: '失败次数', dataIndex: 'failedLoginCount', width: 90 },
      {
        title: '锁定至',
        dataIndex: 'lockedUntil',
        width: 170,
        render: (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
      },
      {
        title: '最近登录',
        dataIndex: 'lastLoginAt',
        width: 170,
        render: (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
      },
      {
        title: '操作',
        key: 'op',
        width: 340,
        render: (_, r) => (
          <Space>
            {r.staffNo === 'SuperManager' ? null : (
              <Button
                size="small"
                onClick={async () => {
                  const res = await api.adminSetAccountStatus(token, { staffNo: r.staffNo, status: 'ACTIVE' })
                  if (!res.ok) message.error(res.message)
                  else message.success('已启用')
                  await refresh()
                }}
              >
                启用
              </Button>
            )}
            {user?.staffNo === 'SuperManager' && r.staffNo === 'SuperManager' ? null : (
              <Button
                size="small"
                onClick={async () => {
                  const res = await api.adminSetAccountStatus(token, { staffNo: r.staffNo, status: 'FROZEN' })
                  if (!res.ok) message.error(res.message)
                  else message.success('已冻结（若在线将强制下线）')
                  await refresh()
                }}
                danger
              >
                冻结
              </Button>
            )}
            {user?.staffNo === 'SuperManager' && r.staffNo === 'SuperManager' ? null : (
              <Button
                size="small"
                onClick={async () => {
                  const res = await api.adminSetAccountStatus(token, { staffNo: r.staffNo, status: 'DISABLED' })
                  if (!res.ok) message.error(res.message)
                  else message.success('已停用（若在线将强制下线）')
                  await refresh()
                }}
              >
                停用
              </Button>
            )}
            {user?.staffNo === 'SuperManager' && r.staffNo === 'SuperManager' ? null : (
              <Button
                size="small"
                onClick={() => {
                  setResetTarget(r)
                  resetForm.setFieldsValue({ staffNo: r.staffNo, newPassword: '123456' })
                  setResetOpen(true)
                }}
              >
                重置密码
              </Button>
            )}
          </Space>
        ),
      },
    ],
    [token, message, resetForm, user?.staffNo, user?.role],
  )

  return (
    <div className="page">
      <Card
        title="账号列表"
        extra={
          <Space>
            {!isCollegeScopedAdmin(user) ? (
              <Button
                type="primary"
                onClick={() => {
                  createForm.setFieldsValue({ role: 'COUNSELOR', roleName: '辅导员', initPassword: '123456' })
                  setCreateOpen(true)
                }}
              >
                添加账号
              </Button>
            ) : null}
            <Button onClick={() => void refresh()} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      >
        <Table<Row> rowKey="id" columns={columns} dataSource={rows} loading={loading} pagination={{ pageSize: 8 }} />
      </Card>
      <Modal
        title="添加账号"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={async () => {
          const v = await createForm.validateFields()
          const res = await api.adminCreateAccount(token, {
            staffNo: v.staffNo,
            name: v.name,
            role: v.role,
            roleName: v.roleName,
            initPassword: v.initPassword,
          })
          if (!res.ok) {
            message.error(res.message)
            return
          }
          message.success('账号已添加')
          setCreateOpen(false)
          await refresh()
        }}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item label="工号" name="staffNo" rules={[{ required: true, message: '请输入工号' }]}>
            <Input placeholder="例如：T30001" />
          </Form.Item>
          <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true, message: '请选择角色' }]}>
            <Select
              options={[
                { label: '管理员（ADMIN）', value: 'ADMIN' },
                { label: '辅导员（COUNSELOR）', value: 'COUNSELOR' },
              ]}
              onChange={(v) => createForm.setFieldValue('roleName', v === 'ADMIN' ? '管理员' : '辅导员')}
            />
          </Form.Item>
          <Form.Item label="角色名称" name="roleName" rules={[{ required: true, message: '请输入角色名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="初始密码" name="initPassword" rules={[{ required: true, min: 6, message: '至少 6 位' }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={resetTarget ? `重置密码：${resetTarget.name}（${resetTarget.staffNo}）` : '重置密码'}
        open={resetOpen}
        onCancel={() => setResetOpen(false)}
        onOk={async () => {
          const v = await resetForm.validateFields()
          const res = await api.adminResetAccountPassword(token, { staffNo: v.staffNo, newPassword: v.newPassword })
          if (!res.ok) {
            message.error(res.message)
            return
          }
          message.success('密码已重置并恢复可登录')
          setResetOpen(false)
          await refresh()
        }}
      >
        <Form form={resetForm} layout="vertical">
          <Form.Item label="工号" name="staffNo" rules={[{ required: true }]}><Input disabled /></Form.Item>
          <Form.Item label="新密码" name="newPassword" rules={[{ required: true, min: 6, message: '至少 6 位' }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

