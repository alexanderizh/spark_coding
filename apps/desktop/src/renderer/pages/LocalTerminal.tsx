import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { TerminalTab } from '../types.d'
import { TabBar } from '../components/TabBar'
import { TerminalPanel } from '../components/TerminalPanel'

export function LocalTerminalPage(): React.ReactElement {
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const outputBuffers = useRef<Map<string, string>>(new Map())

  // Create first tab on mount
  useEffect(() => {
    if (tabs.length === 0) {
      createTab()
    }
  }, [])

  // Subscribe to local terminal events
  useEffect(() => {
    const unOutput = window.api.onLocalTerminalOutput((e) => {
      const current = outputBuffers.current.get(e.tabId) || ''
      outputBuffers.current.set(e.tabId, current + e.data)
      // Force re-render for active tab
      if (e.tabId === activeTabId) {
        setTabs((prev) => [...prev])
      }
    })

    const unExit = window.api.onLocalTerminalExit((e) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === e.tabId
            ? { ...tab, status: 'stopped' as const }
            : tab
        )
      )
    })

    return () => {
      unOutput()
      unExit()
    }
  }, [activeTabId])

  const createTab = useCallback(async () => {
    const result = await window.api.createLocalTerminal()
    if (result.ok) {
      const newTab: TerminalTab = {
        id: result.tabId,
        title: 'Claude',
        status: 'running',
        cwd: result.cwd,
        createdAt: Date.now(),
      }
      outputBuffers.current.set(result.tabId, '')
      setTabs((prev) => [...prev, newTab])
      setActiveTabId(result.tabId)
    }
  }, [])

  const closeTab = useCallback(
    async (tabId: string) => {
      await window.api.closeLocalTerminal(tabId)
      outputBuffers.current.delete(tabId)
      setTabs((prev) => {
        const newTabs = prev.filter((t) => t.id !== tabId)
        // If closing active tab, switch to another
        if (tabId === activeTabId && newTabs.length > 0) {
          setActiveTabId(newTabs[newTabs.length - 1].id)
        }
        return newTabs
      })
    },
    [activeTabId]
  )

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId)
  }, [])

  const handleInput = useCallback((tabId: string, data: string) => {
    window.api.sendLocalTerminalInput(tabId, data)
  }, [])

  const handleResize = useCallback((tabId: string, cols: number, rows: number) => {
    window.api.resizeLocalTerminal(tabId, cols, rows)
  }, [])

  const activeOutput = activeTabId ? outputBuffers.current.get(activeTabId) || '' : ''

  return (
    <div className="session-page">
      <h2 className="page-title">本地终端</h2>

      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onCreateTab={createTab}
        onCloseTab={closeTab}
        onSwitchTab={switchTab}
      />

      {activeTabId ? (
        <div
          className="card session-output-card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
          }}
        >
          <TerminalPanel
            tabId={activeTabId}
            outputBuffer={activeOutput}
            onInput={handleInput}
            onResize={handleResize}
          />
        </div>
      ) : (
        <div
          className="card"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
          }}
        >
          点击 [+] 创建新终端
        </div>
      )}
    </div>
  )
}
