import React from 'react'
import { STAMP_LABELS } from '../util.js'

const STAMP_CLASS = {
  OPEN: 'stamp-gray',
  DEPLOYED: 'stamp-red',
  VOICEMAIL: 'stamp-dim',
  GHOSTED: 'stamp-red',
  PROMISED: 'stamp-amber',
  DISPUTED: 'stamp-red',
  SETTLED: 'stamp-green',
  WRITTEN_OFF: 'stamp-dim',
}

const STAMP_TILT = {
  OPEN: '-1.5deg',
  DEPLOYED: '-2.5deg',
  VOICEMAIL: '1.5deg',
  GHOSTED: '2deg',
  PROMISED: '-2deg',
  DISPUTED: '2.5deg',
  SETTLED: '-1deg',
  WRITTEN_OFF: '1deg',
}

export function Stamp({ status }) {
  const label = STAMP_LABELS[status] || status
  return (
    <span className={`stamp ${STAMP_CLASS[status] || 'stamp-red'}`} style={{ transform: `rotate(${STAMP_TILT[status] || '-2deg'})` }}>
      {label}
    </span>
  )
}

export function Panel({ title, right, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <div className="panel-head">
          <span className="panel-title">{title}</span>
          {right && <span className="panel-right">{right}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

export function BlockMeter({ value, max = 10, blocks = 20 }) {
  const filled = Math.round((Math.min(value, max) / max) * blocks)
  return (
    <div className="blockmeter">
      {Array.from({ length: blocks }, (_, i) => (
        <span key={i} className={`block ${i < filled ? 'block-on' : ''}`} />
      ))}
    </div>
  )
}

export function Waveform({ bars = 36 }) {
  // decorative static waveform for EXHIBIT A
  const heights = Array.from({ length: bars }, (_, i) => 4 + Math.abs(Math.sin(i * 1.7)) * 14 + (i % 5))
  return (
    <div className="waveform">
      {heights.map((h, i) => (
        <span key={i} style={{ height: `${h}px` }} />
      ))}
    </div>
  )
}

export function Skull({ size = 44 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
      <path d="M32 6C18.7 6 8 16.3 8 29c0 8.2 4.4 15.3 11 19.2V55a3 3 0 0 0 3 3h4v-6h4v6h4v-6h4v6h4a3 3 0 0 0 3-3v-6.8C51.6 44.3 56 37.2 56 29 56 16.3 45.3 6 32 6Zm-10 31a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm20 0a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-12 7 2-8h0l2 8h-4Z" />
    </svg>
  )
}
