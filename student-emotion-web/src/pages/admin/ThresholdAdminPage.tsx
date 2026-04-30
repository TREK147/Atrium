import { useEffect, useState } from 'react'
import { Card, Form, InputNumber, Button, Space, Slider, App as AntApp, Input } from 'antd'
import { useAuth } from '../../state/auth'
import { api } from '../../mock/api'
import type { ThresholdConfig } from '../../mock/types'

export function ThresholdAdminPage() {
  const { token } = useAuth()
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    const r = await api.adminGetThreshold(token)
    setLoading(false)
    if (!r.ok) {
      message.error(r.message)
      return
    }
    form.setFieldsValue({
      sensitivity: r.data.sensitivity,
      levelRules: r.data.levelRules,
    } satisfies Partial<ThresholdConfig>)
  }

  useEffect(() => {
    void load()
  }, [token])

  return (
    <div className="page">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Card title="预警阈值设置">
          <Form
            form={form}
            layout="vertical"
            onFinish={async (v) => {
              const r = await api.adminUpdateThreshold(token, {
                sensitivity: v.sensitivity,
                levelRules: v.levelRules,
              })
              if (!r.ok) {
                message.error(r.message)
                return
              }
              message.success('已保存并记录审计日志')
              await load()
            }}
          >
            <Form.Item label="算法敏感度（0-100）" name="sensitivity" rules={[{ required: true }]}>
              <Slider min={0} max={100} />
            </Form.Item>

            <Card size="small" title="危险等级划分（按情绪分数区间）">
              <Form.List name="levelRules">
                {(fields) => (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {fields.map((f) => (
                      <Space key={f.key} wrap>
                        <Form.Item label="等级" name={[f.name, 'level']} style={{ width: 120 }}>
                          <Input disabled />
                        </Form.Item>
                        <Form.Item label="最小分" name={[f.name, 'minScore']} rules={[{ required: true }]} style={{ width: 160 }}>
                          <InputNumber min={0} max={100} style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item label="最大分" name={[f.name, 'maxScore']} rules={[{ required: true }]} style={{ width: 160 }}>
                          <InputNumber min={0} max={100} style={{ width: '100%' }} />
                        </Form.Item>
                      </Space>
                    ))}
                  </Space>
                )}
              </Form.List>
            </Card>

            <Space style={{ marginTop: 12 }}>
              <Button type="primary" htmlType="submit" loading={loading}>
                保存
              </Button>
              <Button onClick={() => void load()} loading={loading}>
                重新加载
              </Button>
            </Space>
          </Form>
        </Card>
      </Space>
    </div>
  )
}

