import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { UpdateCheckResult } from '../types.d'

type Phase = 'available' | 'downloading' | 'downloaded' | 'error'

interface State {
  phase: Phase
  result: UpdateCheckResult
  progress: number
  filePath?: string
  errorMsg?: string
}

export function UpdateNotification(): React.ReactElement | null {
  const [state, setState] = useState<State | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  const startDownload = useCallback(async () => {
    if (!state?.result.downloadUrl) return
    setState(s => s ? { ...s, phase: 'downloading', progress: 0 } : s)

    unsubRef.current?.()
    unsubRef.current = window.api.onUpdateProgress(({ progress }) => {
      setState(s => s ? { ...s, progress } : s)
    })

    const res = await window.api.downloadUpdate(state.result.downloadUrl)
    unsubRef.current?.()
    unsubRef.current = null

    if (res.ok && res.filePath) {
      setState(s => s ? { ...s, phase: 'downloaded', filePath: res.filePath, progress: 1 } : s)
    } else {
      setState(s => s ? { ...s, phase: 'error', errorMsg: '下载失败，请重试' } : s)
    }
  }, [state])

  const install = useCallback(async () => {
    if (!state?.filePath) return
    await window.api.installUpdate(state.filePath)
  }, [state])

  const dismiss = useCallback(() => setState(null), [])

  useEffect(() => {
    let cancelled = false
    window.api.checkForUpdate().then((res) => {
      if (cancelled || !res.hasUpdate) return
      setState({ phase: 'available', result: res, progress: 0 })
    })
    return () => {
      cancelled = true
      unsubRef.current?.()
    }
  }, [])

  if (!state) return null

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    top: 12,
    right: 12,
    width: 260,
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    boxShadow: '0 4px 16px rgba(0,0,0,.12)',
    padding: 14,
    zIndex: 9999,
  }

  return (
    <div style={containerStyle}>
      {state.phase === 'available' && (
        <AvailableView result={state.result} onDownload={startDownload} onDismiss={dismiss} />
      )}
      {state.phase === 'downloading' && (
        <DownloadingView progress={state.progress} />
      )}
      {state.phase === 'downloaded' && (
        <DownloadedView onInstall={install} onDismiss={dismiss} />
      )}
      {state.phase === 'error' && (
        <ErrorView message={state.errorMsg} onRetry={() => setState(s => s ? { ...s, phase: 'available' } : s)} onDismiss={dismiss} />
      )}
    </div>
  )
}

function AvailableView({
  result,
  onDownload,
  onDismiss,
}: {
  result: UpdateCheckResult
  onDownload: () => void
  onDismiss: () => void
}): React.ReactElement {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
          新版本 {result.version}
        </span>
        <button
          onClick={onDismiss}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#999', fontSize: 16, lineHeight: 1 }}
        >
          ✕
        </button>
      </div>
      {result.releaseNotes && (
        <p style={{ fontSize: 11, color: '#666', margin: '0 0 10px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {result.releaseNotes}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn--primary" style={{ flex: 1, fontSize: 12, padding: '5px 0' }} onClick={onDownload}>
          立即下载
        </button>
        <button className="btn btn--ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={onDismiss}>
          暂不更新
        </button>
      </div>
    </div>
  )
}

function DownloadingView({ progress }: { progress: number }): React.ReactElement {
  const pct = Math.round(progress * 100)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>下载中...</span>
        <span style={{ fontSize: 12, color: '#666' }}>{pct}%</span>
      </div>
      <div style={{ height: 4, background: '#eee', borderRadius: 2, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'var(--accent)',
            borderRadius: 2,
            transition: 'width 0.2s ease',
          }}
        />
      </div>
    </div>
  )
}

function DownloadedView({ onInstall, onDismiss }: { onInstall: () => void; onDismiss: () => void }): React.ReactElement {
  return (
    <div>
      <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 10px' }}>下载完成</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn--primary" style={{ flex: 1, fontSize: 12, padding: '5px 0' }} onClick={onInstall}>
          安装更新
        </button>
        <button className="btn btn--ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={onDismiss}>
          稍后
        </button>
      </div>
    </div>
  )
}

function ErrorView({
  message,
  onRetry,
  onDismiss,
}: {
  message?: string
  onRetry: () => void
  onDismiss: () => void
}): React.ReactElement {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: '#d32f2f', flex: 1 }}>{message ?? '下载失败'}</span>
        <button
          onClick={onDismiss}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#999', fontSize: 16, lineHeight: 1 }}
        >
          ✕
        </button>
      </div>
      <button className="btn btn--ghost" style={{ width: '100%', fontSize: 12, padding: '5px 0' }} onClick={onRetry}>
        重试
      </button>
    </div>
  )
}
