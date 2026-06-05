import React from 'react'

// PettyAF seal. Swap this artwork for the exact design-session export if/when available.
export default function Logo({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="PettyAF" role="img">
      <circle cx="32" cy="32" r="30" fill="#0e0e10" stroke="#E8352E" strokeWidth="3" />
      <circle cx="32" cy="32" r="24" fill="none" stroke="#E8352E" strokeWidth="1.2" strokeDasharray="2.5 3.5" opacity="0.55" />
      <g transform="translate(16,16) scale(1.33)">
        <path
          d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"
          fill="#fff"
        />
      </g>
    </svg>
  )
}
