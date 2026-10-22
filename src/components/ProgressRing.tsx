import { motion } from 'framer-motion'

interface Props {
  /** 0–1 */
  progress: number
  size?: number
  strokeWidth?: number
  color?: string
  trackColor?: string
}

/**
 * Animated SVG ring showing completion progress.
 * progress=0 → empty, progress=1 → full.
 */
export default function ProgressRing({
  progress,
  size = 36,
  strokeWidth = 3.5,
  color = 'var(--success)',
  trackColor = 'var(--border)',
}: Props) {
  const r = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const clampedProgress = Math.max(0, Math.min(1, progress))
  const offset = circ * (1 - clampedProgress)

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {/* track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={trackColor}
        strokeWidth={strokeWidth}
      />
      {/* progress arc */}
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
      />
      {/* percentage text */}
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={size * 0.26}
        fontWeight="700"
        fill="var(--ink)"
        fontFamily="'Space Grotesk', sans-serif"
      >
        {Math.round(clampedProgress * 100)}
      </text>
    </svg>
  )
}
