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

function BellIcon(): React.ReactElement {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
            <path d="M10 21h4" />
        </svg>
    )
}

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
        <div className="settings-overlay" onClick={onClose} role="presentation">
            <div
                className="settings-panel notif-log-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="notification-log-title"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="settings-header notif-log-header">
                    <div className="notif-log-heading">
                        <span className="notif-log-heading-icon"><BellIcon /></span>
                        <div className="settings-title-group">
                            <span className="settings-kicker">Messenger activity</span>
                            <h1 className="settings-title" id="notification-log-title">Notification Log</h1>
                        </div>
                    </div>
                    <button type="button" className="settings-close" onClick={onClose} aria-label="Close notification log">
                        ×
                    </button>
                </div>

                <div className="notif-log-summary" aria-label="Notification totals">
                    <div className="notif-log-stat">
                        <span className="notif-log-stat-value">{entries.length}</span>
                        <span className="notif-log-stat-label">Captured</span>
                    </div>
                    <div className="notif-log-stat allowed">
                        <span className="notif-log-stat-value">{allowedCount}</span>
                        <span className="notif-log-stat-label">Delivered</span>
                    </div>
                    <div className="notif-log-stat blocked">
                        <span className="notif-log-stat-value">{blockedCount}</span>
                        <span className="notif-log-stat-label">Filtered</span>
                    </div>
                </div>

                <div className="notif-log-toolbar">
                    <div className="notif-log-filters" role="tablist" aria-label="Filter notifications">
                        <button
                            type="button"
                            className={`notif-filter-btn ${filter === 'all' ? 'active' : ''}`}
                            onClick={() => setFilter('all')}
                            role="tab"
                            aria-selected={filter === 'all'}
                        >
                            All
                        </button>
                        <button
                            type="button"
                            className={`notif-filter-btn notif-filter-allowed ${filter === 'allowed' ? 'active' : ''}`}
                            onClick={() => setFilter('allowed')}
                            role="tab"
                            aria-selected={filter === 'allowed'}
                        >
                            <span className="notif-filter-dot" /> Delivered
                        </button>
                        <button
                            type="button"
                            className={`notif-filter-btn notif-filter-blocked ${filter === 'blocked' ? 'active' : ''}`}
                            onClick={() => setFilter('blocked')}
                            role="tab"
                            aria-selected={filter === 'blocked'}
                        >
                            <span className="notif-filter-dot" /> Filtered
                        </button>
                    </div>
                    <button type="button" className="settings-action-btn" onClick={onClear} disabled={entries.length === 0}>
                        Clear Log
                    </button>
                </div>

                {/* Entries */}
                <div className="notif-log-body">
                    {filtered.length === 0 ? (
                        <div className="notif-log-empty">
                            <span className="notif-log-empty-icon"><BellIcon /></span>
                            <strong>{entries.length === 0 ? 'No activity yet' : 'Nothing in this filter'}</strong>
                            <span className="notif-log-empty-hint">
                                {entries.length === 0
                                    ? 'Incoming Facebook notifications will appear here as they are evaluated.'
                                    : 'Choose another filter to see the rest of the activity.'}
                            </span>
                        </div>
                    ) : (
                        filtered.map(entry => (
                            <div
                                key={entry.id}
                                className={`notif-log-entry ${entry.verdict}`}
                                onClick={() => toggleExpand(entry.id)}
                                role="button"
                                tabIndex={0}
                                aria-expanded={expanded.has(entry.id)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault()
                                        toggleExpand(entry.id)
                                    }
                                }}
                            >
                                <div className="notif-log-entry-header">
                                    <span className={`notif-log-verdict ${entry.verdict}`}>
                                        {entry.verdict === 'allowed' ? '✓' : '×'}
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
