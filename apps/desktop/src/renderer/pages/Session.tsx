import React, { useState, useEffect, useRef } from 'react'
import type { StatusInfo, QrInfo } from '../types.d'

export function SessionPage(): React.ReactElement {
  const [status, setStatus] = useState<StatusInfo>({ status: 'idle' })
  const [qrInfo, setQrInfo] = useState<QrInfo | null>(null)
  const [pairedAt, setPairedAt] = useState<number | null>(null)
  const [outputLines, setOutputLines] = useState<string[]>([])
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.getSessionStatus().then((s) => {
      setStatus({ status: s.status })
      if (s.qrInfo) setQrInfo(s.qrInfo)
    })

    const unStatus = window.api.onStatus((s) => {
      setStatus(s)
      if (s.status === 'paired') setPairedAt(Date.now())
    })

    const unQr = window.api.onQr((info) => setQrInfo(info))

    const unOutput = window.api.onOutput((data) => {
      setOutputLines((prev) => {
        // Keep last 200 lines for display
        const next = [...prev, data]
        return next.length > 200 ? next.slice(-200) : next
      })
    })

    const unExit = window.api.onClaudeExit((code) => {
      setOutputLines((prev) => [...prev, `\n[Claude exited with code ${code}]\n`])
    })

    return () => { unStatus(); unQr(); unOutput(); unExit() }
  }, [])

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [outputLines])

  const uptime = pairedAt
    ? formatDuration(Date.now() - pairedAt)
    : '—'

  return (
    <>
      <h2 className="page-title">会话详情</h2>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="info-row">
          <span className="info-row__label">连接状态</span>
          <span className={`status-badge status--${status.status}`}>
            <span className="status-badge__dot" />
            {statusLabel(status.status)}
          </span>
        </div>

        <div className="info-row">
          <span className="info-row__label">会话 ID</span>
          <span className="info-row__value">
            {qrInfo ? `${qrInfo.sessionId.slice(0, 12)}…` : '—'}
          </span>
        </div>

        <div className="info-row">
          <span className="info-row__label">配对时长</span>
          <span className="info-row__value">{uptime}</span>
        </div>

        <div className="info-row">
          <span className="info-row__label">Claude CLI</span>
          <span className="info-row__value">
            {status.status === 'paired' ? '✅ 运行中' : '— 未启动'}
          </span>
        </div>
      </div>

      {/* Terminal output preview */}
      <div className="card">
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)' }}>
            终端输出预览
          </span>
          <button
            className="btn btn--ghost"
            style={{ padding: '4px 10px', fontSize: 12 }}
            onClick={() => setOutputLines([])}
          >
            清除
          </button>
        </div>

        <div
          ref={outputRef}
          style={{
            background: 'var(--bg-app)',
            borderRadius: 6,
            padding: '12px 14px',
            height: 280,
            overflowY: 'auto',
            fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
            fontSize: 12,
            lineHeight: 1.6,
            color: '#b0c4de',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {outputLines.length === 0 ? (
            <span style={{ color: 'var(--text-muted)' }}>等待 Claude 输出…</span>
          ) : (
            outputLines.join('')
          )}
        </div>
      </div>
    </>
  )
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    idle: '未连接', connecting: '连接中', waiting: '等待配对',
    paired: '已配对', error: '错误', expired: '已过期', stopped: '已停止',
  }
  return map[s] ?? s
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}
