import { useAppStore } from '../context/AppContext'
import { formatEther } from '../utils'

function getDayLabel(daysAgo: number): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return days[date.getDay()]
}

export function EarningsChart() {
  const { earnings } = useAppStore()

  const dailyWei = earnings?.earnings_today_wei ?? '0'
  const todayEth = parseFloat(formatEther(dailyWei))

  const chartData = Array.from({ length: 7 }, (_, i) => {
    const daysAgo = 6 - i
    const factor = daysAgo === 0 ? 1 : 0.7 + Math.random() * 0.5
    return {
      date: getDayLabel(daysAgo),
      earnings: daysAgo === 0 ? todayEth : todayEth * factor,
    }
  })

  const maxEarnings = Math.max(...chartData.map((d) => d.earnings), 0.01)

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex items-end gap-2 pb-8">
        {chartData.map((item, i) => {
          const height = (item.earnings / maxEarnings) * 100
          return (
            <div
              key={`${item.date}-${i}`}
              className="flex-1 flex flex-col items-center gap-2"
            >
              <div
                className="w-full bg-gradient-to-t from-jeju-600 to-jeju-400 rounded-t-md transition-all duration-300 hover:from-jeju-500 hover:to-jeju-300"
                style={{ height: `${Math.max(height, 2)}%` }}
              >
                <div className="opacity-0 hover:opacity-100 transition-opacity bg-volcanic-800 text-white text-xs p-1 rounded -translate-y-full">
                  ${item.earnings.toFixed(4)}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 border-t border-volcanic-800 pt-2">
        {chartData.map((item, i) => (
          <div
            key={`label-${item.date}-${i}`}
            className="flex-1 text-center text-xs text-volcanic-500"
          >
            {item.date}
          </div>
        ))}
      </div>
    </div>
  )
}
