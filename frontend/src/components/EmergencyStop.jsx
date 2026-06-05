import React from 'react'
import { Skull } from './Widgets.jsx'

export default function EmergencyStop({ stopped, onStop }) {
  return (
    <button className={`estop ${stopped ? 'estop-stopped' : ''}`} onClick={onStop} disabled={stopped}>
      <div className="estop-face">
        <span className="estop-skull">
          <Skull size={52} />
        </span>
        <span className="estop-text">
          <span className="estop-title">{stopped ? 'STOPPED' : 'EMERGENCY STOP'}</span>
          <span className="estop-sub">{stopped ? 'MERCY HAS BEEN GRANTED. THE PHONES REST.' : 'FOR WHEN MERCY IS A FINANCIAL LIABILITY'}</span>
        </span>
        <span className="estop-skull">
          <Skull size={52} />
        </span>
      </div>
      <div className="estop-hazard" />
    </button>
  )
}
