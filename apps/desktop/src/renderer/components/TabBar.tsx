import React from 'react'
import type { TerminalTab } from '../types.d'

interface TabBarProps {
  tabs: TerminalTab[]
  activeTabId: string | null
  onCreateTab: () => void
  onCloseTab: (tabId: string) => void
  onSwitchTab: (tabId: string) => void
}

export function TabBar({
  tabs,
  activeTabId,
  onCreateTab,
  onCloseTab,
  onSwitchTab,
}: TabBarProps): React.ReactElement {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${tab.id === activeTabId ? 'tab-item--active' : ''}`}
          onClick={() => onSwitchTab(tab.id)}
        >
          <span className={`tab-item__status tab-item__status--${tab.status}`} />
          <span className="tab-item__title" title={tab.title}>
            {tab.title}
          </span>
          {tabs.length > 1 && (
            <button
              className="tab-item__close"
              onClick={(e) => {
                e.stopPropagation()
                onCloseTab(tab.id)
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}

      <div className="tab-actions">
        <button
          className="tab-action-btn tab-action-btn--primary"
          onClick={onCreateTab}
          title="新建终端"
        >
          +
        </button>
      </div>
    </div>
  )
}
