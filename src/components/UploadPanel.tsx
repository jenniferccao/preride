import React, { useState } from 'react';

interface Props {
    onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    selectedFile: File | null;
    distanceKm: number;
    elevationGain: number;
    selectedDate: string;
    gpxError?: string | null;
    onZoomToRoute?: () => void;
}

const UploadPanel: React.FC<Props> = ({
    onUpload,
    selectedFile,
    distanceKm,
    elevationGain,
    selectedDate,
    gpxError,
    onZoomToRoute,
}) => {
    const [expanded, setExpanded] = useState(false);
    const accentColor = '#9BDD4A';

    return (
        <div
            style={{
                position: 'absolute',
                bottom: '40px',
                left: '24px',
                zIndex: 20,
                display: 'flex',
                flexDirection: 'column-reverse',
                alignItems: 'flex-start',
                gap: '8px',
            }}
        >
            {/* Main Upload Button + Recenter side-by-side */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                    onClick={() => setExpanded(!expanded)}
                    style={{
                        background: selectedFile ? 'rgba(20, 20, 20, 0.8)' : accentColor,
                        backdropFilter: 'blur(16px)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: selectedFile ? '#fff' : '#000',
                        borderRadius: '24px',
                        padding: '8px 20px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: 600,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'all 0.2s ease',
                    }}
                >
                    {selectedFile ? (
                        <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            Ride Uploaded
                        </>
                    ) : (
                        <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                            Upload Ride
                        </>
                    )}
                </button>

                {/* Recenter button — always visible when handler provided */}
                {onZoomToRoute && (
                    <button
                        onClick={onZoomToRoute}
                        title="Recenter on route"
                        style={{
                            background: 'rgba(20,20,20,0.8)',
                            backdropFilter: 'blur(16px)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            color: '#fff',
                            borderRadius: '24px',
                            padding: '8px 14px',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: 600,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(40,40,40,0.9)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(20,20,20,0.8)'; }}
                    >
                        {/* crosshair / recenter icon */}
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3" />
                            <line x1="12" y1="2" x2="12" y2="6" />
                            <line x1="12" y1="18" x2="12" y2="22" />
                            <line x1="2" y1="12" x2="6" y2="12" />
                            <line x1="18" y1="12" x2="22" y2="12" />
                        </svg>
                        Recenter
                    </button>
                )}
            </div>

            {/* Expanded Panel */}
            <div
                style={{
                    width: '260px',
                    background: 'rgba(20, 20, 20, 0.75)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: '16px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    transformOrigin: 'bottom left',
                    transform: expanded ? 'scale(1) translateY(0)' : 'scale(0.9) translateY(20px)',
                    opacity: expanded ? 1 : 0,
                    pointerEvents: expanded ? 'auto' : 'none',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
            >
                {/* Upload Area */}
                <label
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        border: `2px dashed ${selectedFile ? '#64748b' : 'rgba(255,255,255,0.2)'}`,
                        borderRadius: '12px',
                        padding: '24px 12px',
                        cursor: 'pointer',
                        background: 'rgba(255,255,255,0.03)',
                        transition: 'all 0.2s',
                        textAlign: 'center',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = accentColor; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = selectedFile ? '#64748b' : 'rgba(255,255,255,0.2)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                >
                    <input type="file" accept=".gpx" onChange={onUpload} style={{ display: 'none' }} />
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={selectedFile ? '#fff' : accentColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '13px', fontWeight: 500, color: '#fff' }}>
                            {selectedFile ? 'Change GPX File' : 'Drop GPX file here'}
                        </span>
                        <span style={{ fontSize: '11px', color: '#9ca3af' }}>or click to browse</span>
                    </div>
                </label>

                {/* Stats */}
                {selectedFile && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
                        <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)' }} />

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <StatItem label="Distance" value={`${distanceKm.toFixed(1)} km`} />
                            <StatItem label="Elevation" value={`${Math.round(elevationGain)} m`} />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#9ca3af', background: 'rgba(0,0,0,0.3)', padding: '8px 12px', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#9ca3af' }}>
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                    <line x1="16" y1="2" x2="16" y2="6"></line>
                                    <line x1="8" y1="2" x2="8" y2="6"></line>
                                    <line x1="3" y1="10" x2="21" y2="10"></line>
                                </svg>
                                <span>Date</span>
                            </div>
                            <span style={{ color: '#fff', fontWeight: 500 }}>{selectedDate}</span>
                        </div>
                    </div>
                )}

                {/* Error Message */}
                {gpxError && (
                    <div style={{
                        background: 'rgba(239, 68, 68, 0.2)',
                        border: '1px solid rgba(239, 68, 68, 0.5)',
                        color: '#fca5a5',
                        borderRadius: '8px',
                        padding: '10px',
                        fontSize: '12px',
                        marginTop: '4px',
                    }}>
                        ⚠ {gpxError}
                    </div>
                )}
            </div>
        </div>
    );
}

function StatItem({ label, value }: { label: string, value: string }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
            <span style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>{value}</span>
        </div>
    );
}

export default UploadPanel;
