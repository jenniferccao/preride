import { useState } from 'react';

interface Props {
    terrainOn: boolean;
    setTerrainOn: (v: boolean) => void;
    windOn: boolean;
    setWindOn: (v: boolean) => void;
    elevationOn: boolean;
    setElevationOn: (v: boolean) => void;
    mapStyle: 'satellite' | 'streets';
    setMapStyle: (s: 'satellite' | 'streets') => void;
}

export default function SettingsPanel({
    terrainOn, setTerrainOn,
    windOn, setWindOn,
    elevationOn, setElevationOn,
    mapStyle, setMapStyle
}: Props) {
    const [expanded, setExpanded] = useState(false);

    // Common accent color
    const accentColor = '#9BDD4A';

    return (
        <div
            style={{
                position: 'absolute',
                left: '24px',
                top: '24px',
                zIndex: 20,
                display: 'flex',
                flexDirection: 'column', // Expands downward
                alignItems: 'flex-start',
                gap: '12px',
            }}
        >
            {/* Toggle Button */}
            <button
                onClick={() => setExpanded(!expanded)}
                style={{
                    background: 'rgba(20, 20, 20, 0.8)',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '24px',
                    padding: '8px 16px',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(40, 40, 40, 0.8)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(20, 20, 20, 0.6)'; }}
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={expanded ? accentColor : '#fff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                Settings
            </button>

            {/* Expanded Panel */}
            <div
                style={{
                    width: '220px',
                    background: 'rgba(20, 20, 20, 0.8)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: '16px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    transformOrigin: 'top left',
                    transform: expanded ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(-20px)',
                    opacity: expanded ? 1 : 0,
                    pointerEvents: expanded ? 'auto' : 'none',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
            >
                {/* Map Style Toggle */}
                <div style={{ display: 'flex', background: 'rgba(255,255,255,0.1)', borderRadius: '8px', padding: '2px' }}>
                    <button
                        onClick={() => setMapStyle('satellite')}
                        style={{
                            flex: 1,
                            background: mapStyle === 'satellite' ? accentColor : 'transparent',
                            color: mapStyle === 'satellite' ? '#000' : '#9ca3af',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                        }}
                    >
                        Satellite
                    </button>
                    <button
                        onClick={() => setMapStyle('streets')}
                        style={{
                            flex: 1,
                            background: mapStyle === 'streets' ? accentColor : 'transparent',
                            color: mapStyle === 'streets' ? '#000' : '#9ca3af',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                        }}
                    >
                        Streets
                    </button>
                </div>

                <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)' }} />

                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#fff', opacity: 0.9 }}>Toggles</h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Use simple row toggles for now, preserving logic */}
                    <ToggleItem label="3D Terrain" active={terrainOn} onClick={() => setTerrainOn(!terrainOn)} accent={accentColor} />
                    <ToggleItem label="Wind" active={windOn} onClick={() => setWindOn(!windOn)} accent={accentColor} />
                    <ToggleItem label="Elevation" active={elevationOn} onClick={() => setElevationOn(!elevationOn)} accent={accentColor} />
                </div>
            </div>
        </div>
    );
}

function ToggleItem({ label, active, onClick, accent }: { label: string, active: boolean, onClick: () => void, accent: string }) {
    return (
        <div
            onClick={onClick}
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                padding: '4px 0',
            }}
        >
            <span style={{ fontSize: '13px', color: active ? '#fff' : '#9ca3af', fontWeight: active ? 500 : 400, transition: 'color 0.2s' }}>
                {label}
            </span>
            <div
                style={{
                    width: '36px',
                    height: '20px',
                    background: active ? accent : 'rgba(255,255,255,0.2)',
                    borderRadius: '20px',
                    position: 'relative',
                    transition: 'background 0.2s ease',
                }}
            >
                <div
                    style={{
                        width: '16px',
                        height: '16px',
                        background: '#fff',
                        borderRadius: '50%',
                        position: 'absolute',
                        top: '2px',
                        left: active ? '18px' : '2px',
                        transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                    }}
                />
            </div>
        </div>
    );
}
