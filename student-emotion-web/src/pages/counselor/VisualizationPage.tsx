import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Space, Statistic, Segmented, Row, Col, Tag, App as AntApp, Modal, List } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../state/auth'
import { api } from '../../mock/api'
import ReactECharts from 'echarts-for-react'
import dayjs from 'dayjs'

type Range = 'week' | 'month' | 'term'
type MoodLabel = '积极' | '中性' | '消极'
type MoodStudentRow = { studentNo: string; name: string }
type RiskTag = '高危' | '中危' | '低危' | '正常'

const alertLevelRank: Record<'低' | '中' | '高' | '危', number> = { 低: 1, 中: 2, 高: 3, 危: 4 }

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

export function VisualizationPage() {
  const { token } = useAuth()
  const nav = useNavigate()
  const { message } = AntApp.useApp()
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
  const [inScopeStudentCount, setInScopeStudentCount] = useState<number | null>(null)
  const [scopeCountLoading, setScopeCountLoading] = useState(false)

  useEffect(() => {
    if (!token) return
    ;(async () => {
      setScopeCountLoading(true)
      const r = await api.counselorSearchStudents(token, {})
      setScopeCountLoading(false)
      if (r.ok) setInScopeStudentCount(r.data.length)
    })()
  }, [token])

  useEffect(() => {
    if (!token) return
    ;(async () => {
      const r = await api.counselorListAlerts(token)
      if (!r.ok) return
      const highestAlertLevelByStudentNo: Record<string, '低' | '中' | '高' | '危'> = {}
      for (const alert of r.data) {
        if (alert.status === 'CLEARED') continue
        const prev = highestAlertLevelByStudentNo[alert.studentNo]
        if (!prev || alertLevelRank[alert.level] > alertLevelRank[prev]) {
          highestAlertLevelByStudentNo[alert.studentNo] = alert.level
        }
      }
      const nextRiskMap: Record<string, RiskTag> = {}
      Object.entries(highestAlertLevelByStudentNo).forEach(([studentNo, level]) => {
        nextRiskMap[studentNo] = mapAlertLevelToRiskTag(level)
      })
      setRiskByStudentNo(nextRiskMap)
    })()
  }, [token])

  useEffect(() => {
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
  }, [token, range, message])

  const pieOption = useMemo(() => {
    const dist = data?.distribution ?? { 积极: 0, 中性: 0, 消极: 0 }
    const pieData = Object.entries(dist).map(([name, value]) => ({ name, value }))
    const neutralDataIndex = pieData.findIndex((d) => d.name === '中性')
    return {
      tooltip: {
        trigger: 'item',
        formatter: '{b}<br/>人数：{c}<br/>占比：{d}%<br/>（点击查看名单）',
      },
      legend: { bottom: 0 },
      series: [
        {
          type: 'pie',
          radius: ['35%', '65%'],
          avoidLabelOverlap: true,
          data: pieData,
          percentPrecision: 2,
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
      const mood = params.name as MoodLabel | undefined
      if (mood !== '积极' && mood !== '中性' && mood !== '消极') return
      const students = data?.distributionStudents?.[mood] ?? []
      setMoodModal({ open: true, mood, students })
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

  const total = (data?.distribution?.积极 ?? 0) + (data?.distribution?.中性 ?? 0) + (data?.distribution?.消极 ?? 0)
  const positiveRatio = total ? ((data?.distribution?.积极 ?? 0) / total) * 100 : 0
  const negativeRatio = total ? ((data?.distribution?.消极 ?? 0) / total) * 100 : 0

  return (
    <div className="page">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Card
          title="情绪数据可视化（与学生端识别记录对齐）"
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
            <Col xs={24} md={8}>
              <Card size="small" loading={loading}>
                <Statistic title="今日情绪均值" value={Number((data?.todayAvg ?? 0).toFixed(1))} suffix="/100" />
                <div style={{ marginTop: 8 }}>
                  <Tag color="green">积极占比：{positiveRatio.toFixed(1)}%</Tag>
                  <Tag color="red">消极占比：{negativeRatio.toFixed(1)}%</Tag>
                </div>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" title="情绪分布比例" loading={loading}>
                <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 6 }}>点击扇区查看该情绪学生名单</div>
                <ReactECharts option={pieOption} style={{ height: 240 }} onEvents={{ click: onPieSectorClick }} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" title="可见学生数" loading={scopeCountLoading && inScopeStudentCount === null}>
                <Statistic value={inScopeStudentCount ?? data?.visibleCount ?? 0} suffix="人" />
                <div style={{ marginTop: 8 }}>
                  <Tag>全校/学院/班级维度均可按权限展示（此处随角色与范围变化）</Tag>
                </div>
              </Card>
            </Col>
          </Row>
        </Card>

        <Card title="情绪波动曲线（群体趋势）" loading={loading}>
          <ReactECharts option={trendOption} style={{ height: 320 }} />
        </Card>

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
                <List.Item
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setMoodModal((m) => ({ ...m, open: false }))
                    nav(`/counselor/archive?studentNo=${encodeURIComponent(stu.studentNo)}`)
                  }}
                >
                  <Space>
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
      </Space>
    </div>
  )
}

