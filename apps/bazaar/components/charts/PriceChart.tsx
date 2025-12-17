'use client'

import { useMemo } from 'react'

export interface Candle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: bigint
}

interface PriceChartProps {
  candles: Candle[]
  width?: number
  height?: number
  showVolume?: boolean
}

export function PriceChart({ 
  candles, 
  width = 800, 
  height = 400,
  showVolume = true 
}: PriceChartProps) {
  const chartData = useMemo(() => {
    if (candles.length === 0) return null

    const prices = candles.flatMap(c => [c.open, c.high, c.low, c.close])
    const minPrice = Math.min(...prices)
    const maxPrice = Math.max(...prices)
    const priceRange = maxPrice - minPrice || 1
    
    const volumes = candles.map(c => Number(c.volume))
    const maxVolume = Math.max(...volumes) || 1

    const chartHeight = showVolume ? height * 0.75 : height
    const volumeHeight = showVolume ? height * 0.2 : 0
    const padding = 10
    
    const candleWidth = (width - padding * 2) / candles.length
    const wickWidth = Math.max(1, candleWidth * 0.1)
    const bodyWidth = Math.max(2, candleWidth * 0.6)

    const scaleY = (price: number) => {
      return padding + chartHeight - ((price - minPrice) / priceRange) * (chartHeight - padding * 2)
    }

    const scaleVolumeY = (vol: number) => {
      return chartHeight + padding + volumeHeight - (vol / maxVolume) * (volumeHeight - padding)
    }

    return {
      candles: candles.map((c, i) => {
        const x = padding + i * candleWidth + candleWidth / 2
        const isGreen = c.close >= c.open
        
        return {
          x,
          wickTop: scaleY(c.high),
          wickBottom: scaleY(c.low),
          bodyTop: scaleY(Math.max(c.open, c.close)),
          bodyBottom: scaleY(Math.min(c.open, c.close)),
          volumeTop: scaleVolumeY(Number(c.volume)),
          volumeBottom: chartHeight + padding + volumeHeight,
          isGreen,
          wickWidth,
          bodyWidth,
          candleWidth,
        }
      }),
      minPrice,
      maxPrice,
      chartHeight,
      volumeHeight,
      padding,
    }
  }, [candles, width, height, showVolume])

  if (!chartData || candles.length === 0) {
    return (
      <div 
        className="flex items-center justify-center rounded-xl"
        style={{ width, height, backgroundColor: 'var(--bg-secondary)' }}
      >
        <p style={{ color: 'var(--text-tertiary)' }}>No data available</p>
      </div>
    )
  }

  return (
    <svg width={width} height={height} className="rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
        const y = chartData.padding + (chartData.chartHeight - chartData.padding * 2) * pct
        const price = chartData.maxPrice - (chartData.maxPrice - chartData.minPrice) * pct
        return (
          <g key={pct}>
            <line
              x1={chartData.padding}
              y1={y}
              x2={width - chartData.padding}
              y2={y}
              stroke="var(--border)"
              strokeWidth={0.5}
              strokeDasharray="4,4"
            />
            <text
              x={width - chartData.padding - 5}
              y={y - 5}
              fontSize={10}
              fill="var(--text-tertiary)"
              textAnchor="end"
            >
              ${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </text>
          </g>
        )
      })}

      {/* Candles */}
      {chartData.candles.map((c, i) => (
        <g key={i}>
          {/* Wick */}
          <line
            x1={c.x}
            y1={c.wickTop}
            x2={c.x}
            y2={c.wickBottom}
            stroke={c.isGreen ? '#22c55e' : '#ef4444'}
            strokeWidth={c.wickWidth}
          />
          {/* Body */}
          <rect
            x={c.x - c.bodyWidth / 2}
            y={c.bodyTop}
            width={c.bodyWidth}
            height={Math.max(1, c.bodyBottom - c.bodyTop)}
            fill={c.isGreen ? '#22c55e' : '#ef4444'}
          />
          {/* Volume */}
          {showVolume && (
            <rect
              x={c.x - c.candleWidth / 3}
              y={c.volumeTop}
              width={c.candleWidth * 0.6}
              height={c.volumeBottom - c.volumeTop}
              fill={c.isGreen ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}
            />
          )}
        </g>
      ))}

      {/* Current price line */}
      {candles.length > 0 && (
        <g>
          <line
            x1={chartData.padding}
            y1={chartData.padding + (chartData.chartHeight - chartData.padding * 2) * 
                ((chartData.maxPrice - candles[candles.length - 1].close) / (chartData.maxPrice - chartData.minPrice))}
            x2={width - chartData.padding}
            y2={chartData.padding + (chartData.chartHeight - chartData.padding * 2) * 
                ((chartData.maxPrice - candles[candles.length - 1].close) / (chartData.maxPrice - chartData.minPrice))}
            stroke="#3b82f6"
            strokeWidth={1}
            strokeDasharray="4,2"
          />
        </g>
      )}
    </svg>
  )
}

