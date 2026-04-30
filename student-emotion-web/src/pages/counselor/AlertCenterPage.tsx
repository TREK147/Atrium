import { useEffect, useMemo, useState } from 'react'
import { Card, Table, Tag, Space, Button, Modal, Form, Input, App as AntApp } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CaretDownOutlined, CaretUpOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAuth } from '../../state/auth'
import { api } from '../../mock/api'
import type { AlertItem } from '../../mock/types'

function statusText(status: AlertItem['status']) {
  if (status === 'NEW') return '待处理'
  if (status === 'FOLLOWED') return '已跟进'
  return '已消除'
}

const alertLevelRank: Record<AlertItem['level'], number> = {
  低: 1,
  中: 2,
  高: 3,
  危: 4,
}

export function AlertCenterPage() {
  const { token } = useAuth()
  const { message } = AntApp.useApp()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<AlertItem[]>([])
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<AlertItem | null>(null)
  const [form] = Form.useForm()
  const [targetStatus, setTargetStatus] = useState<AlertItem['status']>('FOLLOWED')

  async function refresh() {
    setLoading(true)
    const r = await api.counselorListAlerts(token)
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

  const sortedRows = useMemo(() => {
    const list = [...rows]
    list.sort((a, b) => {
      const levelDiff = alertLevelRank[b.level] - alertLevelRank[a.level]
      if (levelDiff !== 0) return levelDiff

      const timeDiff = sortOrder === 'asc' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt
      if (timeDiff !== 0) return timeDiff

      return a.id.localeCompare(b.id)
    })
    return list
  }, [rows, sortOrder])

  const columns = useMemo<ColumnsType<AlertItem>>(
    () => [
      { title: '时间', dataIndex: 'createdAt', width: 160, render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm') },
      { title: '学生', key: 'stu', render: (_, r) => `${r.studentName}（${r.studentNo}）` },
      {
        title: '等级',
        dataIndex: 'level',
        width: 80,
        render: (v) => (
          <Tag color={v === '危' ? 'red' : v === '高' ? 'volcano' : v === '中' ? 'gold' : 'green'}>{v}</Tag>
        ),
      },
      { title: '原因', dataIndex: 'reason' },
      {
        title: '状态',
        dataIndex: 'status',
        width: 110,
        render: (v) => <Tag color={v === 'NEW' ? 'red' : v === 'FOLLOWED' ? 'blue' : 'green'}>{statusText(v)}</Tag>,
      },
      { title: '备注', dataIndex: 'note', width: 220, ellipsis: true },
      {
        title: '操作',
        key: 'op',
        width: 220,
        render: (_, r) => (
          <Space>
            <Button
              size="small"
              onClick={() => {
                setCurrent(r)
                setTargetStatus('FOLLOWED')
                setOpen(true)
                form.setFieldsValue({ note: r.note })
              }}
              disabled={r.status === 'CLEARED'}
            >
              标记已跟进
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                setCurrent(r)
                setTargetStatus('CLEARED')
                setOpen(true)
                form.setFieldsValue({ note: r.note })
              }}
            >
              标记已消除
            </Button>
          </Space>
        ),
      },
    ],
    [form],
  )

  return (
    <div className="page">
      <Card
        title={
          <Space size={8}>
            <span>异常情绪预警与干预</span>
            <span style={{ color: '#8c8c8c', fontSize: 12 }}>共4档，每满3条消极数据升一档</span>
          </Space>
        }
        extra={
          <Space align="center">
            <Space direction="vertical" size={2}>
              <Button
                size="small"
                icon={<CaretUpOutlined />}
                type="text"
                aria-label="按时间正序"
                onClick={() => setSortOrder('asc')}
                style={{
                  width: 20,
                  minWidth: 20,
                  height: 16,
                  padding: 0,
                  color: sortOrder === 'asc' ? '#262626' : '#bfbfbf',
                }}
              />
              <Button
                size="small"
                icon={<CaretDownOutlined />}
                type="text"
                aria-label="按时间倒序"
                onClick={() => setSortOrder('desc')}
                style={{
                  width: 20,
                  minWidth: 20,
                  height: 16,
                  padding: 0,
                  color: sortOrder === 'desc' ? '#262626' : '#bfbfbf',
                }}
              />
            </Space>
            <Button onClick={() => void refresh()}>刷新</Button>
          </Space>
        }
      >
        <Table<AlertItem>
          rowKey="id"
          columns={columns}
          dataSource={sortedRows}
          loading={loading}
          pagination={{ pageSize: 8 }}
        />
      </Card>

      <Modal
        open={open}
        title={targetStatus === 'FOLLOWED' ? '标记：已跟进/干预' : '标记：已消除'}
        onCancel={() => setOpen(false)}
        onOk={() => {
          if (!current) return Promise.reject()
          return form
            .validateFields()
            .then(async (v) => {
              const r = await api.counselorUpdateAlert(token, {
                id: current.id,
                status: targetStatus,
                note: v.note,
              })
              if (!r.ok) {
                message.error(r.message)
                throw new Error(r.message)
              }
              message.success('更新成功')
              setOpen(false)
              await refresh()
            })
            .catch(() => Promise.reject())
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="备注" name="note">
            <Input.TextArea rows={4} placeholder="填写跟进记录/干预措施/消除原因等" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

