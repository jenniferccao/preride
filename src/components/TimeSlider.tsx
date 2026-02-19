import type { HourlyWindEntry } from '../hooks/useWindData';

interface Props {
    hourlyData: HourlyWindEntry[];
    hourIndex: number;
    onChange: (index: number) => void;
    loading: boolean;
}

/** Format "2026-02-18T20:00" → "20:00" */
function shortTime(iso: string): string {
    return iso.split('T')[1] ?? iso;
}

export default function TimeSlider({ hourlyData, hourIndex, onChange, loading }: Props) {
    const max = hourlyData.length > 0 ? hourlyData.length - 1 : 23;
    const firstLabel = hourlyData.length > 0 ? shortTime(hourlyData[0].time) : '';
    const midLabel = hourlyData.length > 0 ? shortTime(hourlyData[Math.floor(hourlyData.length / 2)].time) : '';
    const lastLabel = hourlyData.length > 0 ? shortTime(hourlyData[max].time) : '';

    const pct = max > 0 ? (hourIndex / max) * 100 : 0;

    return (
        <div
            style={{
                position: 'absolute',
                bottom: '24px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 10,
                background: 'rgba(10, 12, 22, 0.88)',
                backdropFilter: 'blur(14px)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '16px',
                padding: '14px 24px 12px',
                fontFamily: "'Inter', sans-serif",
                boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
                color: '#e2e8f0',
                minWidth: '320px',
                maxWidth: '480px',
                width: 'min(480px, calc(100vw - 200px))',
            }}
        >
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.08em' }}>
                        Time (24 h forecast)
                    </span>
                </div>
                {loading && (
                    <span style={{ fontSize: '10px', color: '#60a5fa', fontWeight: 600 }}>Loading…</span>
                )}
                {!loading && hourlyData.length > 0 && (
                    <span style={{ fontSize: '12px', color: '#7dd3fc', fontWeight: 700 }}>
                        {shortTime(hourlyData[hourIndex].time)}
                    </span>
                )}
            </div>

            {/* Slider track */}
            <div style={{ position: 'relative' }}>
                <style>{`
          .wind-slider {
            -webkit-appearance: none;
            appearance: none;
            width: 100%;
            height: 4px;
            border-radius: 2px;
            outline: none;
            cursor: pointer;
            background: linear-gradient(
              to right,
              #3b82f6 0%,
              #3b82f6 ${pct}%,
              rgba(255,255,255,0.12) ${pct}%,
              rgba(255,255,255,0.12) 100%
            );
            transition: background 0.1s;
          }
          .wind-slider:disabled {
            opacity: 0.35;
            cursor: not-allowed;
          }
          .wind-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #60a5fa;
            box-shadow: 0 0 0 3px rgba(96,165,250,0.25), 0 2px 6px rgba(0,0,0,0.4);
            cursor: pointer;
            transition: transform 0.15s, box-shadow 0.15s;
          }
          .wind-slider:not(:disabled)::-webkit-slider-thumb:hover {
            transform: scale(1.2);
            box-shadow: 0 0 0 5px rgba(96,165,250,0.3), 0 2px 8px rgba(0,0,0,0.4);
          }
          .wind-slider::-moz-range-thumb {
            width: 16px;
            height: 16px;
            border: none;
            border-radius: 50%;
            background: #60a5fa;
            box-shadow: 0 0 0 3px rgba(96,165,250,0.25), 0 2px 6px rgba(0,0,0,0.4);
            cursor: pointer;
          }
        `}</style>
                <input
                    className="wind-slider"
                    type="range"
                    min={0}
                    max={max}
                    step={1}
                    value={hourIndex}
                    disabled={loading || hourlyData.length === 0}
                    onChange={(e) => onChange(Number(e.target.value))}
                />
            </div>

            {/* Tick labels */}
            {hourlyData.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                    {[firstLabel, midLabel, lastLabel].map((label, i) => (
                        <span key={i} style={{ fontSize: '10px', color: '#475569', fontWeight: 500 }}>{label}</span>
                    ))}
                </div>
            )}
        </div>
    );
}
