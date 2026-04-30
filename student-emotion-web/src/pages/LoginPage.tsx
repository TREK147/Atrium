import { useEffect, useState } from 'react'
import { Card, Form, Input, Button, Space, Alert, App as AntApp } from 'antd'
import { useNavigate } from 'react-router-dom'
import { api } from '../mock/api'
import { useAuth } from '../state/auth'

export function LoginPage() {
  const [form] = Form.useForm()
  const nav = useNavigate()
  const { message } = AntApp.useApp()
  const { setToken, refresh, token, user } = useAuth()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (token && user) nav('/dashboard', { replace: true })
  }, [token, user, nav])

  return (
    <div style={{ height: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <Card style={{ width: 420 }} title="教职工登录">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="默认初始化账号"
            description={
              <div>
                <div>管理员：SuperManager / 123456</div>
                <div>教师：2011800051（孙晓）/ 123456</div>
                <div>教师：1999800037（徐本柱）/ 123456</div>
              </div>
            }
          />

          <Form
            form={form}
            layout="vertical"
            onFinish={async (v) => {
              setLoading(true)
              const r = await api.login({
                staffNo: v.staffNo,
                password: v.password,
              })
              setLoading(false)
              if (!r.ok) {
                message.error(r.message)
                return
              }
              setToken(r.data.token)
              await refresh()
              if (r.data.role === 'ADMIN') nav('/admin/accounts', { replace: true })
              else nav('/counselor/archive', { replace: true })
            }}
          >
            <Form.Item
              label="工号"
              name="staffNo"
              rules={[{ required: true, message: '请输入工号' }]}
            >
              <Input placeholder="例如：SuperManager / 2011800051" autoComplete="username" />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录
            </Button>
          </Form>
        </Space>
      </Card>
    </div>
  )
}

