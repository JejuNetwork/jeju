// Simple earnings chart component
// Using a basic CSS chart since recharts has React type conflicts

const mockData = [
  { date: 'Mon', earnings: 0.42 },
  { date: 'Tue', earnings: 0.58 },
  { date: 'Wed', earnings: 0.45 },
  { date: 'Thu', earnings: 0.72 },
  { date: 'Fri', earnings: 0.65 },
  { date: 'Sat', earnings: 0.89 },
  { date: 'Sun', earnings: 0.78 },
];

export function EarningsChart() {
  const maxEarnings = Math.max(...mockData.map(d => d.earnings));
  
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex items-end gap-2 pb-8">
        {mockData.map((item) => {
          const height = (item.earnings / maxEarnings) * 100;
          return (
            <div key={item.date} className="flex-1 flex flex-col items-center gap-2">
              <div 
                className="w-full bg-gradient-to-t from-jeju-600 to-jeju-400 rounded-t-md transition-all duration-300 hover:from-jeju-500 hover:to-jeju-300"
                style={{ height: `${height}%` }}
              >
                <div className="opacity-0 hover:opacity-100 transition-opacity bg-volcanic-800 text-white text-xs p-1 rounded -translate-y-full">
                  ${item.earnings.toFixed(2)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="flex gap-2 border-t border-volcanic-800 pt-2">
        {mockData.map((item) => (
          <div key={item.date} className="flex-1 text-center text-xs text-volcanic-500">
            {item.date}
          </div>
        ))}
      </div>
    </div>
  );
}
