import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Card, Table, Tag, Space, Button, App as AntApp, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { useAuth } from '../../state/auth'
import { api } from '../../mock/api'
import type { AuditLog } from '../../mock/types'

const ellipsisOneLine: CSSProperties = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** 审计「动作」英文码 → 中文说明（原始码放在 Tooltip 里便于检索） */
function auditActionTitle(action: string): string {
  const m: Record<string, string> = {
    ALERT_STATUS_UPDATE: '预警：状态/备注更新',
    ALERT_RUNTIME_CLEARED: '预警：已消除（合并 runtime）',
    USER_FEEDBACK: '意见反馈提交',
    USER_FEEDBACK_DELETE: '用户反馈删除',
    LOGIN_SUCCESS: '登录成功',
    LOGIN_FAIL: '登录失败',
    LOGOUT: '退出登录',
    PASSWORD_CHANGE: '修改密码',
    ROLE_SCOPE_UPDATE: '角色/范围变更',
    THRESHOLD_UPDATE: '预警阈值调整',
  }
  return m[action] ?? action
}

export function AuditLogPage() {
  const { token } = useAuth()
  const { message } = AntApp.useApp()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<AuditLog[]>([])

  async function refresh() {
    setLoading(true)
    const r = await api.adminListAuditLogs(token)
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

  const columns = useMemo<ColumnsType<AuditLog>>(
    () => [
      { title: '时间', dataIndex: 'ts', width: 170, render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm:ss') },
      {
        title: '动作',
        dataIndex: 'action',
        width: 220,
        onCell: () => ({ style: { overflow: 'hidden', verticalAlign: 'middle' } }),
        render: (v: string) => (
          <Tooltip placement="topLeft" title={`${auditActionTitle(v)}\n代码：${v}`}>
            <Tag
              style={{
                margin: 0,
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'inline-block',
              }}
            >
              {auditActionTitle(v)}
            </Tag>
          </Tooltip>
        ),
      },
      {
        title: '操作人',
        key: 'actor',
        width: 200,
        ellipsis: true,
        onCell: () => ({ style: { paddingLeft: 8 } }),
        render: (_, r) => (r.actorStaffNo ? `${r.actorName ?? ''}（${r.actorStaffNo}）` : '-'),
      },
      { title: '目标学生', dataIndex: 'targetStudentNo', width: 108, render: (v) => v ?? '-' },
      { title: '目标账号', dataIndex: 'targetStaffNo', width: 108, render: (v) => v ?? '-' },
      { title: 'IP', dataIndex: 'ip', width: 118 },
      {
        title: '设备',
        dataIndex: 'device',
        width: 200,
        ellipsis: true,
        render: (text: string) => (
          <Tooltip title={text} placement="topLeft">
            <span style={ellipsisOneLine}>{text}</span>
          </Tooltip>
        ),
      },
      {
        title: '内容',
        dataIndex: 'detail',
        width: 420,
        ellipsis: true,
        render: (text: string) => (
          <Tooltip title={text} placement="topLeft">
            <span style={ellipsisOneLine}>{text}</span>
          </Tooltip>
        ),
      },
    ],
    [],
  )

  return (
    <div className="page">
      <Card
        title="系统安全与审计日志"
        extra={
          <Space>
            <Button onClick={() => void refresh()} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      >
        <Table<AuditLog>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1544 }}
          tableLayout="fixed"
        />
      </Card>
    </div>
  )
}

