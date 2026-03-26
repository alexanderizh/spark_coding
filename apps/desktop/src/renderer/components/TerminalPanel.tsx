import React, { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface TerminalPanelProps {
  tabId: string
  onInput: (tabId: string, data: string) => void
  onResize?: (tabId: string, cols: number, rows: number) => void
  outputBuffer?: string
}

export function TerminalPanel({
  tabId,
  onInput,
  onResize,
  outputBuffer = '',
}: TerminalPanelProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const lastBufferRef = useRef<string>('')

  // Initialize xterm
  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme: {
        background: '#1a1a1a',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
        selectionBackground: 'rgba(255,255,255,0.2)',
        black: '#1a1a1a',
        brightBlack: '#555',
        red: '#e06c75',
        brightRed: '#e06c75',
        green: '#98c379',
        brightGreen: '#98c379',
        yellow: '#e5c07b',
        brightYellow: '#e5c07b',
        blue: '#61afef',
        brightBlue: '#61afef',
        magenta: '#c678dd',
        brightMagenta: '#c678dd',
        cyan: '#56b6c2',
        brightCyan: '#56b6c2',
        white: '#abb2bf',
        brightWhite: '#e0e0e0',
      },
      fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      convertEol: false,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()

    // Listen for user input
    term.onData((data: string) => {
      onInput(tabId, data)
    })

    termRef.current = term
    fitRef.current = fit
    lastBufferRef.current = ''

    // Handle resize
    const ro = new ResizeObserver(() => {
      fitRef.current?.fit()
      if (termRef.current && onResize) {
        onResize(tabId, termRef.current.cols, termRef.current.rows)
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [tabId, onInput, onResize])

  // Write output buffer
  useEffect(() => {
    const term = termRef.current
    if (!term || !outputBuffer) return

    // Only write the new content (delta)
    if (outputBuffer.length > lastBufferRef.current.length) {
      const newContent = outputBuffer.slice(lastBufferRef.current.length)
      term.write(newContent)
      lastBufferRef.current = outputBuffer
    } else if (outputBuffer !== lastBufferRef.current) {
      // Buffer was reset, clear and rewrite
      term.clear()
      term.write(outputBuffer)
      lastBufferRef.current = outputBuffer
    }
  }, [outputBuffer])

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minHeight: 200,
        borderRadius: 6,
        overflow: 'hidden',
        background: '#1a1a1a',
      }}
    />
  )
}
