import { useState } from 'react'
import { Card, Form, Input, Switch, Button, App as AntApp, Typography } from 'antd'
import { useAuth } from '../state/auth'
import { api } from '../mock/api'

export function FeedbackSubmitPage() {
  const { token } = useAuth()
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)

  return (
    <div className="page">
      <Card title="意见反馈">
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          描述使用问题、功能建议等。提交后由超级管理员在「用户反馈」中查看。
        </Typography.Paragraph>
        <Form
          form={form}
          layout="vertical"
          style={{ maxWidth: 640 }}
          initialValues={{ allowContact: false }}
          onFinish={async (v) => {
            setLoading(true)
            const r = await api.submitFeedback(token, {
              content: v.content as string,
              allowContact: Boolean(v.allowContact),
              contactEmail: (v.contactEmail as string | undefined)?.trim(),
              screenshotUrl: (v.screenshotUrl as string | undefined)?.trim(),
            })
            setLoading(false)
            if (!r.ok) {
              message.error(r.message)
              return
            }
            message.success('已提交，感谢反馈')
            form.resetFields()
            form.setFieldsValue({ allowContact: false })
          }}
        >
          <Form.Item
            label="反馈内容"
            name="content"
            rules={[{ required: true, message: '请填写反馈内容' }]}
          >
            <Input.TextArea rows={6} placeholder="请尽量写清场景、页面或操作步骤" maxLength={4000} showCount />
          </Form.Item>
          <Form.Item label="联系邮箱（选填）" name="contactEmail">
            <Input type="email" placeholder="便于回访时联系您" maxLength={255} />
          </Form.Item>
          <Form.Item
            label="截图链接（选填）"
            name="screenshotUrl"
            extra="若截图已上传到图床，可粘贴 https 链接"
          >
            <Input placeholder="https://..." maxLength={500} />
          </Form.Item>
          <Form.Item label="同意管理员就本反馈与我联系" name="allowContact" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading}>
              提交反馈
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
