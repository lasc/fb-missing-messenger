import React, { useState } from 'react'

export interface NotifLogEntry {
    id: string
    timestamp: number
    title: string
    body: string
    tag?: string
    icon?: string
    sourceUrl: string
    sourcePath: string
    tabType: string
    tabId: string
    verdict: 'allowed' | 'blocked'
    reason: string
    layer?: string // which filter layer made the decision
}

interface NotificationLogProps {
    visible: boolean
    onClose: () => void
    entries: NotifLogEntry[]
    onClear: () => void
}

type FilterMode = 'all' | 'allowed' | 'blocked'

export function NotificationLog({ visible, onClose, entries, onClear }: NotificationLogProps): React.ReactElement | null {
    const [filter, setFilter] = useState<FilterMode>('all')
    const [expanded, setExpanded] = useState<Set<string>>(new Set())

    if (!visible) return null

    const filtered = filter === 'all' ? entries : entries.filter(e => e.verdict === filter)
    const allowedCount = entries.filter(e => e.verdict === 'allowed').length
    const blockedCount = entries.filter(e => e.verdict === 'blocked').length

    const toggleExpand = (id: string) => {
        setExpanded(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const formatTime = (ts: number) => {
        const d = new Date(ts)
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }

    return (
        <div className="settings-overlay">
            <div className="settings-panel notif-log-panel">
                <div className="settings-header">
                    <h1 className="settings-title">Notification Log</h1>
                    <button className="settings-close" onClick={onClose} title="Close">
                        ×
                    </button>
                </div>

                {/* Filter bar */}
                <div className="notif-log-toolbar">
                    <div className="notif-log-filters">
                        <button
                            className={`notif-filter-btn ${filter === 'all' ? 'active' : ''}`}
                            onClick={() => setFilter('all')}
                        >
                            All ({entries.length})
                        </button>
                        <button
                            className={`notif-filter-btn notif-filter-allowed ${filter === 'allowed' ? 'active' : ''}`}
                            onClick={() => setFilter('allowed')}
                        >
                            ✅ Allowed ({allowedCount})
                        </button>
                        <button
                            className={`notif-filter-btn notif-filter-blocked ${filter === 'blocked' ? 'active' : ''}`}
                            onClick={() => setFilter('blocked')}
                        >
                            ❌ Blocked ({blockedCount})
                        </button>
                    </div>
                    <button className="settings-action-btn" onClick={onClear}>
                        Clear Log
                    </button>
                </div>

                {/* Entries */}
                <div className="notif-log-body">
                    {filtered.length === 0 ? (
                        <div className="notif-log-empty">
                            <span className="notif-log-empty-icon">🔔</span>
                            <span>No notifications logged yet.</span>
                            <span className="notif-log-empty-hint">
                                Notifications from Facebook will appear here as they come in.
                            </span>
                        </div>
                    ) : (
                        filtered.map(entry => (
                            <div
                                key={entry.id}
                                className={`notif-log-entry ${entry.verdict}`}
                                onClick={() => toggleExpand(entry.id)}
                            >
                                <div className="notif-log-entry-header">
                                    <span className={`notif-log-verdict ${entry.verdict}`}>
                                        {entry.verdict === 'allowed' ? '✅' : '❌'}
                                    </span>
                                    <div className="notif-log-entry-main">
                                        <span className="notif-log-entry-title">{entry.title}</span>
                                        <span className="notif-log-entry-body">{entry.body || '(no body)'}</span>
                                    </div>
                                    <span className="notif-log-entry-time">{formatTime(entry.timestamp)}</span>
                                </div>

                                {expanded.has(entry.id) && (
                                    <div className="notif-log-entry-details">
                                        <div className="notif-log-detail">
                                            <span className="notif-log-detail-label">Verdict</span>
                                            <span className={`notif-log-detail-value ${entry.verdict}`}>
                                                {entry.verdict.toUpperCase()} — {entry.reason}
                                            </span>
                                        </div>
                                        {entry.layer && (
                                            <div className="notif-log-detail">
                                                <span className="notif-log-detail-label">Filter Stage</span>
                                                <span className="notif-log-detail-value">{entry.layer}</span>
                                            </div>
                                        )}
                                        <div className="notif-log-detail">
                                            <span className="notif-log-detail-label">Tab</span>
                                            <span className="notif-log-detail-value">{entry.tabType} ({entry.tabId})</span>
                                        </div>
                                        <div className="notif-log-detail">
                                            <span className="notif-log-detail-label">Source</span>
                                            <span className="notif-log-detail-value notif-log-mono">{entry.sourcePath}</span>
                                        </div>
                                        {entry.tag && (
                                            <div className="notif-log-detail">
                                                <span className="notif-log-detail-label">Tag</span>
                                                <span className="notif-log-detail-value notif-log-mono">{entry.tag}</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    )
}

export default NotificationLog
