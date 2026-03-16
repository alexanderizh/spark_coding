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

const btnBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  outline: 'none',
  whiteSpace: 'nowrap',
}

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: 'var(--accent)',
  color: '#fff',
  flex: 1,
}

const btnGhost: React.CSSProperties = {
  ...btnBase,
  background: 'transparent',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
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

  const showInFolder = useCallback(() => {
    if (!state?.filePath) return
    window.api.showUpdateInFolder(state.filePath)
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

  return (
    <div style={{
      position: 'fixed',
      top: 12,
      right: 12,
      width: 264,
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      boxShadow: '0 4px 16px rgba(0,0,0,.12)',
      padding: 14,
      zIndex: 9999,
    }}>
      {state.phase === 'available' && (
        <AvailableView result={state.result} onDownload={startDownload} onDismiss={dismiss} />
      )}
      {state.phase === 'downloading' && (
        <DownloadingView progress={state.progress} />
      )}
      {state.phase === 'downloaded' && (
        <DownloadedView onInstall={install} onShowFolder={showInFolder} onDismiss={dismiss} />
      )}
      {state.phase === 'error' && (
        <ErrorView
          message={state.errorMsg}
          onRetry={() => setState(s => s ? { ...s, phase: 'available' } : s)}
          onDismiss={dismiss}
        />
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
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, color: 'var(--text-primary)' }}>
          新版本 {result.version}
        </span>
        <button
          onClick={onDismiss}
          style={{ ...btnBase, padding: '2px 4px', color: 'var(--text-muted)', fontSize: 15 }}
        >
          ✕
        </button>
      </div>
      {result.releaseNotes && (
        <p style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          margin: '0 0 10px',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {result.releaseNotes}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={btnPrimary} onClick={onDownload}>立即下载</button>
        <button style={btnGhost} onClick={onDismiss}>暂不更新</button>
      </div>
    </div>
  )
}

function DownloadingView({ progress }: { progress: number }): React.ReactElement {
  const pct = Math.round(progress * 100)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, color: 'var(--text-primary)' }}>
          下载中...
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pct}%</span>
      </div>
      <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: 'var(--accent)',
          borderRadius: 2,
          transition: 'width 0.2s ease',
        }} />
      </div>
    </div>
  )
}

function DownloadedView({ onInstall, onShowFolder, onDismiss }: { onInstall: () => void; onShowFolder: () => void; onDismiss: () => void }): React.ReactElement {
  return (
    <div>
      <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 10px', color: 'var(--text-primary)' }}>
        下载完成
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={btnPrimary} onClick={onInstall}>安装更新</button>
        <button style={btnGhost} onClick={onShowFolder}>打开文件夹</button>
        <button style={btnGhost} onClick={onDismiss}>稍后</button>
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
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 8, gap: 8 }}>
        <span style={{ fontSize: 12, color: '#d32f2f', flex: 1 }}>{message ?? '下载失败'}</span>
        <button
          onClick={onDismiss}
          style={{ ...btnBase, padding: '2px 4px', color: 'var(--text-muted)', fontSize: 15, flexShrink: 0 }}
        >
          ✕
        </button>
      </div>
      <button style={{ ...btnGhost, width: '100%' }} onClick={onRetry}>重试</button>
    </div>
  )
}
