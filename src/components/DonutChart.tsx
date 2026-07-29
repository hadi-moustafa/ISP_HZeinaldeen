export interface DonutSegment {
  label: string
  value: number
  color: string
}

// Hand-rolled with a conic-gradient rather than pulling in a charting
// library for one two-slice chart.
export function DonutChart({
  segments,
  size = 176,
  thickness = 26,
}: {
  segments: DonutSegment[]
  size?: number
  thickness?: number
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  let cumulative = 0
  const stops =
    total > 0
      ? segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const start = (cumulative / total) * 360
            cumulative += s.value
            const end = (cumulative / total) * 360
            return `${s.color} ${start}deg ${end}deg`
          })
      : ['#e5e5e5 0deg 360deg']

  return (
    <div
      role="img"
      aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}
      style={{
        width: size,
        height: size,
        borderRadius: '9999px',
        background: `conic-gradient(${stops.join(', ')})`,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: size - thickness * 2,
          height: size - thickness * 2,
          borderRadius: '9999px',
          background: 'white',
        }}
      />
    </div>
  )
}
