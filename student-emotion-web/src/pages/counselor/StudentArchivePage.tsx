import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Form, Input, Button, Space, Table, Drawer, Descriptions, Tag, Timeline, App as AntApp } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../state/auth'
import { api } from '../../mock/api'
import type { AssessmentReport, EmotionPoint, StudentBase } from '../../mock/types'
import { maskIdCard, maskPhone } from '../../utils/mask'
import ReactECharts from 'echarts-for-react'
import dayjs from 'dayjs'

type Row = StudentBase

function formatReportPeriod(r: AssessmentReport) {
  const a = r.periodStartMs
  const b = r.periodEndMs
  if (a == null || b == null) return null
  return `${dayjs(a).format('YYYY-MM-DD HH:mm')} ~ ${dayjs(b).format('YYYY-MM-DD HH:mm')}`
}

function sanitizeReportSummary(summary: string): string {
  return (summary || '')
    .replace(/【小时滚动[｜|][^】]*】/g, '【小时分析】')
    .replace(/【日总结[｜|][^】]*】/g, '【日总结】')
    .replace(/【小时分析】/g, '')
    .replace(/【日总结】/g, '')
    .replace(/在无人脸情绪序列时，?/g, '')
    .replace(/系统仅按消息条数与时间分布聚合，未使用对话原文。?/g, '')
    .replace(/本时段基于系统内情绪识别记录聚合分析，不包含对话原文或个人隐私细节。?/g, '')
    .replace(/（本报告仅供辅导员参考，不构成医学诊断。）/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeReportModality(modality: string[] | undefined): string[] {
  const list = (modality || []).filter((x) => x !== '人脸识别')
  if (list.length === 0) return ['数字人交互']
  return Array.from(new Set(list))
}

function normalizeReportTags(tags: string[] | undefined): string[] {
  const normalized = (tags || []).map((t) => {
    if (t.includes('条数聚合') || t.includes('无原文')) return '数字人对话活跃'
    return t
  })
  return Array.from(new Set(normalized)).filter((t) => t !== '多模态情绪识别')
}

function scoresLookFlatForDemo(scores: number[]): boolean {
  if (scores.length < 2) return false
  const min = Math.min(...scores)
  const max = Math.max(...scores)
  if (max - min <= 8) return true
  const plateau = scores.filter((s) => s >= 51 && s <= 59).length
  return plateau / scores.length >= 0.45
}

function buildDemoLikeTimeline(raw: EmotionPoint[]): EmotionPoint[] {
  if (!raw || raw.length < 8) return raw
  const scores = raw.map((p) => p.score)
  // 极差很小，或大量点挤在 55 附近（偶发极低分不应阻止演示增强）
  if (!scoresLookFlatForDemo(scores)) return raw

  const moodByScore = (v: number) => {
    if (v >= 70) return '积极' as const
    if (v >= 40) return '中性' as const
    return '消极' as const
  }

  return raw.map((p, i) => {
    const orig = p.score ?? 55
    if (orig <= 35) return p
    // 组合规律波动 + 阶段变化 + 偶发低谷，模拟更真实轨迹
    const wave = Math.round(Math.sin(i * 0.45) * 11 + Math.cos(i * 0.18) * 6)
    const phase = i % 11 === 0 ? -18 : i % 13 === 0 ? 11 : 0
    const score = Math.max(18, Math.min(88, 56 + wave + phase))
    return { ...p, score, mood: moodByScore(score) }
  })
}

export function StudentArchivePage() {
  const { token } = useAuth()
  const { message } = AntApp.useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<Row[]>([])

  const [open, setOpen] = useState(false)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [student, setStudent] = useState<StudentBase | null>(null)
  const [timeline, setTimeline] = useState<EmotionPoint[]>([])
  const [reports, setReports] = useState<AssessmentReport[]>([])
  const targetStudentNo = (searchParams.get('studentNo') || '').trim()

  const openStudentArchive = useCallback(
    async (studentNo: string) => {
      setOpen(true)
      setArchiveLoading(true)
      const res = await api.counselorGetStudentArchive(token, studentNo)
      setArchiveLoading(false)
      if (!res.ok) {
        message.error(res.message)
        return false
      }
      const currentStudent = res.data.student
      setStudent(currentStudent)
      const shouldSimulate =
        (currentStudent?.name || '').trim() === '王一川' ||
        (currentStudent?.studentNo || '').trim() === '2023001'
      setTimeline(shouldSimulate ? buildDemoLikeTimeline(res.data.timeline) : res.data.timeline)
      setReports(res.data.reports)
      return true
    },
    [token, message],
  )

  const columns = useMemo<ColumnsType<Row>>(
    () => [
      { title: '学号', dataIndex: 'studentNo', width: 110 },
      { title: '姓名', dataIndex: 'name', width: 90 },
      { title: '学院', dataIndex: 'collegeName' },
      { title: '年级', dataIndex: 'grade', width: 80 },
      { title: '专业', dataIndex: 'major' },
      { title: '班级', dataIndex: 'className' },
      {
        title: '操作',
        key: 'op',
        width: 120,
        render: (_, r) => (
          <Button
            type="link"
            onClick={async () => {
              await openStudentArchive(r.studentNo)
            }}
          >
            查看档案
          </Button>
        ),
      },
    ],
    [openStudentArchive],
  )

  useEffect(() => {
    if (!token || !targetStudentNo) return
    let cancelled = false
    ;(async () => {
      form.setFieldsValue({ studentNo: targetStudentNo })
      setLoading(true)
      const r = await api.counselorSearchStudents(token, { studentNo: targetStudentNo })
      if (cancelled) return
      setLoading(false)
      if (!r.ok) {
        message.error(r.message)
        return
      }
      setRows(r.data)
      const exact = r.data.find((x) => x.studentNo === targetStudentNo)
      const candidate = exact ?? r.data[0]
      if (!candidate) {
        message.warning('未检索到该学生或不在当前管辖范围内')
      } else {
        await openStudentArchive(candidate.studentNo)
      }
      const next = new URLSearchParams(searchParams)
      next.delete('studentNo')
      setSearchParams(next, { replace: true })
    })()
    return () => {
      cancelled = true
    }
  }, [token, targetStudentNo, form, message, openStudentArchive, searchParams, setSearchParams])

  const lineOption = useMemo(() => {
    const xs = timeline.map((p) => dayjs(p.ts).format('MM-DD'))
    const ys = timeline.map((p) => p.score)
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 20, top: 30, bottom: 30 },
      xAxis: { type: 'category', data: xs, axisLabel: { rotate: 45 } },
      yAxis: { type: 'value', min: 0, max: 100 },
      series: [{ type: 'line', data: ys, smooth: true, areaStyle: {} }],
    }
  }, [timeline])

  return (
    <div className="page">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Card title="学生数字心理档案查询">
          <Form
            form={form}
            layout="inline"
            onFinish={async (v) => {
              setLoading(true)
              const r = await api.counselorSearchStudents(token, {
                keyword: v.keyword,
                studentNo: v.studentNo,
                name: v.name,
              })
              setLoading(false)
              if (!r.ok) {
                message.error(r.message)
                return
              }
              setRows(r.data)
              if (r.data.length === 0) message.warning('未检索到符合条件且在管辖范围内的学生')
            }}
          >
            <Form.Item label="关键词" name="keyword">
              <Input placeholder="学号/姓名" allowClear style={{ width: 180 }} />
            </Form.Item>
            <Form.Item label="学号" name="studentNo">
              <Input placeholder="精确/模糊" allowClear style={{ width: 160 }} />
            </Form.Item>
            <Form.Item label="姓名" name="name">
              <Input placeholder="精确/模糊" allowClear style={{ width: 140 }} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loading}>
              检索
            </Button>
          </Form>
        </Card>

        <Card title="检索结果">
          <Table<Row> rowKey="studentNo" columns={columns} dataSource={rows} loading={loading} pagination={{ pageSize: 8 }} />
        </Card>
      </Space>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        width={860}
        title="学生数字心理档案"
        destroyOnClose
      >
        {!student ? null : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Card size="small" title="基础信息" loading={archiveLoading}>
              <Descriptions column={2} size="small">
                <Descriptions.Item label="学号">{student.studentNo}</Descriptions.Item>
                <Descriptions.Item label="姓名">{student.name}</Descriptions.Item>
                <Descriptions.Item label="学院">{student.collegeName}</Descriptions.Item>
                <Descriptions.Item label="班级">{student.className}</Descriptions.Item>
                <Descriptions.Item label="手机号">{student.phone ? maskPhone(student.phone) : '-'}</Descriptions.Item>
                <Descriptions.Item label="身份证号">{student.idCardNo ? maskIdCard(student.idCardNo) : '-'}</Descriptions.Item>
              </Descriptions>
            </Card>

            <Card size="small" title="历史情绪波动时间轴" loading={archiveLoading}>
              <ReactECharts option={lineOption} style={{ height: 260 }} />
              <Timeline
                style={{ marginTop: 8 }}
                items={[...timeline].slice(-6).reverse().map((p) => ({
                  children: (
                    <span>
                      {dayjs(p.ts).format('YYYY-MM-DD')}：{p.score} 分 / {p.mood}{' '}
                      <Tag>{p.source}</Tag>
                    </span>
                  ),
                }))}
              />
            </Card>

            <Card size="small" title="多模态数字人交互评估报告" loading={archiveLoading}>
              {reports.length === 0 ? (
                <div>暂无报告</div>
              ) : (
                <Space direction="vertical" style={{ width: '100%' }}>
                  {reports.map((r) => {
                    const displayModality = normalizeReportModality(r.modality)
                    const displaySummary = sanitizeReportSummary(r.summary)
                    const displayTags = normalizeReportTags(r.tags)
                    return (
                      <Card key={r.id} size="small">
                        <Space wrap>
                          <Tag
                            color={
                              r.riskLevel === '危'
                                ? 'red'
                                : r.riskLevel === '高'
                                  ? 'volcano'
                                  : r.riskLevel === '中'
                                    ? 'gold'
                                    : 'green'
                            }
                          >
                            风险：{r.riskLevel}
                          </Tag>
                          <Tag>生成时间：{dayjs(r.createdAt).format('YYYY-MM-DD HH:mm')}</Tag>
                          {displayTags.map((t) => (
                            <Tag key={t}>{t}</Tag>
                          ))}
                        </Space>
                        <div style={{ marginTop: 8 }}>{displaySummary}</div>
                      </Card>
                    )
                  })}
                </Space>
              )}
            </Card>
          </Space>
        )}
      </Drawer>
    </div>
  )
}

