import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Table, Space, Button, App as AntApp, Tag, Image, Popconfirm } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { useAuth } from '../../state/auth'
import { api } from '../../mock/api'
import type { UserFeedback } from '../../mock/types'

export function UserFeedbackPage() {
  const { token } = useAuth()
  const { message } = AntApp.useApp()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<UserFeedback[]>([])

  const refresh = useCallback(async () => {
    setLoading(true)
    const r = await api.adminListUserFeedback(token)
    setLoading(false)
    if (!r.ok) {
      message.error(r.message)
      return
    }
    setRows(r.data)
  }, [token, message])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const columns = useMemo<ColumnsType<UserFeedback>>(
    () => [
      { title: '时间', dataIndex: 'created_at', width: 170, render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm:ss') },
      { title: '用户', key: 'user', width: 180, render: (_, r) => `${r.username || '-'}（${r.email || '-'}）` },
      {
        title: '联系意愿',
        dataIndex: 'allow_contact',
        width: 120,
        render: (v) => <Tag color={v ? 'blue' : 'default'}>{v ? '可联系' : '不联系'}</Tag>,
      },
      {
        title: '截图',
        dataIndex: 'screenshot_url',
        width: 140,
        render: (v) => (v ? <Image width={72} src={v} /> : '-'),
      },
      { title: '反馈内容', dataIndex: 'content' },
      {
        title: '操作',
        key: 'op',
        width: 100,
        render: (_, r) => (
          <Popconfirm
            title="确定删除该条反馈？"
            description="删除后不可恢复。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              const res = await api.adminDeleteUserFeedback(token, r.id)
              if (!res.ok) {
                message.error(res.message)
                return
              }
              message.success('已删除')
              await refresh()
            }}
          >
            <Button type="link" danger size="small">
              删除
            </Button>
          </Popconfirm>
        ),
      },
    ],
    [message, token, refresh],
  )

  return (
    <div className="page">
      <Card
        title="用户反馈"
        extra={
          <Space>
            <Button onClick={() => void refresh()} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      >
        <Table<UserFeedback> rowKey="id" columns={columns} dataSource={rows} loading={loading} pagination={{ pageSize: 10 }} />
      </Card>
    </div>
  )
}

