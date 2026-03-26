import React, { useState, useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { StatusInfo, QrInfo } from '../types.d'

export function SessionPage(): React.ReactElement {
  const [status, setStatus] = useState<StatusInfo>({ status: 'idle' })
  const [qrInfo, setQrInfo] = useState<QrInfo | null>(null)
  const [pairedAt, setPairedAt] = useState<number | null>(null)
  const [logs, setLogs] = useState<string>('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const termRef = useRef<HTMLDivElement>(null)
  const logsRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  // Initialize xterm once
  useEffect(() => {
    if (!termRef.current) return

    const term = new Terminal({
      theme: {
        background:    '#1a1a1a',
        foreground:    '#e0e0e0',
        cursor:        '#e0e0e0',
        selectionBackground: 'rgba(255,255,255,0.2)',
        black:         '#1a1a1a',
        brightBlack:   '#555',
        red:           '#e06c75',
        brightRed:     '#e06c75',
        green:         '#98c379',
        brightGreen:   '#98c379',
        yellow:        '#e5c07b',
        brightYellow:  '#e5c07b',
        blue:          '#61afef',
        brightBlue:    '#61afef',
        magenta:       '#c678dd',
        brightMagenta: '#c678dd',
        cyan:          '#56b6c2',
        brightCyan:    '#56b6c2',
        white:         '#abb2bf',
        brightWhite:   '#e0e0e0',
      },
      fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
      fontSize:   13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      convertEol: false,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(termRef.current)
    fit.fit()

    xtermRef.current = term
    fitRef.current   = fit

    // Listen for user input and send to PTY
    const dataDisposable = term.onData((data: string) => {
      window.api.sendTerminalInput(data)
    })

    // Fetch buffered output on mount
    window.api.getOutputBuffer().then((buf) => {
      if (buf) term.write(buf)
    })

    // Fetch initial logs
    window.api.getLogBuffer().then((buf) => {
      setLogs(buf)
      if (logsRef.current) {
        logsRef.current.scrollTop = logsRef.current.scrollHeight
      }
    })

    const ro = new ResizeObserver(() => fitRef.current?.fit())
    ro.observe(termRef.current)

    return () => {
      ro.disconnect()
      dataDisposable.dispose()
      term.dispose()
      xtermRef.current = null
      fitRef.current   = null
    }
  }, [])

  // Subscribe to IPC events
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
      const term = xtermRef.current
      if (!term) return
      term.write(data, () => {
        const snapshot = extractXtermViewport(term)
        if (snapshot) window.api.reportXtermSnapshot(snapshot)
      })
    })

    const unExit = window.api.onClaudeExit((code) => {
      xtermRef.current?.write(`\r\n[Claude exited with code ${code}]\r\n`)
    })

    // Poll logs periodically
    const logPollInterval = setInterval(() => {
      window.api.getLogBuffer().then((buf) => {
        setLogs(buf)
        if (logsRef.current) {
          logsRef.current.scrollTop = logsRef.current.scrollHeight
        }
      })
    }, 500)

    return () => {
      unStatus()
      unQr()
      unOutput()
      unExit()
      clearInterval(logPollInterval)
    }
  }, [])

  const uptime = pairedAt ? formatDuration(Date.now() - pairedAt) : '—'

  // Toggle fullscreen mode
  const toggleFullscreen = () => {
    setIsFullscreen((prev) => {
      const newValue = !prev
      // Delay fit to allow CSS transition
      setTimeout(() => fitRef.current?.fit(), 50)
      return newValue
    })
  }

  // Fullscreen terminal overlay
  if (isFullscreen) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          background: '#1a1a1a',
        }}
      >
        {/* Fullscreen header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            background: '#2a2a2a',
            borderBottom: '1px solid #333',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              className={`status-badge status--${status.status}`}
              style={{ fontSize: 12 }}
            >
              <span className="status-badge__dot" />
              {statusLabel(status.status)}
            </span>
            {qrInfo && (
              <span style={{ color: '#888', fontSize: 12, fontFamily: 'monospace' }}>
                {qrInfo.sessionId.slice(0, 12)}…
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn--ghost"
              style={{
                padding: '4px 10px',
                fontSize: 12,
                color: '#888',
                border: '1px solid #444',
              }}
              onClick={() => xtermRef.current?.clear()}
            >
              清除
            </button>
            <button
              className="btn btn--ghost"
              style={{
                padding: '4px 10px',
                fontSize: 12,
                color: '#888',
                border: '1px solid #444',
              }}
              onClick={toggleFullscreen}
            >
              退出全屏
            </button>
          </div>
        </div>

        {/* Terminal */}
        <div
          ref={termRef}
          style={{
            flex: 1,
            overflow: 'hidden',
          }}
        />
      </div>
    )
  }

  return (
    <div className="session-page">
      <h2 className="page-title">会话详情</h2>

      <div className="card" style={{ marginBottom: 16, flexShrink: 0 }}>
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

      {/* Terminal output */}
      <div className="card session-output-card" style={{ display: 'flex', flexDirection: 'column', marginBottom: 16 }}>
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)' }}>
            Claude CLI 输出
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn--ghost"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={toggleFullscreen}
              title="全屏显示"
            >
              ⛶
            </button>
            <button
              className="btn btn--ghost"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => xtermRef.current?.clear()}
            >
              清除
            </button>
          </div>
        </div>

        <div
          ref={termRef}
          style={{
            flex: 1,
            minHeight: 200,
            borderRadius: 6,
            overflow: 'hidden',
            background: '#1a1a1a',
          }}
        />
      </div>

      {/* System logs - fixed at bottom */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', maxHeight: '20vh' }}>
        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
          系统日志（最新）
        </div>
        <div
          ref={logsRef}
          style={{
            flex: 1,
            minHeight: 0,
            padding: '8px 12px',
            background: '#f5f5f5',
            borderRadius: 6,
            overflow: 'auto',
            fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
            fontSize: 11,
            lineHeight: 1.4,
            color: '#666',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {logs}
        </div>
      </div>
    </div>
  )
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    idle: '未连接', connecting: '连接中', waiting: '等待配对',
    paired: '已配对', error: '错误', expired: '已过期', stopped: '已停止',
  }
  return map[s] ?? s
}

/** Extract visible viewport text from an xterm Terminal instance. */
function extractXtermViewport(term: Terminal): string {
  const buffer = term.buffer.active
  const lines: string[] = []
  const start = buffer.viewportY
  const end   = start + term.rows
  for (let i = start; i < end; i++) {
    const line = buffer.getLine(i)
    lines.push(line ? line.translateToString(true) : '')
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.join('\n')
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}
