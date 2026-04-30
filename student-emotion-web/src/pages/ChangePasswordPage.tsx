import { Card, Form, Input, Button, App as AntApp } from 'antd'
import { useAuth } from '../state/auth'
import { api } from '../mock/api'

export function ChangePasswordPage() {
  const [form] = Form.useForm()
  const { token } = useAuth()
  const { message } = AntApp.useApp()

  return (
    <div className="page">
      <Card title="修改密码" style={{ maxWidth: 560 }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={async (v) => {
            const r = await api.changePassword(token, { oldPassword: v.oldPassword, newPassword: v.newPassword })
            if (!r.ok) {
              message.error(r.message)
              return
            }
            message.success('密码修改成功')
            form.resetFields()
          }}
        >
          <Form.Item label="原密码" name="oldPassword" rules={[{ required: true, message: '请输入原密码' }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item label="新密码" name="newPassword" rules={[{ required: true, message: '请输入新密码' }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item
            label="确认新密码"
            name="newPassword2"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }: { getFieldValue: (name: string) => string | undefined }) => ({
                validator(_: unknown, value: string) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve()
                  return Promise.reject(new Error('两次输入不一致'))
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            提交修改
          </Button>
        </Form>
      </Card>
    </div>
  )
}

