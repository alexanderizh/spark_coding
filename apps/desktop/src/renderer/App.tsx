import React, { useState } from 'react'
import { PairingPage } from './pages/Pairing'
import { SessionPage } from './pages/Session'
import { SettingsPage } from './pages/Settings'

type Page = 'pairing' | 'session' | 'settings'

const NAV: { id: Page; icon: string; label: string }[] = [
  { id: 'pairing',  icon: '📡', label: '配对' },
  { id: 'session',  icon: '💬', label: '会话' },
  { id: 'settings', icon: '⚙️', label: '设置' },
]

export default function App(): React.ReactElement {
  const [page, setPage] = useState<Page>('pairing')

  return (
    <div className="app">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar__logo">
          <div className="sidebar__logo-icon">⚡</div>
          <span className="sidebar__logo-name">Spark Coder</span>
        </div>

        <nav className="sidebar__nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'nav-item--active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              <span className="nav-item__icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Content ── */}
      <main className="content">
        {page === 'pairing'  && <PairingPage />}
        {page === 'session'  && <SessionPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}
