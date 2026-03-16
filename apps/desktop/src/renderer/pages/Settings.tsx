import React, { useState, useEffect, useCallback } from 'react'
import type { AppSettings } from '../types.d'

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

  useEffect(() => {
    window.api.getSettings().then(setSettings)
    window.api.getDeviceId().then(setDeviceId).catch(() => {})
    window.api.getAppVersion().then(setAppVersion).catch(() => {})
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
