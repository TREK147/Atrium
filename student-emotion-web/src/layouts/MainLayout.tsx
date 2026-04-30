import { App, Layout, Menu, Space, Button, Tag } from 'antd'
import {
  DashboardOutlined,
  SearchOutlined,
  AlertOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  FileSearchOutlined,
  MessageOutlined,
  CommentOutlined,
  LogoutOutlined,
  KeyOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/auth'
import { counselorCollegeNames, isMultiCollegeCounselor } from '../utils/counselorDisplay'
import { api } from '../mock/api'
import { useEffect, useMemo, useRef } from 'react'

const { Header, Sider, Content } = Layout

export function MainLayout() {
  const { notification } = App.useApp()
  const { user, token, logout } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  /** 每条待处理预警上次已提示的内容快照；等级/原因变化会再次提醒；非 NEW 会从 Map 剔除 */
  const alertNotifySnap = useRef<Map<string, string>>(new Map())

  const menuItems = useMemo(() => {
    const common = [
      { key: '/dashboard', icon: <DashboardOutlined />, label: '主页总览' },
      ...(user?.staffNo === 'SuperManager'
        ? []
        : [{ key: '/feedback', icon: <CommentOutlined />, label: '意见反馈' }]),
    ]
    const counselor =
      user?.role === 'COUNSELOR' || user?.role === 'ADMIN'
        ? [
            { key: '/counselor/archive', icon: <SearchOutlined />, label: '心理档案查询' },
            { key: '/counselor/alerts', icon: <AlertOutlined />, label: '预警与干预' },
          ]
        : []
    const isSemFullAdmin =
      user?.staffNo === 'SuperManager' ||
      (user?.role === 'ADMIN' && !(user?.scope?.collegeId || user?.scope?.collegeName))
    const admin =
      user?.role === 'ADMIN'
        ? [
            { key: '/admin/accounts', icon: <UserOutlined />, label: '账号管理' },
            { key: '/admin/role-scope', icon: <SafetyCertificateOutlined />, label: '角色/范围配置' },
            ...(isSemFullAdmin
              ? [
                  { key: '/admin/thresholds', icon: <SettingOutlined />, label: '预警阈值设置' },
                  { key: '/admin/audit', icon: <FileSearchOutlined />, label: '安全审计日志' },
                  { key: '/admin/feedback', icon: <MessageOutlined />, label: '用户反馈' },
                ]
              : []),
          ]
        : []
    const security = [
      { type: 'divider' as const },
      { key: '/change-password', icon: <KeyOutlined />, label: '修改密码' },
    ]
    return [...common, ...counselor, ...admin, ...security]
  }, [user?.role, user?.staffNo, user?.scope?.collegeId, user?.scope?.collegeName])

  const selectedKeys = useMemo(() => {
    const p = loc.pathname
    const exact = menuItems.find((x: any) => x.key === p)
    if (exact) return [p]
    const prefixes = (menuItems as any[])
      .map((x) => x.key)
      .filter((k) => typeof k === 'string' && k !== '/')
      .sort((a, b) => b.length - a.length)
    const hit = prefixes.find((k) => p.startsWith(k))
    return hit ? [hit] : ['/dashboard']
  }, [loc.pathname, menuItems])

  useEffect(() => {
    if (!user || !token) return
    if (user.role !== 'COUNSELOR') return
    const tick = async () => {
      const r = await api.counselorListAlerts(token)
      if (!r.ok) return
      const freshNew = r.data.filter((a) => a.status === 'NEW')
      const newIdSet = new Set(freshNew.map((a) => a.id))
      for (const k of [...alertNotifySnap.current.keys()]) {
        if (!newIdSet.has(k)) alertNotifySnap.current.delete(k)
      }
      freshNew.forEach((a) => {
        const snap = `${a.level}|${a.updatedAt ?? ''}|${(a.reason || '').slice(0, 200)}`
        if (alertNotifySnap.current.get(a.id) === snap) return
        alertNotifySnap.current.set(a.id, snap)
        notification.warning({
          message: `异常情绪预警：${a.level}`,
          description: `${a.studentName}（${a.studentNo}）：${a.reason}`,
          placement: 'topRight',
          duration: 6,
          onClick: () => nav('/counselor/alerts'),
        })
      })
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 5000)
    return () => window.clearInterval(timer)
  }, [user?.role, user?.staffNo, token, nav, notification])

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider theme="light" width={220}>
        <div style={{ height: 56, display: 'flex', alignItems: 'center', padding: '0 16px' }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>学生情绪管理</h3>
        </div>
        <Menu
          mode="inline"
          items={menuItems as any}
          selectedKeys={selectedKeys}
          onClick={(e) => nav(e.key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '100%' }}>
            <Space size={12}>
              <span style={{ fontWeight: 600 }}>{user?.name}</span>
              <Tag color={user?.role === 'ADMIN' ? 'geekblue' : 'green'}>
                {user?.role === 'COUNSELOR' && isMultiCollegeCounselor(user)
                  ? `（${counselorCollegeNames(user).join('、')}）辅导员`
                  : user?.roleName}
              </Tag>
              {user?.role === 'COUNSELOR' ? (
                (() => {
                  const blocks =
                    user.scopes && user.scopes.length > 0
                      ? user.scopes
                      : user.scope
                        ? [user.scope]
                        : []
                  if (!blocks.length) return null
                  const text = blocks
                    .map(
                      (s) =>
                        `${s.collegeName}/${s.grade}/${s.major}（${(s.classIds ?? []).join('、')}）`,
                    )
                    .join('；')
                  return (
                    <span style={{ color: '#8c8c8c' }} title={text}>
                      管辖：{text}
                    </span>
                  )
                })()
              ) : null}
            </Space>
            <Space>
              <Button icon={<LogoutOutlined />} onClick={() => void logout()}>
                退出
              </Button>
            </Space>
          </div>
        </Header>
        <Content style={{ overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

