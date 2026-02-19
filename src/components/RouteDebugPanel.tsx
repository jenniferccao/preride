
import React from 'react';

// Use type instead of interface to be safe for imports
export type DebugSegmentStats = {
    headwindRaw: number;
    grade: number;
    climbPenalty: number;
    sufferRaw: number;
    totalScore: number;
};

interface Props {
    stats: DebugSegmentStats | null;
    mousePos: { x: number; y: number } | null;
}

export default function RouteDebugPanel({ stats, mousePos }: Props) {
    if (!stats || !mousePos) return null;

    const { headwindRaw, grade } = stats;

    // Offset slightly from cursor
    const style: React.CSSProperties = {
        position: 'absolute',
        left: mousePos.x + 15,
        top: mousePos.y + 15,
        zIndex: 50,
        background: 'rgba(10, 12, 22, 0.95)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: '8px',
        padding: '12px',
        fontFamily: "'Inter', sans-serif",
        fontSize: '12px',
        color: '#e2e8f0',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        pointerEvents: 'none',
        minWidth: '160px',
    };

    return (
        <div style={style}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px' }}>
                Segment Info
            </h4>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: '4px' }}>
                <span style={{ color: '#94a3b8' }}>Headwind:</span>
                <span style={{ fontWeight: 600, color: headwindRaw > 0 ? '#ef4444' : '#22c55e' }}>
                    {headwindRaw.toFixed(1)} <span style={{ fontSize: '10px', color: '#64748b' }}>km/h</span>
                </span>

                <span style={{ color: '#94a3b8' }}>Grade:</span>
                <span style={{ fontWeight: 600, color: grade > 0 ? '#f97316' : '#22c55e' }}>
                    {(grade * 100).toFixed(1)}%
                </span>
            </div>
        </div>
    );
}
