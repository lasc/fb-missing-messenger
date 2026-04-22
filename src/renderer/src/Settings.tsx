import React, { useState, useEffect } from 'react'

export interface AppSettings {
    // Notifications
    notifications: boolean
    notificationSound: boolean
    dockBounce: boolean
    badgeCount: boolean
    // UI
    hideChatBubbles: boolean
    unsaveButton: boolean
    // Debug
    debugLogging: boolean
    // Updates
    autoCheckUpdates: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
    notifications: true,
    notificationSound: true,
    dockBounce: true,
    badgeCount: true,
    hideChatBubbles: true,
    unsaveButton: true,
    debugLogging: false,
    autoCheckUpdates: true,
}

interface SettingsProps {
    visible: boolean
    onClose: () => void
    settings: AppSettings
    onSettingsChange: (settings: AppSettings) => void
}

export function Settings({ visible, onClose, settings, onSettingsChange }: SettingsProps): React.ReactElement | null {
    const [appVersion, setAppVersion] = useState('')
    const [saved, setSaved] = useState(false)

    useEffect(() => {
        window.electron.ipcRenderer.invoke('get-app-version').then((v: string) => setAppVersion(v))
    }, [])

    const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        const newSettings = { ...settings, [key]: value }
        onSettingsChange(newSettings)
        window.electron.ipcRenderer.invoke('save-settings', newSettings).then(() => {
            setSaved(true)
            setTimeout(() => setSaved(false), 1500)
        })
    }

    if (!visible) return null

    return (
        <div className="settings-overlay">
            <div className="settings-panel">
                <div className="settings-header">
                    <h1 className="settings-title">Settings</h1>
                    <button className="settings-close" onClick={onClose} title="Close Settings">
                        ×
                    </button>
                </div>

                <div className="settings-body">
                    {/* Notifications Section */}
                    <section className="settings-section">
                        <div className="settings-section-header">
                            <span className="settings-section-icon">🔔</span>
                            <h2 className="settings-section-title">Notifications</h2>
                        </div>

                        <ToggleRow
                            label="Desktop Notifications"
                            description="Show native macOS toast notifications for new messages"
                            checked={settings.notifications}
                            onChange={(v) => updateSetting('notifications', v)}
                        />
                        <ToggleRow
                            label="Notification Sound"
                            description="Play the default system sound when a notification appears"
                            checked={settings.notificationSound}
                            onChange={(v) => updateSetting('notificationSound', v)}
                            disabled={!settings.notifications}
                        />
                        <ToggleRow
                            label="Dock Bounce"
                            description="Bounce the dock icon when a new message arrives while the app is not focused"
                            checked={settings.dockBounce}
                            onChange={(v) => updateSetting('dockBounce', v)}
                            disabled={!settings.notifications}
                        />
                        <ToggleRow
                            label="Badge Count"
                            description="Show unread message count on the dock icon"
                            checked={settings.badgeCount}
                            onChange={(v) => updateSetting('badgeCount', v)}
                        />
                    </section>

                    {/* UI Features Section */}
                    <section className="settings-section">
                        <div className="settings-section-header">
                            <span className="settings-section-icon">🎨</span>
                            <h2 className="settings-section-title">Interface</h2>
                        </div>

                        <ToggleRow
                            label="Hide Chat Bubbles"
                            description="Remove floating Messenger chat bubbles on Marketplace and Saved pages"
                            checked={settings.hideChatBubbles}
                            onChange={(v) => updateSetting('hideChatBubbles', v)}
                        />
                        <ToggleRow
                            label="Unsave Button"
                            description="Add quick 'Unsave' buttons to items on the Saved page"
                            checked={settings.unsaveButton}
                            onChange={(v) => updateSetting('unsaveButton', v)}
                        />
                    </section>

                    {/* Developer Section */}
                    <section className="settings-section">
                        <div className="settings-section-header">
                            <span className="settings-section-icon">🛠</span>
                            <h2 className="settings-section-title">Developer</h2>
                        </div>

                        <ToggleRow
                            label="Debug Logging"
                            description="Log detailed notification filtering and unread count info to the console"
                            checked={settings.debugLogging}
                            onChange={(v) => updateSetting('debugLogging', v)}
                        />
                        <ToggleRow
                            label="Auto-Check for Updates"
                            description="Automatically check for new versions on app launch"
                            checked={settings.autoCheckUpdates}
                            onChange={(v) => updateSetting('autoCheckUpdates', v)}
                        />
                    </section>

                    {/* Storage Section */}
                    <section className="settings-section">
                        <div className="settings-section-header">
                            <span className="settings-section-icon">💾</span>
                            <h2 className="settings-section-title">Storage</h2>
                        </div>

                        <CacheRow />
                    </section>

                    {/* About Section */}
                    <section className="settings-section settings-about">
                        <div className="settings-section-header">
                            <span className="settings-section-icon">ℹ️</span>
                            <h2 className="settings-section-title">About</h2>
                        </div>
                        <div className="settings-about-content">
                            <div className="settings-about-name">FB Missing Messenger</div>
                            <div className="settings-about-version">Version {appVersion || '...'}</div>
                            <div className="settings-about-credit">
                                A native wrapper for Messenger and Marketplace with power features
                            </div>
                        </div>
                    </section>
                </div>

                {/* Save indicator */}
                <div className={`settings-saved-indicator ${saved ? 'visible' : ''}`}>
                    ✓ Saved
                </div>
            </div>
        </div>
    )
}

// --- Cache Row Component ---
function CacheRow(): React.ReactElement {
    const [cacheSize, setCacheSize] = useState<number | null>(null)
    const [clearing, setClearing] = useState(false)

    const fetchSize = () => {
        window.electron.ipcRenderer.invoke('get-cache-size').then((size: number) => setCacheSize(size))
    }

    useEffect(() => { fetchSize() }, [])

    const formatSize = (bytes: number) => {
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    const handleClear = async () => {
        setClearing(true)
        await window.electron.ipcRenderer.invoke('clear-cache')
        fetchSize()
        setClearing(false)
    }

    return (
        <div className="settings-row">
            <div className="settings-row-text">
                <span className="settings-row-label">Cache</span>
                <span className="settings-row-description">
                    {cacheSize !== null ? `${formatSize(cacheSize)} used — cached pages, images, scripts & styles` : 'Calculating…'}
                </span>
            </div>
            <button
                className="settings-action-btn"
                onClick={handleClear}
                disabled={clearing}
            >
                {clearing ? 'Clearing…' : 'Clear'}
            </button>
        </div>
    )
}

// --- Toggle Row Component ---
interface ToggleRowProps {
    label: string
    description: string
    checked: boolean
    onChange: (value: boolean) => void
    disabled?: boolean
}

function ToggleRow({ label, description, checked, onChange, disabled }: ToggleRowProps): React.ReactElement {
    return (
        <div className={`settings-row ${disabled ? 'disabled' : ''}`}>
            <div className="settings-row-text">
                <span className="settings-row-label">{label}</span>
                <span className="settings-row-description">{description}</span>
            </div>
            <button
                className={`toggle-switch ${checked ? 'on' : 'off'}`}
                onClick={() => !disabled && onChange(!checked)}
                role="switch"
                aria-checked={checked}
                disabled={disabled}
            >
                <span className="toggle-thumb" />
            </button>
        </div>
    )
}

export default Settings
