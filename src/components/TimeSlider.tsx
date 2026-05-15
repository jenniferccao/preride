import { useRef } from 'react';
import type { HourlyWindEntry } from '../hooks/useWindData';

interface Props {
    date: string;
    setDate: (date: string) => void;
    onCommitDate: () => void;
    hourlyData: HourlyWindEntry[];
    hourIndex: number;
    onChange: (index: number) => void;
    loading: boolean;
}

/** Format "2026-02-18T20:00" → "20:00" */
function shortTime(iso: string): string {
    return iso.split('T')[1]?.substring(0, 5) ?? iso;
}

export default function DateTimeControl({ date, setDate, onCommitDate, hourlyData, hourIndex, onChange, loading }: Props) {
    const inputRef = useRef<HTMLInputElement>(null);
    const max = 23; // Always 0-23 hours for a full day
    const pct = (hourIndex / max) * 100;

    // Helper to get time label from data or fallback
    const getTimeLabel = (idx: number) => {
        if (hourlyData[idx]) return shortTime(hourlyData[idx].time);
        return `${idx.toString().padStart(2, '0')}:00`;
    };

    return (
        <div
            className="time-slider-panel"
            style={{
                background: 'rgba(10, 12, 22, 0.8)',
                backdropFilter: 'blur(14px)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '16px',
                padding: '14px 24px 12px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
                color: '#e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
            }}
        >
            {/* Header row: Date Picker & Status */}
            <div className="time-slider-header">
                <div className="time-slider-controls">
                    <div
                        style={{ position: 'relative', display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                        onClick={() => {
                            // Programmatically open the picker on click (modern browsers)
                            if (inputRef.current && 'showPicker' in inputRef.current) {
                                (inputRef.current as any).showPicker();
                            }
                        }}
                    >
                        {/* Calendar Icon */}
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ position: 'absolute', left: '8px', zIndex: 1, pointerEvents: 'none', color: '#94a3b8' }}
                        >
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>

                        {/* Custom Display: MM-DD-YYYY */}
                        <span style={{
                            background: 'rgba(255,255,255,0.08)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '6px',
                            color: '#e2e8f0',
                            fontFamily: 'inherit',
                            fontSize: 'clamp(11px, 2vw, 13px)',
                            fontWeight: 600,
                            padding: '4px 8px 4px 28px', // Extra left padding for icon
                            width: 'clamp(80px, 20vw, 95px)',
                            textAlign: 'center',
                            display: 'block',
                            letterSpacing: '-0.02em',
                        }}>
                            {(() => {
                                if (!date) return 'MM-DD-YYYY';
                                const [y, m, d] = date.split('-');
                                return `${m}-${d}-${y}`;
                            })()}
                        </span>

                        {/* Hidden Native Input for Picker */}
                        <input
                            ref={inputRef}
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%',
                                opacity: 0,
                                cursor: 'pointer',
                                zIndex: 2
                            }}
                        />
                    </div>

                    {/* Set Date Button */}
                    <button
                        onClick={onCommitDate}
                        disabled={loading}
                        style={{
                            background: loading ? '#334155' : '#9BDD4A',
                            color: loading ? '#94a3b8' : '#000000',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '4px 10px', // slightly tighter padding
                            fontSize: '12px',
                            fontFamily: '"Avenir", "Avenir Next", "Segoe UI", sans-serif',
                            fontWeight: 600,
                            cursor: loading ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            transition: 'background 0.2s',
                            height: '26px'
                        }}
                    >
                        {loading ? 'Loading...' : 'Set Date'}
                    </button>
                </div>

                <div className="time-slider-forecast">
                    <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
                        Forecast
                    </span>
                    <span style={{ fontSize: '12px', color: '#9BDD4A', fontWeight: 700 }}>
                        {getTimeLabel(hourIndex)}
                    </span>
                </div>
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
              #9BDD4A 0%,
              #9BDD4A ${pct}%,
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
            background: #9BDD4A;
            box-shadow: 0 0 0 3px rgba(155, 221, 74, 0.25), 0 2px 6px rgba(0,0,0,0.4);
            cursor: pointer;
            transition: transform 0.15s, box-shadow 0.15s;
          }
          .wind-slider:not(:disabled)::-webkit-slider-thumb:hover {
            transform: scale(1.2);
            box-shadow: 0 0 0 5px rgba(155, 221, 74, 0.3), 0 2px 8px rgba(0,0,0,0.4);
          }
          .wind-slider::-moz-range-thumb {
            width: 16px;
            height: 16px;
            border: none;
            border-radius: 50%;
            background: #9BDD4A;
            box-shadow: 0 0 0 3px rgba(155, 221, 74, 0.25), 0 2px 6px rgba(0,0,0,0.4);
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
                    disabled={loading}
                    onChange={(e) => onChange(Number(e.target.value))}
                />
            </div>

            {/* Tick labels */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '-4px' }}>
                <span style={{ fontSize: '10px', color: '#475569', fontWeight: 500 }}>00:00</span>
                <span style={{ fontSize: '10px', color: '#475569', fontWeight: 500 }}>12:00</span>
                <span style={{ fontSize: '10px', color: '#475569', fontWeight: 500 }}>23:00</span>
            </div>
        </div>
    );
}
