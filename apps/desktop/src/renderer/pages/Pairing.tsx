import React, { useState, useEffect, useCallback } from 'react'
import QRCode from 'qrcode'
import type { BridgeStatus, StatusInfo, QrInfo } from '../types.d'

const STATUS_LABEL: Record<BridgeStatus, string> = {
  idle:       '未连接',
  connecting: '连接服务器中…',
  waiting:    '等待手机扫码配对',
  paired:     '已配对，Claude 运行中',
  error:      '连接错误',
  expired:    '会话已过期',
  stopped:    '已停止',
}

function StatusBadge({ status, message }: StatusInfo): React.ReactElement {
  return (
    <span className={`status-badge status--${status}`}>
      <span className="status-badge__dot" />
      {message || STATUS_LABEL[status]}
    </span>
  )
}

export function PairingPage(): React.ReactElement {
  const [status, setStatus] = useState<StatusInfo>({ status: 'idle' })
  const [qrInfo, setQrInfo] = useState<QrInfo | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string>('')

  const generateQr = useCallback(async (info: QrInfo) => {
    setQrInfo(info)
    try {
      const url = await QRCode.toDataURL(info.qrPayload, {
        width: 220,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
      setQrDataUrl(url)
    } catch {
      setQrDataUrl('')
    }
  }, [])

  useEffect(() => {
    // Load initial state
    window.api.getSessionStatus().then((s) => {
      setStatus({ status: s.status })
      if (s.qrInfo) void generateQr(s.qrInfo)
    })

    const unStatus = window.api.onStatus((s) => {
      setStatus(s)
      if (s.status === 'error' && s.message) setErrorMsg(s.message)
      if (s.status !== 'error') setErrorMsg('')
    })
    const unQr = window.api.onQr((info) => void generateQr(info))

    return () => { unStatus(); unQr() }
  }, [generateQr])

  const handleStart = useCallback(async () => {
    setLoading(true)
    setErrorMsg('')
    const res = await window.api.startSession()
    if (res.error) setErrorMsg(res.error)
    setLoading(false)
  }, [])

  const handleStop = useCallback(async () => {
    await window.api.stopSession()
    setQrDataUrl('')
    setQrInfo(null)
  }, [])

  const handleRefresh = useCallback(async () => {
    const s = await window.api.getSessionStatus()
    setStatus({ status: s.status })
    if (s.qrInfo) void generateQr(s.qrInfo)
  }, [generateQr])

  const handleRestartClaude = useCallback(async () => {
    const res = await window.api.restartClaude()
    if (res.error) setErrorMsg(res.error)
    else setErrorMsg('')
  }, [])

  const handleRelaunch = useCallback(() => {
    window.api.relaunchApp()
  }, [])

  const isRunning = !['idle', 'stopped', 'error', 'expired'].includes(status.status)
  const isPaired = status.status === 'paired'

  return (
    <>
      <h2 className="page-title">配对手机</h2>

      {errorMsg && (
        <div className="alert alert--error">{errorMsg}</div>
      )}

      <div className="card">
        <div className="qr-wrap">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="Pairing QR code" className="qr-img" width={220} height={220} />
          ) : (
            <div className="qr-placeholder">
              {status.status === 'connecting' ? '生成中…' : '点击「开始配对」'}
            </div>
          )}

          <StatusBadge {...status} />

          {qrInfo && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                SESSION TOKEN
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-secondary)', letterSpacing: 1 }}>
                {qrInfo.token.slice(0, 8)}…{qrInfo.token.slice(-8)}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
            {!isRunning ? (
              <button
                className="btn btn--primary"
                onClick={handleStart}
                disabled={loading}
              >
                {loading ? '连接中…' : '开始配对'}
              </button>
            ) : (
              <button className="btn btn--danger" onClick={handleStop}>
                断开连接
              </button>
            )}

            {(status.status === 'error' || status.status === 'expired') && (
              <button className="btn btn--ghost" onClick={handleStart} disabled={loading}>
                重试
              </button>
            )}

            {isRunning && (
              <button className="btn btn--ghost" onClick={handleRefresh} title="刷新连接状态">
                刷新状态
              </button>
            )}

            {isPaired && (
              <button className="btn btn--ghost" onClick={handleRestartClaude} title="重启 Claude CLI 进程">
                重启 Claude
              </button>
            )}

            <button className="btn btn--ghost" onClick={handleRelaunch} title="重启应用">
              重启应用
            </button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.8 }}>
        <p>1. 确保手机已安装 Spark Coder App</p>
        <p>2. 点击「开始配对」生成二维码</p>
        <p>3. 手机 App 扫码，自动配对并启动 Claude</p>
      </div>
    </>
  )
}
