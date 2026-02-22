import React, { useEffect, useState } from 'react';

interface OnboardingOverlayProps {
    onDismiss: () => void;
}

export default function OnboardingOverlay({ onDismiss }: OnboardingOverlayProps) {
    const [mounted, setMounted] = useState(false);

    // Trigger a subtle fade-in after mounting
    useEffect(() => {
        requestAnimationFrame(() => {
            setMounted(true);
        });
    }, []);

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            onDismiss();
        }
    };

    return (
        <div
            onClick={handleBackdropClick}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 10000,
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: mounted ? 1 : 0,
                transition: 'opacity 0.3s ease-in-out',
                padding: '24px',
            }}
        >
            <div
                style={{
                    position: 'relative',
                    backgroundColor: 'rgba(15, 15, 25, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '16px',
                    padding: '32px',
                    maxWidth: '440px',
                    width: '100%',
                    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
                    color: '#f8fafc',
                    transform: mounted ? 'translateY(0)' : 'translateY(16px)',
                    transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
            >
                <button
                    onClick={onDismiss}
                    aria-label="Close"
                    style={{
                        position: 'absolute',
                        top: '16px',
                        right: '16px',
                        background: 'none',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        padding: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '50%',
                        transition: 'background-color 0.2s, color 0.2s',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                        e.currentTarget.style.color = '#fff';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = '#94a3b8';
                    }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>

                <h2 style={{ marginTop: 0, marginBottom: '20px', fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em', textAlign: 'center' }}>
                    PreRide
                </h2>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '15px', lineHeight: 1.6, color: '#cbd5e1' }}>
                    <p style={{ margin: 0 }}>
                        Upload your own GPX or explore the sample route
                    </p>
                    <p style={{ margin: 0 }}>
                        Relative difficulty of each segment is calculated using upcoming elevation grades and headwind severity.
                    </p>
                    <p style={{ margin: 0 }}>
                        Use the time slider to forecast conditions for your specific planned ride time
                    </p>
                </div>

                <button
                    onClick={onDismiss}
                    style={{
                        marginTop: '28px',
                        width: '100%',
                        padding: '12px 24px',
                        backgroundColor: '#9BDD4A', // Using the primary accent color
                        color: '#0f0f19',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '16px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'transform 0.1s, filter 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                    onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
                    onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                    Go!
                </button>
            </div>
        </div>
    );
}
