import React, { useState, useEffect, useCallback } from 'react'
import type { PairedSessionRecord } from '../types.d'

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function truncate(s: string, len = 16): string {
  return s.length > len ? s.slice(0, len) + '…' : s
}

function formatPlatform(value?: string): string {
  switch ((value ?? '').toLowerCase()) {
    case 'darwin':
    case 'macos':
      return 'macOS'
    case 'win32':
    case 'windows':
      return 'Windows'
    case 'linux':
      return 'Linux'
    case 'ios':
      return 'iOS'
    case 'android':
      return 'Android'
    default:
      return value?.trim() || '未知'
  }
}

function IdChip({ label, value, platform }: { label: string; value: string; platform?: string }) {
  const [copied, setCopied] = useState(false)
  const [hovered, setHovered] = useState(false)
  const copy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [value])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ position: 'relative' }}>
        <code
          onClick={copy}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            fontFamily: 'monospace',
            fontSize: 12,
            color: 'var(--accent)',
            background: 'var(--bg-input)',
            padding: '2px 7px',
            borderRadius: 4,
            cursor: 'pointer',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 200,
            userSelect: 'none',
            display: 'block',
          }}
        >
          {copied ? '已复制' : truncate(value, 20)}
        </code>
        {hovered && !copied && (
          <div
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 6px)',
              left: 0,
              background: '#1a1a1a',
              color: '#e0e0e0',
              fontFamily: 'monospace',
              fontSize: 11,
              padding: '6px 10px',
              borderRadius: 6,
              zIndex: 100,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              pointerEvents: 'none',
              maxWidth: 420,
              wordBreak: 'break-all',
              whiteSpace: 'normal',
            } as React.CSSProperties}
          >
            {value}
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 12,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: '5px solid #1a1a1a',
              }}
            />
          </div>
        )}
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 4 }}>
        系统: {formatPlatform(platform)}
      </span>
    </div>
  )
}

function ConnectionCard({
  record,
  onDelete,
  selectMode,
  selected,
  onToggleSelect,
}: {
  record: PairedSessionRecord
  onDelete: () => void
  selectMode: boolean
  selected: boolean
  onToggleSelect: () => void
}) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '18px 20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        cursor: selectMode ? 'pointer' : 'default',
      }}
      onClick={selectMode ? onToggleSelect : undefined}
    >
      {/* Top row: checkbox + hostname + launch type + last used */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {selectMode && (
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                border: selected ? 'none' : '1.5px solid var(--text-muted)',
                background: selected ? 'var(--accent)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {selected && (
                <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>✓</span>
              )}
            </div>
          )}
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            {record.hostname ?? '未知主机'}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              background: 'var(--bg-input)',
              padding: '2px 8px',
              borderRadius: 12,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {record.launchType}
          </span>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {formatTime(record.lastUsedAt)}
        </span>
      </div>

      {/* ID rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <IdChip label="会话 ID" value={record.sessionId} />
        <IdChip label="主机 ID" value={record.desktopDeviceId} platform={record.desktopPlatform} />
        <IdChip label="手机 ID" value={record.mobileDeviceId} platform={record.mobilePlatform} />
      </div>

      {/* Bottom row: server + pairedAt + delete */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '55%',
          }}
          title={record.serverUrl}
        >
          {record.serverUrl || '—'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            配对于 {new Date(record.pairedAt).toLocaleDateString('zh-CN')}
          </span>
          {!selectMode && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="btn btn--danger"
              style={{ padding: '2px 10px', fontSize: 11, fontWeight: 500 }}
            >
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function ConnectionsPage(): React.ReactElement {
  const [sessions, setSessions] = useState<PairedSessionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    window.api.listPairedSessions()
      .then((list) => setSessions(list.sort((a, b) => b.lastUsedAt - a.lastUsedAt)))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [])

  const handleDelete = useCallback(async (record: PairedSessionRecord) => {
    if (!confirm(`确定要删除与「${record.hostname ?? record.sessionId.slice(0, 8)}」的配对记录吗？\n两端的配对信息都将被清除。`)) return
    await window.api.deleteSession(record.sessionId, record.serverUrl)
    load()
  }, [load])

  const toggleSelect = useCallback((sessionId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(sessions.map(s => s.sessionId)))
  }, [sessions])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  const handleBatchDelete = useCallback(async () => {
    const selectedSessions = sessions.filter(s => selectedIds.has(s.sessionId))
    if (selectedSessions.length === 0) return
    if (!confirm(`确定要删除选中的 ${selectedSessions.length} 条配对记录吗？\n所有选中的配对信息都将被清除。`)) return

    setDeleting(true)
    try {
      await window.api.deleteSessions(selectedSessions.map(s => ({ sessionId: s.sessionId, serverUrl: s.serverUrl })))
      exitSelectMode()
      load()
    } finally {
      setDeleting(false)
    }
  }, [sessions, selectedIds, exitSelectMode, load])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>连接记录</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {sessions.length > 0 && !selectMode && (
            <button className="btn btn--ghost" onClick={() => setSelectMode(true)} style={{ fontSize: 13 }}>
              批量管理
            </button>
          )}
          <button className="btn btn--ghost" onClick={load} style={{ fontSize: 13 }}>
            刷新
          </button>
        </div>
      </div>

      {selectMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '10px 14px', background: 'var(--bg-input)', borderRadius: 'var(--radius)' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            已选 {selectedIds.size} 项
          </span>
          <button className="btn btn--ghost" onClick={selectAll} style={{ fontSize: 12, padding: '4px 10px' }}>
            全选
          </button>
          <button className="btn btn--ghost" onClick={clearSelection} style={{ fontSize: 12, padding: '4px 10px' }}>
            取消全选
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn--danger"
            onClick={handleBatchDelete}
            disabled={selectedIds.size === 0 || deleting}
            style={{ fontSize: 12, padding: '4px 12px', opacity: selectedIds.size === 0 ? 0.5 : 1 }}
          >
            {deleting ? '删除中…' : `删除选中 (${selectedIds.size})`}
          </button>
          <button className="btn btn--ghost" onClick={exitSelectMode} style={{ fontSize: 12, padding: '4px 10px' }}>
            取消
          </button>
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>加载中…</p>
      ) : sessions.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 0',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
          <div>暂无配对记录</div>
          <div style={{ marginTop: 6 }}>前往「配对」页面完成首次配对</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sessions.map((s) => (
            <ConnectionCard
              key={s.sessionId}
              record={s}
              onDelete={() => handleDelete(s)}
              selectMode={selectMode}
              selected={selectedIds.has(s.sessionId)}
              onToggleSelect={() => toggleSelect(s.sessionId)}
            />
          ))}
        </div>
      )}
    </>
  )
}
