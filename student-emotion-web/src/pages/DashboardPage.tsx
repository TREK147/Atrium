import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Tag, Space, Statistic, Segmented, Row, Col, App as AntApp, List, Button, Tooltip, Modal } from 'antd'
import { RightOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../state/auth'
import { api } from '../mock/api'
import { counselorCollegeNames, isMultiCollegeCounselor } from '../utils/counselorDisplay'
import ReactECharts from 'echarts-for-react'
import dayjs from 'dayjs'

type Range = 'week' | 'month' | 'term'
type RiskTag = '高危' | '中危' | '低危' | '正常'

type MoodLabel = '积极' | '中性' | '消极'
type MoodStudentRow = { studentNo: string; name: string }

const alertLevelRank: Record<'低' | '中' | '高' | '危', number> = { 低: 1, 中: 2, 高: 3, 危: 4 }
const riskTagRank: Record<RiskTag, number> = { 正常: 1, 低危: 2, 中危: 3, 高危: 4 }

function mapAlertLevelToRiskTag(level: '低' | '中' | '高' | '危'): RiskTag {
  if (level === '危' || level === '高') return '高危'
  if (level === '中') return '中危'
  return '低危'
}

function riskTagColor(tag: RiskTag): string {
  if (tag === '高危') return 'red'
  if (tag === '中危') return 'volcano'
  if (tag === '低危') return 'gold'
  return 'green'
}

function resolveMoodModalRiskTag(mood: MoodLabel, riskTag: RiskTag | undefined): RiskTag {
  if (mood === '消极') {
    // “消极名单”使用更保守口径：即便暂无预警，也至少展示为低危
    return riskTag && riskTag !== '正常' ? riskTag : '低危'
  }
  return riskTag ?? '正常'
}

export function DashboardPage() {
  const { user, token } = useAuth()
  const nav = useNavigate()
  const { message } = AntApp.useApp()
  const canViewDashboard = user?.role === 'COUNSELOR' || user?.role === 'ADMIN'
  const [range, setRange] = useState<Range>('week')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{
    scopeLabel: string
    todayAvg: number
    distribution: Record<string, number>
    distributionStudents?: Record<MoodLabel, MoodStudentRow[]>
    trend: Array<{ ts: number; avg: number }>
    visibleCount: number
  } | null>(null)
  const [moodModal, setMoodModal] = useState<{ open: boolean; mood: MoodLabel; students: MoodStudentRow[] }>({
    open: false,
    mood: '中性',
    students: [],
  })
  const [riskByStudentNo, setRiskByStudentNo] = useState<Record<string, RiskTag>>({})
  const [topRiskStudents, setTopRiskStudents] = useState<Array<{ studentNo: string; name: string; riskTag: RiskTag }>>([])
  const [riskRanking, setRiskRanking] = useState<Array<{ studentNo: string; name: string; riskTag: RiskTag }>>([])
  const [riskRankingOpen, setRiskRankingOpen] = useState(false)
  const [collegeMajorSummary, setCollegeMajorSummary] = useState<Array<{ collegeName: string; major: string; count: number }>>([])
  const [todayNewAlertCount, setTodayNewAlertCount] = useState(0)
  const [studentListLoading, setStudentListLoading] = useState(false)
  /** 权限范围内学生总数，与周/月/学期维度无关（不随可视化 range 重拉而变） */
  const [inScopeStudentCount, setInScopeStudentCount] = useState<number | null>(null)

  useEffect(() => {
    if (!canViewDashboard) return
    ;(async () => {
      setLoading(true)
      const r = await api.counselorGetVisualization(token, { range })
      setLoading(false)
      if (!r.ok) {
        message.error(r.message)
        return
      }
      setData(r.data)
    })()
  }, [canViewDashboard, token, range, message])

  useEffect(() => {
    if (!canViewDashboard) return
    ;(async () => {
      setStudentListLoading(true)
      const [studentRes, alertRes] = await Promise.all([api.counselorSearchStudents(token, {}), api.counselorListAlerts(token)])
      setStudentListLoading(false)
      if (!studentRes.ok) {
        message.error(studentRes.message)
        return
      }
      if (!alertRes.ok) {
        message.error(alertRes.message)
        return
      }

      setInScopeStudentCount(studentRes.data.length)

      const highestAlertLevelByStudentNo: Record<string, '低' | '中' | '高' | '危'> = {}
      for (const alert of alertRes.data) {
        if (alert.status === 'CLEARED') continue
        const prev = highestAlertLevelByStudentNo[alert.studentNo]
        if (!prev || alertLevelRank[alert.level] > alertLevelRank[prev]) {
          highestAlertLevelByStudentNo[alert.studentNo] = alert.level
        }
      }

      const rows = studentRes.data
        .map((student) => {
          const level = highestAlertLevelByStudentNo[student.studentNo]
          return {
            studentNo: student.studentNo,
            name: student.name,
            riskTag: level ? mapAlertLevelToRiskTag(level) : ('正常' as RiskTag),
          }
        })
        .sort((a, b) => {
          const riskDiff = riskTagRank[b.riskTag] - riskTagRank[a.riskTag]
          if (riskDiff !== 0) return riskDiff
          return a.studentNo.localeCompare(b.studentNo)
        })

      const top3 = rows.filter((x) => x.riskTag !== '正常').slice(0, 3)
      const riskMap: Record<string, RiskTag> = {}
      for (const row of rows) riskMap[row.studentNo] = row.riskTag
      setRiskByStudentNo(riskMap)
      setTopRiskStudents(top3)
      setRiskRanking(rows.filter((x) => x.riskTag !== '正常'))
      const startOfToday = dayjs().startOf('day').valueOf()
      const todayNew = alertRes.data.filter((a) => a.createdAt >= startOfToday && a.status === 'NEW').length
      setTodayNewAlertCount(todayNew)

      const agg = new Map<string, { collegeName: string; major: string; count: number }>()
      for (const student of studentRes.data) {
        const key = `${student.collegeName}|${student.major}`
        const prev = agg.get(key)
        if (prev) prev.count += 1
        else agg.set(key, { collegeName: student.collegeName, major: student.major, count: 1 })
      }
      setCollegeMajorSummary(
        Array.from(agg.values()).sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count
          return `${a.collegeName}${a.major}`.localeCompare(`${b.collegeName}${b.major}`)
        }),
      )
    })()
  }, [canViewDashboard, token, message])

  const pieOption = useMemo(() => {
    const dist = data?.distribution ?? { 积极: 0, 中性: 0, 消极: 0 }
    const pieData = Object.entries(dist).map(([name, value]) => ({ name, value }))
    const neutralDataIndex = pieData.findIndex((d) => d.name === '中性')
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: { name: string; value: number; percent?: number }) => {
          const pct = typeof p.percent === 'number' ? p.percent.toFixed(2) : '0.00'
          return `${p.name}<br/>人数：${p.value}<br/>占比：${pct}%<br/>（点击查看名单）`
        },
      },
      legend: { bottom: 0 },
      series: [
        {
          type: 'pie',
          radius: ['35%', '65%'],
          avoidLabelOverlap: true,
          percentPrecision: 2,
          data: pieData,
          labelLayout: (params: { dataIndex?: number }) => {
            if (neutralDataIndex < 0 || params.dataIndex !== neutralDataIndex) return {}
            return { x: '74%', y: '48%' }
          },
          label: {
            show: true,
            position: 'outside',
            formatter: '{b}\n{d}%',
          },
          labelLine: { show: true, length: 14, length2: 10 },
          emphasis: {
            scale: true,
            scaleSize: 6,
            label: {
              formatter: '{b}\n{c}人（{d}%）',
            },
            labelLine: { show: true, length: 14, length2: 10 },
          },
        },
      ],
    }
  }, [data])

  const onPieSectorClick = useCallback(
    (params: { name?: string }) => {
      const name = params.name as MoodLabel | undefined
      if (name !== '积极' && name !== '中性' && name !== '消极') return
      const rows = data?.distributionStudents?.[name] ?? []
      setMoodModal({ open: true, mood: name, students: rows })
    },
    [data?.distributionStudents],
  )

  const trendOption = useMemo(() => {
    const xs = (data?.trend ?? []).map((x) => dayjs(x.ts).format('MM-DD'))
    const ys = (data?.trend ?? []).map((x) => Number(x.avg.toFixed(1)))
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 20, top: 30, bottom: 30 },
      xAxis: { type: 'category', data: xs, axisLabel: { rotate: 45 } },
      yAxis: { type: 'value', min: 0, max: 100 },
      series: [{ type: 'line', data: ys, smooth: true }],
    }
  }, [data])

  const collegeMajorOverviewTitle = useMemo(() => {
    if (user?.role === 'COUNSELOR') return '管辖范围内学院/专业概览'
    if (user?.scope?.collegeId || user?.scope?.collegeName) return '本权限范围内学院/专业概览'
    return '全校学院/专业概览'
  }, [user?.role, user?.scope?.collegeId, user?.scope?.collegeName])

  const trendChartTitle =
    range === 'week' ? '近一周整体情绪波动' : range === 'month' ? '近一月整体情绪波动' : '本学期整体情绪波动'

  return (
    <div className="page">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Card>
          <Space direction="vertical" size={6}>
            <h2 style={{ margin: 0, fontSize: 20 }}>
              欢迎，{user?.name}{' '}
              <Tag color={user?.role === 'ADMIN' ? 'geekblue' : 'green'}>
                {user?.role === 'COUNSELOR' && isMultiCollegeCounselor(user)
                  ? `（${counselorCollegeNames(user).join('、')}）辅导员`
                  : user?.roleName}
              </Tag>
            </h2>
          </Space>
        </Card>

        {canViewDashboard ? (
          <>
            <Card
              title="情绪数据可视化"
              extra={
                <Space>
                  <Tag>维度：{data?.scopeLabel ?? '-'}</Tag>
                  <Segmented
                    value={range}
                    onChange={(v) => setRange(v as Range)}
                    options={[
                      { label: '周', value: 'week' },
                      { label: '月', value: 'month' },
                      { label: '学期', value: 'term' },
                    ]}
                  />
                </Space>
              }
            >
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Card size="small" title={trendChartTitle} loading={loading}>
                    <ReactECharts option={trendOption} style={{ height: 240 }} />
                  </Card>
                </Col>
                <Col xs={24} md={12}>
                  <Card size="small" title="情绪分布比例" loading={loading}>
                    <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 6 }}>点击扇区或图例查看该情绪学生名单</div>
                    <ReactECharts
                      option={pieOption}
                      style={{ height: 220 }}
                      onEvents={{ click: onPieSectorClick }}
                    />
                  </Card>
                </Col>
              </Row>
              <Row gutter={12} style={{ marginTop: 12 }}>
                <Col xs={24}>
                  <Card
                    size="small"
                    title="可见学生数"
                    loading={studentListLoading && inScopeStudentCount === null}
                  >
                    <Statistic value={inScopeStudentCount ?? data?.visibleCount ?? 0} suffix="人" />
                  </Card>
                </Col>
              </Row>
              <Row gutter={12} style={{ marginTop: 12 }}>
                <Col xs={24} md={12}>
                  <Card
                    size="small"
                    loading={studentListLoading}
                    title={
                      <Space size={4}>
                        <span>今日新增预警数</span>
                        <Tooltip title="前往预警与干预">
                          <Button
                            type="text"
                            size="small"
                            icon={<RightOutlined />}
                            aria-label="前往预警与干预"
                            onClick={() => nav('/counselor/alerts')}
                          />
                        </Tooltip>
                      </Space>
                    }
                  >
                    <Statistic title="新增预警" value={todayNewAlertCount} suffix="条" />
                  </Card>
                </Col>
                <Col xs={24} md={12}>
                  <Card
                    size="small"
                    loading={studentListLoading}
                    title={
                      <Space size={4}>
                        <span>高危学生 Top 3</span>
                        <Tooltip title="查看风险榜单">
                          <Button
                            type="text"
                            size="small"
                            icon={<RightOutlined />}
                            aria-label="查看风险榜单"
                            onClick={() => setRiskRankingOpen(true)}
                          />
                        </Tooltip>
                      </Space>
                    }
                  >
                    <List
                      dataSource={topRiskStudents}
                      locale={{ emptyText: '当前无高危学生' }}
                      renderItem={(stu) => (
                        <List.Item>
                          <Space wrap>
                            <span>{stu.name}</span>
                            <Tag>{stu.studentNo}</Tag>
                            <Tag color={riskTagColor(stu.riskTag)}>{stu.riskTag}</Tag>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Card>
                </Col>
              </Row>
              <Card size="small" title={collegeMajorOverviewTitle} loading={studentListLoading} style={{ marginTop: 12 }}>
                <List
                  dataSource={collegeMajorSummary}
                  locale={{ emptyText: '暂无学院专业数据' }}
                  renderItem={(x) => (
                    <List.Item>
                      <Space wrap>
                        <Tag color="blue">{x.collegeName}</Tag>
                        <Tag>{x.major}</Tag>
                        <Tag color="green">{x.count} 人</Tag>
                      </Space>
                    </List.Item>
                  )}
                />
              </Card>
            </Card>
          </>
        ) : null}

        <Modal
          title={`「${moodModal.mood}」学生名单（${moodModal.students.length} 人）`}
          open={moodModal.open}
          onCancel={() => setMoodModal((m) => ({ ...m, open: false }))}
          footer={null}
          width={560}
          destroyOnClose
        >
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            <List
              size="small"
              dataSource={moodModal.students}
              locale={{ emptyText: '暂无学生' }}
              renderItem={(stu) => (
                <List.Item>
                  <Space wrap>
                    <span>{stu.name}</span>
                    <Tag>{stu.studentNo}</Tag>
                    <Tag
                      color={riskTagColor(resolveMoodModalRiskTag(moodModal.mood, riskByStudentNo[stu.studentNo]))}
                    >
                      {resolveMoodModalRiskTag(moodModal.mood, riskByStudentNo[stu.studentNo])}
                    </Tag>
                  </Space>
                </List.Item>
              )}
            />
          </div>
        </Modal>

        <Modal
          title={`风险榜单（${riskRanking.length} 人）`}
          open={riskRankingOpen}
          onCancel={() => setRiskRankingOpen(false)}
          footer={null}
          width={620}
          destroyOnClose
        >
          <div style={{ maxHeight: 460, overflow: 'auto' }}>
            <List
              size="small"
              dataSource={riskRanking}
              locale={{ emptyText: '当前无风险学生' }}
              renderItem={(stu, idx) => (
                <List.Item>
                  <Space wrap>
                    <Tag color="geekblue">#{idx + 1}</Tag>
                    <span>{stu.name}</span>
                    <Tag>{stu.studentNo}</Tag>
                    <Tag color={riskTagColor(stu.riskTag)}>{stu.riskTag}</Tag>
                  </Space>
                </List.Item>
              )}
            />
          </div>
        </Modal>
      </Space>
    </div>
  )
}

