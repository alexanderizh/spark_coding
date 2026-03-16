import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { AppSettings, UpdateCheckResult } from '../types.d'

export function SettingsPage(): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings>({
    serverUrl: '',
    claudePath: 'claude',
    cwd: '',
    autoStart: true,
  })
  const [saved, setSaved] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [deviceId, setDeviceId] = useState<string>('')
  const [appVersion, setAppVersion] = useState<string>('')
  const [effectiveServerUrl, setEffectiveServerUrl] = useState<{ url: string; source: 'settings' | 'env'; envVar: string } | null>(null)

  // Update check state
  type UpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error'
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle')
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadedPath, setDownloadedPath] = useState<string | undefined>()
  const unsubProgressRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    window.api.getSettings().then(setSettings)
    window.api.getDeviceId().then(setDeviceId).catch(() => {})
    window.api.getAppVersion().then(setAppVersion).catch(() => {})
    window.api.getEffectiveServerUrl().then(setEffectiveServerUrl).catch(() => {})
  }, [])

  const handleChange = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }, [])

  const handleSave = useCallback(async () => {
    await window.api.saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [settings])

  const handleDetectClaude = useCallback(async () => {
    setDetecting(true)
    const path = await window.api.detectClaude()
    setDetecting(false)
    if (path) {
      handleChange('claudePath', path)
    } else {
      alert('未能自动检测到 Claude CLI，请手动输入路径。\n\n确保已安装：npm install -g @anthropic-ai/claude-code')
    }
  }, [handleChange])

  const handleRestartApp = useCallback(() => {
    window.api.relaunchApp()
  }, [])

  const handleQuitApp = useCallback(() => {
    window.api.quitApp()
  }, [])

  const handleCheckUpdate = useCallback(async () => {
    setUpdatePhase('checking')
    setUpdateResult(null)
    const res = await window.api.checkForUpdate()
    if (!res.hasUpdate) {
      setUpdatePhase('up-to-date')
      return
    }
    setUpdateResult(res)
    setUpdatePhase('available')
  }, [])

  const handleDownloadUpdate = useCallback(async () => {
    if (!updateResult?.downloadUrl) return
    setUpdatePhase('downloading')
    setDownloadProgress(0)
    unsubProgressRef.current?.()
    unsubProgressRef.current = window.api.onUpdateProgress(({ progress }) => {
      setDownloadProgress(progress)
    })
    const res = await window.api.downloadUpdate(updateResult.downloadUrl)
    unsubProgressRef.current?.()
    unsubProgressRef.current = null
    if (res.ok && res.filePath) {
      setDownloadedPath(res.filePath)
      setUpdatePhase('downloaded')
    } else {
      setUpdatePhase('error')
    }
  }, [updateResult])

  const handleInstallUpdate = useCallback(async () => {
    if (!downloadedPath) return
    await window.api.installUpdate(downloadedPath)
  }, [downloadedPath])

  return (
    <>
      <h2 className="page-title">设置</h2>

      <div className="card">
        {/* Relay server URL */}
        <div className="form-group">
          <label className="form-label">中继服务器地址</label>
          <input
            className="form-input"
            type="url"
            placeholder="例：http://localhost:3000 或 https://your-server.com"
            value={settings.serverUrl}
            onChange={(e) => handleChange('serverUrl', e.target.value)}
          />
          <span className="form-hint">
            中继服务器 API 地址，用于与手机端建立连接。需与 server 应用启动的地址一致。留空则使用环境变量 RELAY_SERVER_URL
          </span>
          {effectiveServerUrl?.url && (
            <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', fontSize: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>当前使用中: </span>
              <code style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{effectiveServerUrl.url}</code>
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                ({effectiveServerUrl.source === 'settings' ? '来自设置' : `来自环境变量 ${effectiveServerUrl.envVar}`})
              </span>
            </div>
          )}
        </div>

        {/* Claude path */}
        <div className="form-group">
          <label className="form-label">Claude CLI 路径</label>
          <div className="form-row">
            <input
              className="form-input"
              type="text"
              placeholder="claude"
              value={settings.claudePath}
              onChange={(e) => handleChange('claudePath', e.target.value)}
            />
            <button
              className="btn btn--ghost"
              onClick={handleDetectClaude}
              disabled={detecting}
              style={{ whiteSpace: 'nowrap' }}
            >
              {detecting ? '检测中…' : '自动检测'}
            </button>
          </div>
          <span className="form-hint">
            留空或填 "claude" 则从 PATH 中查找。若未安装请先运行：
            <code style={{ marginLeft: 4, fontFamily: 'monospace', color: 'var(--accent)' }}>
              npm install -g @anthropic-ai/claude-code
            </code>
          </span>
        </div>

        {/* Working directory */}
        <div className="form-group">
          <label className="form-label">工作目录</label>
          <input
            className="form-input"
            type="text"
            placeholder={`例：/Users/yourname/projects`}
            value={settings.cwd}
            onChange={(e) => handleChange('cwd', e.target.value)}
          />
          <span className="form-hint">
            Claude CLI 启动时的工作目录，默认为用户主目录
          </span>
        </div>

        {/* Auto start */}
        <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <input
            id="autostart"
            type="checkbox"
            checked={settings.autoStart}
            onChange={(e) => handleChange('autoStart', e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
          <div>
            <label htmlFor="autostart" className="form-label" style={{ cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontSize: 14 }}>
              启动时自动建立连接
            </label>
            <div className="form-hint">应用打开后自动建立连接并等待配对</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <button className="btn btn--primary" onClick={handleSave}>
            保存设置
          </button>
          {saved && (
            <span style={{ color: 'var(--success)', fontSize: 13 }}>✓ 已保存</span>
          )}
        </div>
      </div>

      {/* Device fingerprint */}
      {deviceId && (
        <div style={{ marginTop: 16, padding: '14px 20px', background: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>设备指纹 (Physical ID)</div>
          <code style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--accent)', wordBreak: 'break-all' }}>
            {deviceId}
          </code>
          <div className="form-hint" style={{ marginTop: 4 }}>
            该 ID 由硬件信息生成，固定不变。手机端通过此 ID 识别本机
          </div>
        </div>
      )}

      {/* Version info */}
      {appVersion && (
        <div style={{ marginTop: 16, padding: '14px 20px', background: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>版本</div>
          <code style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-muted)' }}>
            v{appVersion}
          </code>
        </div>
      )}

      <div style={{ marginTop: 16, padding: '14px 20px', background: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          后台程序控制
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn--ghost" onClick={handleRestartApp}>
            重启后台程序
          </button>
          <button className="btn btn--danger" onClick={handleQuitApp}>
            关闭后台程序
          </button>
        </div>
        <div className="form-hint" style={{ marginTop: 8 }}>
          安装新版本前可先关闭后台程序；若需快速恢复可使用重启。
        </div>
      </div>

      {/* Update section */}
      <div style={{ marginTop: 16, padding: '14px 20px', background: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          版本更新
        </div>

        {/* Check / status row */}
        {(updatePhase === 'idle' || updatePhase === 'up-to-date' || updatePhase === 'error') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn--ghost" onClick={handleCheckUpdate} style={{ fontSize: 13 }}>
              检测更新
            </button>
            {updatePhase === 'up-to-date' && (
              <span style={{ fontSize: 13, color: 'var(--success)' }}>✓ 已是最新版本</span>
            )}
            {updatePhase === 'error' && (
              <span style={{ fontSize: 13, color: 'var(--error)' }}>检测失败，请重试</span>
            )}
          </div>
        )}

        {updatePhase === 'checking' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 13 }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            检测中…
          </div>
        )}

        {updatePhase === 'available' && updateResult && (
          <div>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              发现新版本 <strong>{updateResult.version}</strong>
              {updateResult.releaseNotes && (
                <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: 12 }}>{updateResult.releaseNotes}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn--primary" onClick={handleDownloadUpdate} style={{ fontSize: 13 }}>
                立即下载
              </button>
              <button className="btn btn--ghost" onClick={() => setUpdatePhase('idle')} style={{ fontSize: 13 }}>
                暂不更新
              </button>
            </div>
          </div>
        )}

        {updatePhase === 'downloading' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
              <span>下载中…</span>
              <span>{Math.round(downloadProgress * 100)}%</span>
            </div>
            <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round(downloadProgress * 100)}%`, background: 'var(--accent)', transition: 'width 0.2s ease' }} />
            </div>
          </div>
        )}

        {updatePhase === 'downloaded' && (
          <div>
            <div style={{ fontSize: 13, color: 'var(--success)', marginBottom: 8 }}>✓ 下载完成</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn--primary" onClick={handleInstallUpdate} style={{ fontSize: 13 }}>
                安装更新
              </button>
              <button className="btn btn--ghost" onClick={() => downloadedPath && window.api.showUpdateInFolder(downloadedPath)} style={{ fontSize: 13 }}>
                打开文件夹
              </button>
              <button className="btn btn--ghost" onClick={() => setUpdatePhase('idle')} style={{ fontSize: 13 }}>
                稍后
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Help section */}
      <div style={{ marginTop: 16, padding: '16px 20px', background: 'var(--bg-card)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)', fontSize: 13 }}>快速上手</div>
        <ol style={{ paddingLeft: 20, color: 'var(--text-muted)', fontSize: 13, lineHeight: 2 }}>
          <li>切换到「配对」页面，点击「开始配对」</li>
          <li>手机 App 扫描二维码完成配对（首次）</li>
          <li>配对成功后，下次直接在 App 会话列表点击主机即可重连</li>
          <li>Claude CLI 自动启动，开始在手机上控制</li>
        </ol>
      </div>
    </>
  )
}
