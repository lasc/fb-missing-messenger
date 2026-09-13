import React, { useState, useEffect } from 'react'
import { Settings, AppSettings, DEFAULT_SETTINGS } from './Settings'
import { NotificationLog, NotifLogEntry } from './NotificationLog'

// Tab definitions
type TabType = 'messenger' | 'marketplace' | 'saved' | 'marketplace-item'
interface Tab {
    id: string
    type: TabType
    url: string
    title?: string
    hasBeenVisited?: boolean
    lastVisited?: number
}

interface TabProblem {
    kind: 'load-failed' | 'crashed'
    title: string
    message: string
}

function normaliseMessengerUrl(value: unknown): string | null {
    if (typeof value !== 'string' || !value) return null

    try {
        const url = new URL(value)
        const hostname = url.hostname.toLowerCase()
        const isFacebook = hostname === 'facebook.com' || hostname.endsWith('.facebook.com') ||
            hostname === 'fb.com' || hostname.endsWith('.fb.com')
        const isMessenger = hostname === 'messenger.com' || hostname.endsWith('.messenger.com')
        if (url.protocol !== 'https:') return null
        if (isFacebook && url.pathname.startsWith('/messages')) return url.toString()
        if (isMessenger && (url.pathname.startsWith('/messages') || url.pathname.startsWith('/t/'))) return url.toString()
    } catch {
        // Invalid or untrusted URLs fall back to the Messenger inbox.
    }
    return null
}

const MAX_PRUNABLE_TABS = 5

const UNSAVE_RUNTIME_VERSION = 5
const UNSAVE_CLEANUP_SCRIPT = `
    (function() {
        const runtime = window.__fbmmUnsaveRuntime;
        if (runtime) {
            clearInterval(runtime.intervalId);
            clearTimeout(runtime.scanTimer);
            runtime.observer?.disconnect();
            if (runtime.visibilityHandler) {
                document.removeEventListener('visibilitychange', runtime.visibilityHandler);
            }
        }
        document.querySelectorAll('.custom-unsave-btn, #fbmm-sold-toolbar').forEach(function(element) {
            element.remove();
        });
        document.querySelectorAll('[data-fbmm-position-adjusted]').forEach(function(element) {
            element.style.removeProperty('position');
            element.style.removeProperty('overflow');
            delete element.dataset.fbmmPositionAdjusted;
        });
        delete window.__fbmmUnsaveRuntime;
    })();
`

const UNSAVE_INJECTION_SCRIPT = `
    (function() {
        const RUNTIME_VERSION = ${UNSAVE_RUNTIME_VERSION};
        const TRIGGER_SELECTOR = [
            '[aria-label="More options for saved item"]',
            '[aria-label="Collection options"]',
            '[aria-label="Actions needed"]'
        ].join(', ');

        const previousRuntime = window.__fbmmUnsaveRuntime;
        if (previousRuntime?.version === RUNTIME_VERSION) {
            previousRuntime.schedule();
            return;
        }

        if (previousRuntime) {
            clearInterval(previousRuntime.intervalId);
            clearTimeout(previousRuntime.scanTimer);
            previousRuntime.observer?.disconnect();
            if (previousRuntime.visibilityHandler) {
                document.removeEventListener('visibilitychange', previousRuntime.visibilityHandler);
            }
        }
        document.querySelectorAll('.custom-unsave-btn, #fbmm-sold-toolbar').forEach(function(element) {
            element.remove();
        });

        const delay = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));
        const isVisible = (element) => {
            if (!element || element.getClientRects().length === 0) return false;
            const style = getComputedStyle(element);
            return style.visibility !== 'hidden' && style.display !== 'none';
        };
        const normaliseText = (element) => (element.textContent || '')
            .replace(/\\s+/g, ' ')
            .trim()
            .toLowerCase();

        const findCard = (trigger, mainContent) => {
            const article = trigger.closest('[role="article"]');
            if (article && article.clientWidth >= 300) return article;

            let node = trigger.parentElement;
            let fallback = null;
            while (node && node !== mainContent) {
                if (node.clientWidth >= 300 && node.querySelectorAll(TRIGGER_SELECTOR).length === 1) {
                    fallback = node;
                    const hasContent = node.querySelector('a[href], img, video');
                    const text = (node.innerText || '').trim();
                    if (hasContent && text.length > 10) return node;
                }
                node = node.parentElement;
            }
            return fallback;
        };

        const collectItems = () => {
            const mainContent = document.querySelector('[role="main"]');
            if (!mainContent) return [];
            const seenCards = new Set();
            const items = [];
            Array.from(mainContent.querySelectorAll(TRIGGER_SELECTOR)).forEach(trigger => {
                if (trigger.closest('[role="banner"], [role="navigation"]')) return;
                const card = findCard(trigger, mainContent);
                if (!card || seenCards.has(card) || card.dataset.fbmmUnsaved === 'true') return;
                seenCards.add(card);
                items.push({ trigger, card });
            });
            return items;
        };

        const isSoldCard = (card) => {
            const words = (card.innerText || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
            return words.includes('sold');
        };

        const waitForExactUnsave = async () => {
            for (let attempt = 0; attempt < 40; attempt += 1) {
                const options = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], [role="menu"] [role="button"]'));
                const match = options.find(option => isVisible(option) && normaliseText(option) === 'unsave');
                if (match) return match;
                await delay(50);
            }
            return null;
        };

        const markComplete = (card) => {
            card.dataset.fbmmUnsaved = 'true';
            card.style.transition = 'opacity 220ms ease, transform 220ms ease';
            card.style.opacity = '0';
            card.style.transform = 'scale(0.985)';
            card.style.pointerEvents = 'none';
            setTimeout(() => {
                if (card.isConnected) card.style.display = 'none';
            }, 240);
        };

        const unsaveItem = async (trigger, card) => {
            try {
                trigger.click();
                const unsaveOption = await waitForExactUnsave();
                if (!unsaveOption) {
                    trigger.click();
                    return false;
                }
                unsaveOption.click();
                markComplete(card);
                await delay(360);
                return true;
            } catch (_error) {
                return false;
            }
        };

        const createItemButton = ({ trigger, card }) => {
            const container = trigger.parentElement;
            if (!container || container.querySelector('.custom-unsave-btn')) return;

            if (getComputedStyle(container).position === 'static') {
                container.dataset.fbmmPositionAdjusted = 'true';
                container.style.position = 'relative';
                container.style.overflow = 'visible';
            }

            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Unsave';
            button.className = 'custom-unsave-btn';
            button.title = 'Remove this item from Saved';
            Object.assign(button.style, {
                position: 'absolute',
                right: '100%',
                top: '50%',
                transform: 'translateY(-50%)',
                marginRight: '8px',
                zIndex: '999',
                whiteSpace: 'nowrap',
                background: '#2b303a',
                color: '#f2f4f8',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: '8px',
                padding: '6px 10px',
                fontSize: '13px',
                lineHeight: '18px',
                cursor: 'pointer',
                fontWeight: '600',
                boxShadow: '0 4px 12px rgba(0,0,0,0.28)'
            });

            button.addEventListener('mouseenter', () => { button.style.background = '#383e49'; });
            button.addEventListener('mouseleave', () => {
                if (!button.disabled) button.style.background = '#2b303a';
            });
            button.addEventListener('click', async event => {
                event.preventDefault();
                event.stopPropagation();
                if (button.disabled) return;
                button.disabled = true;
                button.textContent = 'Unsaving…';
                button.style.cursor = 'wait';
                const success = await unsaveItem(trigger, card);
                if (success) {
                    button.textContent = 'Unsaved';
                    button.style.background = '#166534';
                    return;
                }
                button.textContent = 'Try again';
                button.style.background = '#7f1d1d';
                setTimeout(() => {
                    button.disabled = false;
                    button.textContent = 'Unsave';
                    button.style.background = '#2b303a';
                    button.style.cursor = 'pointer';
                }, 1600);
            });
            container.appendChild(button);
        };

        const updateSoldToolbar = (items) => {
            const soldItems = items.filter(item => isSoldCard(item.card));
            let toolbar = document.getElementById('fbmm-sold-toolbar');
            if (soldItems.length === 0) {
                toolbar?.remove();
                return;
            }

            if (!toolbar) {
                toolbar = document.createElement('div');
                toolbar.id = 'fbmm-sold-toolbar';
                toolbar.setAttribute('role', 'region');
                toolbar.setAttribute('aria-label', 'Sold saved items');
                Object.assign(toolbar.style, {
                    position: 'fixed',
                    left: '18px',
                    bottom: '18px',
                    zIndex: '2147483000',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 11px 10px 14px',
                    color: '#f2f4f8',
                    background: 'rgba(28,31,38,0.96)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '12px',
                    boxShadow: '0 12px 34px rgba(0,0,0,0.38)',
                    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                    fontSize: '13px',
                    backdropFilter: 'blur(16px)'
                });
                const label = document.createElement('span');
                label.className = 'fbmm-sold-label';
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'fbmm-unsave-sold-btn';
                button.textContent = 'Unsave sold';
                Object.assign(button.style, {
                    padding: '7px 11px',
                    color: 'white',
                    background: '#b4232c',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '8px',
                    font: '600 12px -apple-system, BlinkMacSystemFont, sans-serif',
                    cursor: 'pointer'
                });
                button.addEventListener('click', async event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const currentSoldItems = collectItems().filter(item => isSoldCard(item.card));
                    if (currentSoldItems.length === 0) {
                        schedule();
                        return;
                    }
                    const confirmed = window.confirm(
                        'Unsave ' + currentSoldItems.length + ' sold item' + (currentSoldItems.length === 1 ? '' : 's') + ' currently loaded on this page?'
                    );
                    if (!confirmed) return;

                    button.disabled = true;
                    button.style.cursor = 'wait';
                    let completed = 0;
                    let failed = 0;
                    for (const item of currentSoldItems) {
                        label.textContent = 'Unsaving ' + (completed + failed + 1) + ' of ' + currentSoldItems.length + '…';
                        const success = await unsaveItem(item.trigger, item.card);
                        if (success) completed += 1;
                        else failed += 1;
                        await delay(240);
                    }
                    label.textContent = failed === 0
                        ? completed + ' sold item' + (completed === 1 ? '' : 's') + ' unsaved'
                        : completed + ' unsaved · ' + failed + ' need retry';
                    button.textContent = failed === 0 ? 'Done' : 'Retry failed';
                    button.disabled = failed === 0;
                    button.style.cursor = failed === 0 ? 'default' : 'pointer';
                    if (failed > 0) schedule();
                    else setTimeout(() => toolbar?.remove(), 2200);
                });
                toolbar.append(label, button);
                document.body.appendChild(toolbar);
            }

            const label = toolbar.querySelector('.fbmm-sold-label');
            const button = toolbar.querySelector('.fbmm-unsave-sold-btn');
            if (label && button && !button.disabled) {
                label.textContent = soldItems.length + ' sold item' + (soldItems.length === 1 ? '' : 's') + ' loaded';
                button.textContent = 'Unsave sold';
            }
        };

        const scan = () => {
            if (document.hidden) return;
            const items = collectItems();
            items.forEach(createItemButton);
            updateSoldToolbar(items);
        };

        let scanTimer;
        const schedule = () => {
            if (document.hidden) return;
            if (scanTimer) return;
            scanTimer = setTimeout(() => {
                scanTimer = undefined;
                if (window.__fbmmUnsaveRuntime) window.__fbmmUnsaveRuntime.scanTimer = undefined;
                scan();
            }, 220);
            if (window.__fbmmUnsaveRuntime) window.__fbmmUnsaveRuntime.scanTimer = scanTimer;
        };
        const observer = new MutationObserver(schedule);
        const mainContent = document.querySelector('[role="main"]') || document.body;
        observer.observe(mainContent, { childList: true, subtree: true });
        const intervalId = setInterval(schedule, 10000);
        const visibilityHandler = () => { if (!document.hidden) schedule(); };
        document.addEventListener('visibilitychange', visibilityHandler);
        window.__fbmmUnsaveRuntime = {
            version: RUNTIME_VERSION,
            observer,
            intervalId,
            scanTimer,
            schedule,
            visibilityHandler
        };
        schedule();
    })();
`

type NavIconKind = TabType | 'back' | 'notifications' | 'settings'

function NavIcon({ kind }: { kind: NavIconKind }): React.ReactElement {
    const common = {
        width: 21,
        height: 21,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.9,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        'aria-hidden': true
    }

    if (kind === 'messenger') {
        return <svg {...common}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9.9 9.9 0 0 1-2.7-.38L4 21l1.45-4.23A8.14 8.14 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" /><path d="m7.6 13.7 3-3.2 2.35 2 3.45-3.7-3 6.5-2.35-2-3.45 2.1Z" /></svg>
    }
    if (kind === 'marketplace') {
        return <svg {...common}><path d="M4 10v10h16V10" /><path d="M3 10h18l-1.5-6h-15L3 10Z" /><path d="M7 10v1a2 2 0 0 0 4 0v-1m0 0v1a2 2 0 0 0 4 0v-1m0 0v1a2 2 0 0 0 4 0v-1M9 20v-5h6v5" /></svg>
    }
    if (kind === 'saved') {
        return <svg {...common}><path d="M6.5 4.5A1.5 1.5 0 0 1 8 3h8a1.5 1.5 0 0 1 1.5 1.5V21L12 17.5 6.5 21V4.5Z" /></svg>
    }
    if (kind === 'marketplace-item') {
        return <svg {...common}><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="m4 7 8 4 8-4v10l-8 4-8-4V7Z" /><path d="M12 11v10" /></svg>
    }
    if (kind === 'notifications') {
        return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" /><path d="M10 21h4" /></svg>
    }
    if (kind === 'settings') {
        return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" /></svg>
    }
    return <svg {...common}><path d="m14.5 18-6-6 6-6" /></svg>
}

function getTabLabel(tab: Tab): string {
    if (tab.type === 'messenger') return 'Messenger'
    if (tab.type === 'marketplace') return 'Marketplace'
    if (tab.type === 'saved') return 'Saved items'
    return tab.title || 'Marketplace item'
}

function App(): React.ReactElement {
    const [tabs, setTabs] = useState<Tab[]>(() => {
        const initialTabs: Tab[] = [
            { id: 'messenger', type: 'messenger', url: 'https://www.facebook.com/messages/', hasBeenVisited: true, lastVisited: Date.now() },
            { id: 'marketplace', type: 'marketplace', url: 'https://www.facebook.com/marketplace/', hasBeenVisited: false, lastVisited: Date.now() - 1 },
            { id: 'saved', type: 'saved', url: 'https://www.facebook.com/saved/', hasBeenVisited: false, lastVisited: Date.now() - 2 }
        ]
        return initialTabs
    })
    const [activeTabId, setActiveTabId] = useState<string>('messenger')
    const [webviewPreloadPath, setWebviewPreloadPath] = useState<string>('')
    const webviewRefs = React.useRef<{ [key: string]: any }>({})

    // Guest resilience state. Problems are tracked per tab so a background failure
    // does not interrupt the conversation the user is currently reading.
    const [isOnline, setIsOnline] = useState(() => navigator.onLine)
    const onlineRef = React.useRef(navigator.onLine)
    const [tabProblems, setTabProblems] = useState<Record<string, TabProblem | undefined>>({})
    const tabProblemsRef = React.useRef(tabProblems)
    const recoveryTimersRef = React.useRef<Map<string, NodeJS.Timeout>>(new Map())
    const recoveryAttemptsRef = React.useRef<Map<string, number>>(new Map())
    useEffect(() => { tabProblemsRef.current = tabProblems }, [tabProblems])

    // Update checker state
    const [updateInfo, setUpdateInfo] = useState<{ latestVersion: string; assetUrl: string; releaseName: string } | null>(null)
    const [updateDismissed, setUpdateDismissed] = useState(false)
    const [updateStage, setUpdateStage] = useState<'idle' | 'downloading' | 'installing' | 'restarting' | 'error'>('idle')
    const [downloadPercent, setDownloadPercent] = useState(0)
    const [updateErrorMessage, setUpdateErrorMessage] = useState('')

    // Settings state
    const [showSettings, setShowSettings] = useState(false)
    const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
    const settingsRef = React.useRef(appSettings)
    useEffect(() => { settingsRef.current = appSettings }, [appSettings])

    // Image zoom lightbox state (gallery mode)
    const [zoomGallery, setZoomGallery] = useState<{ images: string[]; index: number } | null>(null)
    const zoomWebviewRef = React.useRef<any>(null)

    // Notification log state
    const [showNotifLog, setShowNotifLog] = useState(false)
    const [notifLog, setNotifLog] = useState<NotifLogEntry[]>([])
    const notifLogRef = React.useRef(notifLog)
    useEffect(() => { notifLogRef.current = notifLog }, [notifLog])

    // In-app toast notification state
    interface ToastNotification {
        id: string
        title: string
        body: string
        icon?: string
        sourceUrl?: string
        timestamp: number
    }
    const [toasts, setToasts] = useState<ToastNotification[]>([])
    const toastTimeoutsRef = React.useRef<Map<string, NodeJS.Timeout>>(new Map())

    // Track whether messenger tab has new unread messages (for icon badge)
    const [hasUnread, setHasUnread] = useState(false)

    const showToast = (title: string, body: string, icon?: string, sourceUrl?: string) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const toast: ToastNotification = { id, title, body, icon, sourceUrl, timestamp: Date.now() }
        setToasts(prev => [toast, ...prev].slice(0, 5)) // max 5 toasts
        // Auto-dismiss after 5 seconds
        const timeout = setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id))
            toastTimeoutsRef.current.delete(id)
        }, 5000)
        toastTimeoutsRef.current.set(id, timeout)
    }

    const dismissToast = (id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id))
        const timeout = toastTimeoutsRef.current.get(id)
        if (timeout) {
            clearTimeout(timeout)
            toastTimeoutsRef.current.delete(id)
        }
    }

    // Notification deduplication: track recent notification hashes to suppress duplicates
    const recentNotifHashes = React.useRef<Map<string, number>>(new Map())

    // Update visited state and timestamp when switching tabs
    const handleTabSwitch = (id: string) => {
        setActiveTabId(id)
        setShowSettings(false)
        setShowNotifLog(false)
        setTabs(prev => prev.map(t =>
            t.id === id ? { ...t, hasBeenVisited: true, lastVisited: Date.now() } : t
        ))
    }

    const openMessengerDestination = (sourceUrl?: unknown) => {
        handleTabSwitch('messenger')
        const targetUrl = normaliseMessengerUrl(sourceUrl)
        if (!targetUrl) return

        // The Messenger webview stays alive in the background, so this is an
        // in-place navigation instead of an expensive remount.
        const messenger = webviewRefs.current.messenger
        if (!messenger || messenger.getURL?.() === targetUrl) return
        Promise.resolve(messenger.loadURL(targetUrl)).catch(() => {})
    }

    const clearRecoveryTimer = (tabId: string) => {
        const timer = recoveryTimersRef.current.get(tabId)
        if (timer) clearTimeout(timer)
        recoveryTimersRef.current.delete(tabId)
    }

    const setTabProblem = (tabId: string, problem: TabProblem) => {
        tabProblemsRef.current = { ...tabProblemsRef.current, [tabId]: problem }
        setTabProblems(tabProblemsRef.current)
    }

    const clearTabProblem = (tabId: string) => {
        clearRecoveryTimer(tabId)
        recoveryAttemptsRef.current.delete(tabId)
        if (!tabProblemsRef.current[tabId]) return
        const next = { ...tabProblemsRef.current }
        delete next[tabId]
        tabProblemsRef.current = next
        setTabProblems(next)
    }

    const scheduleTabRecovery = (tabId: string) => {
        if (!onlineRef.current || recoveryTimersRef.current.has(tabId)) return
        const attempt = recoveryAttemptsRef.current.get(tabId) || 0
        const delays = [1200, 3500, 8000]
        if (attempt >= delays.length) return

        recoveryAttemptsRef.current.set(tabId, attempt + 1)
        const timer = setTimeout(() => {
            recoveryTimersRef.current.delete(tabId)
            if (!onlineRef.current) return
            const problem = tabProblemsRef.current[tabId]
            if (problem) {
                setTabProblem(tabId, { ...problem, message: 'Reconnecting…' })
            }
            try {
                webviewRefs.current[tabId]?.reload()
            } catch {
                scheduleTabRecovery(tabId)
            }
        }, delays[attempt])
        recoveryTimersRef.current.set(tabId, timer)
    }

    const retryTab = (tabId: string) => {
        if (!onlineRef.current) return
        clearRecoveryTimer(tabId)
        recoveryAttemptsRef.current.set(tabId, 0)
        const problem = tabProblemsRef.current[tabId]
        if (problem) setTabProblem(tabId, { ...problem, message: 'Reconnecting…' })
        try {
            webviewRefs.current[tabId]?.reload()
        } catch {
            scheduleTabRecovery(tabId)
        }
    }

    useEffect(() => {
        const handleOnline = () => {
            onlineRef.current = true
            setIsOnline(true)
            Object.keys(tabProblemsRef.current).forEach(tabId => {
                recoveryAttemptsRef.current.set(tabId, 0)
                scheduleTabRecovery(tabId)
            })
        }
        const handleOffline = () => {
            onlineRef.current = false
            setIsOnline(false)
            recoveryTimersRef.current.forEach(clearTimeout)
            recoveryTimersRef.current.clear()
        }

        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)
        return () => {
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
            recoveryTimersRef.current.forEach(clearTimeout)
            recoveryTimersRef.current.clear()
        }
    }, [])

    // Keep tabsRef in sync so event handlers always see latest tabs
    const tabsRef = React.useRef(tabs)
    useEffect(() => { tabsRef.current = tabs }, [tabs])

    // Warm heavy background tabs one at a time after Messenger has settled.
    // This keeps startup responsive without sacrificing instant later switches.
    const prewarmScheduledRef = React.useRef(false)
    const prewarmTimersRef = React.useRef<NodeJS.Timeout[]>([])
    useEffect(() => () => {
        prewarmTimersRef.current.forEach(clearTimeout)
        prewarmTimersRef.current = []
    }, [])

    // Tab Pruning Logic: Keep only N most recently visited marketplace items
    useEffect(() => {
        const marketplaceItems = tabs.filter(t => t.type === 'marketplace-item')
        if (marketplaceItems.length > MAX_PRUNABLE_TABS) {
            const sorted = [...marketplaceItems].sort((a, b) => (a.lastVisited || 0) - (b.lastVisited || 0))
            const tabsToPrune = sorted.slice(0, marketplaceItems.length - MAX_PRUNABLE_TABS)
            const pruneIds = new Set(tabsToPrune.map(t => t.id).filter(id => id !== activeTabId))

            if (pruneIds.size > 0) {
                pruneIds.forEach(id => {
                    delete unreadCountsRef.current[id]
                    clearTabProblem(id)
                })
                updateAggregatedUnreadCount()
                setTabs(prev => prev.filter(t => !pruneIds.has(t.id)))
            }
        }
    }, [activeTabId, tabs.length])

    // Unread count aggregation
    const unreadCountsRef = React.useRef<{ [tabId: string]: number }>({})
    const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null)
    const lastSentCountRef = React.useRef<number>(0)
    // Notification-based unread count — persists until user clicks messenger tab.
    // This ensures the dock badge shows even when DOM-based detection reports 0.
    const notifUnreadRef = React.useRef<number>(0)

    const updateAggregatedUnreadCount = () => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)

        const domTotal = Object.values(unreadCountsRef.current).reduce((sum, count) => sum + count, 0)
        const total = Math.max(domTotal, notifUnreadRef.current)

        if (total > lastSentCountRef.current) {
            // Increase: send immediately so badge appears without delay
            lastSentCountRef.current = total
            window.electron.ipcRenderer.send('unread-count', total)
        } else if (total < lastSentCountRef.current) {
            // Decrease: debounce with longer timeout to avoid flicker
            // (Facebook briefly resets the title during re-renders)
            debounceTimerRef.current = setTimeout(() => {
                const domFinal = Object.values(unreadCountsRef.current).reduce((sum, count) => sum + count, 0)
                const finalTotal = Math.max(domFinal, notifUnreadRef.current)
                lastSentCountRef.current = finalTotal
                window.electron.ipcRenderer.send('unread-count', finalTotal)
            }, 2000)
        }
    }

    // Fetch webview preload path
    useEffect(() => {
        window.electron.ipcRenderer.invoke('get-webview-preload-path').then(path => {
            const fileUrl = path.startsWith('/') ? `file://${path}` : path
            setWebviewPreloadPath(fileUrl)
        })

        // Load settings from disk
        window.electron.ipcRenderer.invoke('get-settings').then((saved: Partial<AppSettings>) => {
            if (saved && typeof saved === 'object') {
                setAppSettings(prev => ({ ...prev, ...saved }))
            }
        })
    }, [])

    // Check for updates on mount (respects settings)
    useEffect(() => {
        if (appSettings.autoCheckUpdates) {
            window.electron.ipcRenderer.invoke('check-for-updates').then((info: any) => {
                if (info && info.hasUpdate) {
                    setUpdateInfo({
                        latestVersion: info.latestVersion,
                        assetUrl: info.assetUrl,
                        releaseName: info.releaseName
                    })
                }
            })
        }

        // Listen for update progress from main process
        const removeListener = window.electron.ipcRenderer.on('update-progress', (_event: any, data: any) => {
            const { stage, percent, errorMessage } = typeof data === 'object' ? data : { stage: data, percent: undefined, errorMessage: undefined }
            setUpdateStage(stage)
            if (percent !== undefined) setDownloadPercent(percent)
            if (errorMessage) setUpdateErrorMessage(errorMessage)
        })

        // Listen for forced update check from menu
        const removeForceListener = window.electron.ipcRenderer.on('force-update-check', (_event: any, info: any) => {
            setUpdateInfo({
                latestVersion: info.latestVersion,
                assetUrl: info.assetUrl,
                releaseName: info.releaseName
            })
            setUpdateDismissed(false)
            setUpdateStage('idle')
        })

        // Listen for notification click — switch to Messenger and open the exact thread when known.
        const removeNotifClickListener = window.electron.ipcRenderer.on('notification-clicked', (_event: any, data: any) => {
            console.log('[NOTIF] Notification clicked — opening Messenger destination')
            openMessengerDestination(data?.sourceUrl)
            setHasUnread(false)
            notifUnreadRef.current = 0
            updateAggregatedUnreadCount()
        })

        // Keyboard handlers for lightbox
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setZoomGallery(null)
                setShowSettings(false)
                setShowNotifLog(false)
            }
            if (e.key === 'ArrowRight') setZoomGallery(prev =>
                prev && prev.index < prev.images.length - 1 ? { ...prev, index: prev.index + 1 } : prev
            )
            if (e.key === 'ArrowLeft') setZoomGallery(prev =>
                prev && prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev
            )
        }
        window.addEventListener('keydown', handleKeyDown)

        return () => {
            removeListener?.(); removeForceListener?.(); removeNotifClickListener?.()
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [])

    const handleDismissUpdate = (dontRemind: boolean) => {
        if (dontRemind && updateInfo) {
            window.electron.ipcRenderer.send('dismiss-update-version', updateInfo.latestVersion)
        }
        setUpdateDismissed(true)
    }

    const handlePerformUpdate = () => {
        if (!updateInfo) return
        setUpdateStage('downloading')
        window.electron.ipcRenderer.invoke('perform-update', updateInfo.assetUrl).catch(() => {
            setUpdateStage('error')
        })
    }

    // Refs for event handlers so removeEventListener works with the exact same reference
    const handlersRef = React.useRef<Map<string, {
        newWindow: any
        willNavigate: any
        domReady: any
        didFinishLoad: any
        ipcMessage: any
        didFailLoad: any
        renderProcessGone: any
    }>>(new Map())

    // Function to open new marketplace item — uses functional setTabs for atomic dedup
    const openMarketplaceItem = (url: string) => {
        const cleanUrl = url.replace(/\/$/, '')
        setTabs(prev => {
            const existing = prev.find(t => t.url.replace(/\/$/, '') === cleanUrl)
            if (existing) {
                // Tab already exists — just switch to it
                setActiveTabId(existing.id)
                return prev.map(t =>
                    t.id === existing.id
                        ? { ...t, hasBeenVisited: true, lastVisited: Date.now() }
                        : t
                )
            }
            const id = `item-${Date.now()}`
            setActiveTabId(id)
            return [...prev, {
                id,
                type: 'marketplace-item' as TabType,
                url,
                hasBeenVisited: true,
                lastVisited: Date.now()
            }]
        })
    }

    // Function to close tab
    const closeTab = (e: React.MouseEvent, id: string) => {
        e.stopPropagation()
        setTabs(prev => prev.filter(t => t.id !== id))
        delete unreadCountsRef.current[id]
        clearTabProblem(id)
        updateAggregatedUnreadCount()

        if (activeTabId === id) {
            handleTabSwitch('messenger')
        }
    }

    const baseHideCSS = `
        div.mw227v9j span, 
        div[class*="x1n2onr6"][style*="bottom"][style*="right"],
        div[style*="position: fixed"][style*="bottom"][style*="right"],
        div[style*="position: fixed"][style*="bottom: 0"],
        div[style*="position: absolute"][style*="bottom"][style*="right"],
        div[data-pagelet="Dock"], 
        div[data-pagelet="ChatTab"],
        div[data-pagelet="RightRail"],
        div[data-pagelet="BuddyListPaglet"],
        div[data-pagelet="ContactList"],
        div[aria-label="Contacts"],
        div[aria-label="Active contacts"],
        div[aria-label="Messenger overlay"],
        div[aria-label="Chat tab"],
        div[aria-label="Chat conversation"],
        [aria-label="Close chat"],
        [aria-label="Minimize chat"],
        [aria-label="Open chat"],
        [data-testid="mw_chat_tab_container"],
        [data-testid="mw_chat_tabs_container"],
        [data-testid="messenger_dock"],
        div[role="complementary"],
        div[role="complementary"] iframe,
        div[role="dialog"][style*="position: fixed"],
        div.mw227v9j,
        div.fbDockWrapper,
        div.fbDock,
        div.fbNub
        { 
            display: none !important; 
            opacity: 0 !important; 
            pointer-events: none !important; 
            visibility: hidden !important;
            z-index: -9999 !important;
            width: 0 !important;
            height: 0 !important;
            max-height: 0 !important;
            overflow: hidden !important;
        }
    `

    const facebookChromeCSS = `
        .fbDockWrapper, .fbDock, .fbNub, 
        [role="banner"],
        div[role="banner"],
        div[data-pagelet="BlueBar"],
        [aria-label="New message"], 
        [aria-label="New Message"],
        [aria-label="Compose message"],
        [aria-label="Create"],
        [aria-label="Messenger"],
        [aria-label="Chat settings"],
        [aria-label="Contacts"],
        [aria-label="Active contacts"],
        [aria-label="Facebook Marketplace Assistant"],
        [aria-label="Chat tab"],
        [aria-label="Chat conversation"],
        [aria-label="Close chat"],
        [aria-label="Minimize chat"],
        [aria-label="Open chat"],
        [aria-label="Messenger overlay"],
        div[aria-label="New message"],
        div[role="button"][aria-label="New message"],
        div[role="button"][aria-label="Messenger"],
        div[role="button"][aria-label="Create"],
        div[role="link"][aria-label="Create new listing"],
        div[role="complementary"],
        div[role="dialog"][style*="position: fixed"],
        div[data-pagelet="Dock"],
        div[data-pagelet="ChatTab"],
        div[data-pagelet="RightRail"],
        div[data-pagelet="BuddyListPaglet"],
        div[data-pagelet="ContactList"],
        div[data-testid="mw_chat_tab_container"],
        div[data-testid="mw_chat_tabs_container"],
        div[data-testid="messenger_dock"],
        div.mw227v9j,
        div.fbDockWrapper,
        div.fbDock,
        div.fbNub,
        div[style*="position: fixed"][style*="bottom: 0"][style*="right: 0"],
        div[style*="position: fixed"][style*="bottom: 0"],
        div[class*="x1n2onr6"][style*="right: 0px"]
        { 
            display: none !important; 
            opacity: 0 !important; 
            pointer-events: none !important; 
            visibility: hidden !important;
            height: 0 !important;
            width: 0 !important;
            max-height: 0 !important;
            overflow: hidden !important;
        }
    `

    // Only rebuild guest listeners when a webview is mounted, removed, or changes URL.
    // lastVisited updates on every switch and must not churn native event listeners.
    const webviewLifecycleKey = tabs
        .map(tab => `${tab.id}:${tab.url}:${tab.hasBeenVisited ? 1 : 0}`)
        .join('|')

    // Attach events manually for all webviews — uses stored handler refs for proper cleanup
    useEffect(() => {
        tabs.forEach(tab => {
            const el = webviewRefs.current[tab.id]
            if (!el) return

            // Remove old handlers using stored refs (same reference = actually removes)
            const oldHandlers = handlersRef.current.get(tab.id)
            if (oldHandlers) {
                el.removeEventListener('new-window', oldHandlers.newWindow)
                el.removeEventListener('will-navigate', oldHandlers.willNavigate)
                el.removeEventListener('dom-ready', oldHandlers.domReady)
                el.removeEventListener('did-finish-load', oldHandlers.didFinishLoad)
                el.removeEventListener('ipc-message', oldHandlers.ipcMessage)
                el.removeEventListener('did-fail-load', oldHandlers.didFailLoad)
                el.removeEventListener('render-process-gone', oldHandlers.renderProcessGone)
            }

            const handleNewWindow = (e: any) => {
                const url = e.url
                e.preventDefault()

                const lowerUrl = url.toLowerCase()
                if (lowerUrl.includes('/marketplace/item/') ||
                    lowerUrl.includes('/item/') ||
                    lowerUrl.includes('/marketplace/listing/') ||
                    lowerUrl.includes('marketplace_item_id') ||
                    lowerUrl.includes('referral_code=marketplace')) {
                    openMarketplaceItem(url)
                    return
                }

                if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                    window.electron.ipcRenderer.send('open-external-url', url)
                }
            }

            const handleWillNavigate = (e: any) => {
                const url = e.url
                if (!url) return

                const lowerUrl = url.toLowerCase()

                // Open marketplace items in a new in-app tab
                if (lowerUrl.includes('/marketplace/item/') ||
                    lowerUrl.includes('/item/') ||
                    lowerUrl.includes('/marketplace/listing/') ||
                    lowerUrl.includes('marketplace_item_id')) {
                    e.preventDefault()
                    openMarketplaceItem(url)
                    return
                }

                // Allow core messenger navigation to stay in-app
                if (lowerUrl.includes('messenger.com') ||
                    lowerUrl.includes('l.messenger.com') ||
                    (lowerUrl.includes('facebook.com') && (lowerUrl.includes('/messages') || lowerUrl.includes('/messenger_media'))) ||
                    (lowerUrl.includes('fb.com') && (lowerUrl.includes('/messages') || lowerUrl.includes('/messenger_media')))) {
                    return
                }

                // Allow marketplace & saved internal navigation to stay in-app
                if ((lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.com')) &&
                    (lowerUrl.includes('/marketplace') || lowerUrl.includes('/saved'))) {
                    return
                }

                // Non-Facebook links and non-app Facebook links (groups, reels, profiles, events, etc.) -> external browser
                if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.com') || lowerUrl.includes('fbcdn.net')) {
                    e.preventDefault()
                    window.electron.ipcRenderer.send('open-external-url', url)
                    return
                }

                // All other external links -> external browser
                if (url.startsWith('http://') || url.startsWith('https://')) {
                    e.preventDefault()
                    window.electron.ipcRenderer.send('open-external-url', url)
                }
            }

            const handleDomReady = () => {
                if (tab.type === 'messenger' && !prewarmScheduledRef.current) {
                    prewarmScheduledRef.current = true

                    const warmTab = (tabId: string) => {
                        setTabs(prev => prev.map(candidate =>
                            candidate.id === tabId && !candidate.hasBeenVisited
                                ? { ...candidate, hasBeenVisited: true }
                                : candidate
                        ))
                    }

                    prewarmTimersRef.current.push(
                        setTimeout(() => warmTab('marketplace'), 3000),
                        setTimeout(() => warmTab('saved'), 6000)
                    )
                }

                // Only inject chat-hiding CSS if setting is enabled
                if (settingsRef.current.hideChatBubbles) {
                    try {
                        el.insertCSS(baseHideCSS);
                    } catch (e) { }
                }

                // Hide the Facebook top banner bar on ALL tabs
                // (messenger tab is now on facebook.com/messages, not messenger.com)
                try {
                    // Banner-only CSS — safe for messenger (doesn't touch the chat list sidebar)
                    const bannerHideCSS = `
                        [role="banner"],
                        div[role="banner"],
                        div[data-pagelet="BlueBar"]
                        {
                            display: none !important;
                            opacity: 0 !important;
                            pointer-events: none !important;
                            visibility: hidden !important;
                            height: 0 !important;
                            width: 0 !important;
                            overflow: hidden !important;
                        }
                    `;
                    el.insertCSS(bannerHideCSS);

                    const coverScript = `
                        (function() {
                            var cover = document.getElementById('dyad-header-cover');
                            if (!cover) {
                                cover = document.createElement('div');
                                cover.id = 'dyad-header-cover';
                                cover.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:56px;background:#18191A;z-index:2147483647;pointer-events:none;';
                                document.body.appendChild(cover);
                            }
                        })();
                    `;
                    el.executeJavaScript(coverScript);
                } catch (e) { }

                if (tab.type !== 'messenger' && settingsRef.current.hideChatBubbles) {
                    try {
                        el.insertCSS(facebookChromeCSS);
                    } catch (e) { }
                }

                // Saved pages can fully reload without React remounting the webview.
                // Reapply the helper whenever that guest document becomes ready.
                if (tab.type === 'saved') {
                    const script = settingsRef.current.unsaveButton
                        ? UNSAVE_INJECTION_SCRIPT
                        : UNSAVE_CLEANUP_SCRIPT
                    el.executeJavaScript(script).catch(() => {})
                }
            }

            const handleDidFinishLoad = () => {
                clearTabProblem(tab.id)
            }

            const handleDidFailLoad = (event: any) => {
                // -3 is Chromium's ERR_ABORTED and is expected during redirects or
                // deliberate navigation. Subframe failures should not replace the app.
                if (event.isMainFrame === false || event.errorCode === -3) return

                const offline = !onlineRef.current
                setTabProblem(tab.id, {
                    kind: 'load-failed',
                    title: offline ? 'You’re offline' : 'Couldn’t load Facebook',
                    message: offline
                        ? 'Your conversations are safe. We’ll reconnect when the network returns.'
                        : 'The page did not finish loading. We’ll retry automatically.'
                })
                scheduleTabRecovery(tab.id)
            }

            const handleRenderProcessGone = () => {
                setTabProblem(tab.id, {
                    kind: 'crashed',
                    title: 'This tab needs a restart',
                    message: 'Facebook stopped responding. We’ll restore the tab without restarting the app.'
                })
                scheduleTabRecovery(tab.id)
            }

            const handleIpcMessage = (e: any) => {
                if (e.channel === 'webview-notification') {
                    const { title, options, sourceUrl, sourcePathname } = e.args[0]

                    const debugId = `[${tab.type}:${tab.id}]`
                    const dbg = settingsRef.current.debugLogging
                    if (dbg) console.log(
                        `%c[NOTIF-FILTER] ${debugId} 📨 Received notification`,
                        'background: #2563EB; color: white; padding: 2px 6px; border-radius: 3px;',
                        '\n  Title:', title,
                        '\n  Body:', options?.body || '(none)',
                        '\n  Tag:', options?.tag || '(none)',
                        '\n  Source URL:', sourceUrl,
                        '\n  Source Path:', sourcePathname
                    )

                    // Helper to log notification to the in-app log
                    const logNotif = (verdict: 'allowed' | 'blocked', reason: string, layer?: string) => {
                        const entry: NotifLogEntry = {
                            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                            timestamp: Date.now(),
                            title: title || '(untitled)',
                            body: options?.body || '',
                            tag: options?.tag,
                            icon: options?.icon,
                            sourceUrl: sourceUrl || '',
                            sourcePath: sourcePathname || '',
                            tabType: tab.type,
                            tabId: tab.id,
                            verdict,
                            reason,
                            layer
                        }
                        setNotifLog(prev => [entry, ...prev].slice(0, 200))
                    }

                    // Global self-sent message check (case-insensitive prefixes in common languages)
                    const bodyLower = (options?.body || '').toLowerCase()
                    const selfPrefixes = [
                        'you:', 'you sent', 'you shared', 'you reacted', 'you liked',
                        'vous:', 'vous avez',
                        'tú:', 'tú enviaste', 'enviaste',
                        'du:', 'du hast',
                        'вы:', 'вы отправили',
                        'você:', 'você enviou',
                        'tu:', 'hai inviato'
                    ]
                    if (selfPrefixes.some(p => bodyLower.startsWith(p))) {
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED: self-sent message (body starts with self prefix)`, 'color: #EF4444')
                        logNotif('blocked', 'Self-sent message (body prefix)', 'Self-sent Filter')
                        return
                    }

                    // Check if notifications are disabled in renderer-side settings
                    if (!settingsRef.current.notifications) {
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ⏭️ Notifications disabled in settings`, 'color: #F59E0B')
                        logNotif('blocked', 'Notifications disabled in settings', 'Settings')
                        return
                    }

                    // Only show notifications from messenger and marketplace tabs
                    if (tab.type !== 'messenger' && tab.type !== 'marketplace') {
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED: tab type is '${tab.type}' (not messenger/marketplace)`, 'color: #EF4444')
                        logNotif('blocked', `Tab type '${tab.type}' not messenger/marketplace`, 'Tab Filter')
                        return
                    }

                    // Title-detected notifications are pre-validated by our DOM-based
                    // detector (title count went UP = confirmed new activity).
                    // Skip the heavy filter pipeline — it was designed for intercepted
                    // Facebook Notification API calls and blocks legitimate messages.
                    if (options?.tag === 'title-detection') {
                        if (dbg) console.log(
                            `%c[NOTIF-FILTER] ${debugId} ✅ FAST-PASS: title-detected notification (pre-validated)`,
                            'background: #22C55E; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;'
                        )
                        logNotif('allowed', 'Title-detected (pre-validated)', 'Fast-pass')

                        showToast(title, options.body, options.icon || undefined, sourceUrl)
                        setHasUnread(true)

                        // Update dock badge with notification-based unread count
                        notifUnreadRef.current += 1
                        updateAggregatedUnreadCount()

                        window.electron.ipcRenderer.send('show-notification', {
                            title,
                            body: options.body,
                            icon: options.icon || undefined,
                            sourceUrl
                        })
                        return
                    }

                    // --- STRICT FILTERING: Block by default, only allow real chat messages ---

                    // Layer 1: Source URL — must originate from correct path for tab type
                    if (tab.type === 'messenger') {
                        const path = sourcePathname || ''
                        if (!path.startsWith('/messages')) {
                            if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED Layer 1: source path '${path}' doesn't start with /messages`, 'color: #EF4444')
                            logNotif('blocked', `Source path '${path}' not /messages`, 'Layer 1: Source Path')
                            return
                        }
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ✅ Layer 1 passed: source path OK`, 'color: #22C55E')
                    }
                    if (tab.type === 'marketplace') {
                        const path = sourcePathname || ''
                        if (!path.startsWith('/marketplace')) {
                            if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED Layer 1: source path '${path}' doesn't start with /marketplace`, 'color: #EF4444')
                            logNotif('blocked', `Source path '${path}' not /marketplace`, 'Layer 1: Source Path')
                            return
                        }
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ✅ Layer 1 passed: marketplace source path OK`, 'color: #22C55E')
                    }

                    // Layer 2: Must have BOTH title AND body
                    // Real message notifications = sender name (title) + message preview (body)
                    // Most generic Facebook notifications lack a body or have title-only
                    if (!title || !options.body) {
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED Layer 2: missing title or body (title=${!!title}, body=${!!options.body})`, 'color: #EF4444')
                        logNotif('blocked', `Missing ${!title ? 'title' : 'body'}`, 'Layer 2: Title+Body')
                        return
                    }
                    if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ✅ Layer 2 passed: has title and body`, 'color: #22C55E')

                    // Layer 3: Title length — sender names are short, action descriptions are long
                    if (title.length > 50) {
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED Layer 3: title too long (${title.length} chars)`, 'color: #EF4444')
                        logNotif('blocked', `Title too long (${title.length} chars)`, 'Layer 3: Title Length')
                        return
                    }
                    if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ✅ Layer 3 passed: title length OK (${title.length})`, 'color: #22C55E')

                    const titleLower = title.toLowerCase()
                    const combined = `${titleLower} ${bodyLower}`

                    // Layer 4: Aggressive blocklist — reject if ANY of these appear in title OR body
                    const blockPatterns = [
                        // Social interactions
                        'commented', 'comment on', 'replied to your', 'reply to your',
                        'reacted to your', 'reaction to', 'liked your', 'likes your',
                        'loves your', 'shared your', 'shared a link', 'shared a post',
                        'tagged you', 'tagged in', 'mentioned you', 'mention in',
                        // Friend/follow activity
                        'friend request', 'accepted your', 'people you may know',
                        'new follower', 'follow request', 'is following you',
                        'wants to be your', 'sent you a friend',
                        // Posts & media activity
                        'posted in', 'posted on', 'posted a', 'new post',
                        'your post', 'your photo', 'your video', 'your comment',
                        'added a new', 'updated their', 'changed their',
                        'checked in', 'was tagged', 'were tagged',
                        'also commented', 'also replied',
                        // Content types
                        'story', 'stories', 'reel', 'reels',
                        'went live', 'is live', 'live video',
                        // Memories & events
                        'birthday', 'memory', 'memories', 'on this day',
                        'event', 'happening today', 'happening near',
                        // Pages & groups
                        'group', 'page', 'fundraiser', 'community',
                        'suggested for you', 'suggestion for you', 'recommend',
                        // Account & security
                        'new notification', 'new login', 'security',
                        'password', 'account', 'verify', 'confirm',
                        // Marketplace (non-chat)
                        'marketplace assistant', 'listing', 'price drop',
                        'back in stock', 'similar items', 'items you',
                        // Pokes & misc social
                        'poked you', 'invited you', 'invite to',
                        'is now friends', 'became friends',
                        // Request types
                        'message request', 'new request', 'pending request',
                        // Marketplace interest / activity (not chat)
                        'is interested in', 'are interested', 'interested in your',
                        // Group / community activity
                        'just joined', 'joined the',
                        // Timeline activity
                        'wrote on', 'is celebrating', 'anniversary',
                        // Engagement bait / suggestions
                        'check out', 'you might like', "don't miss",
                        'reminder', "don't forget", 'upcoming',
                        'trending', 'popular near', 'popular in',
                        // Generic notification pushes
                        'notifications for you', 'new from',
                        'people also', 'others also',
                        // Typing indicators (should never be native notifs)
                        'is typing',
                        // Location-based suggestions
                        'available in your area', 'near you',
                        // Prompts & calls-to-action
                        'what\'s on your mind', 'write something',
                        'see more', 'view more', 'tap to',
                        'watch now', 'listen now',
                        // Commercial / promotional
                        'discount', 'deal', 'offer', 'promotion',
                        'update available', 'new feature'
                    ]
                    const matchedBlock = blockPatterns.find(p => combined.includes(p))
                    if (matchedBlock) {
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED Layer 4: blocklist match '${matchedBlock}'`, 'color: #EF4444', '\n  Combined:', combined)
                        logNotif('blocked', `Blocklist match: "${matchedBlock}"`, 'Layer 4: Blocklist')
                        return
                    }
                    if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ✅ Layer 4 passed: no blocklist match`, 'color: #22C55E')

                    // Layer 5: Positive allowlist — MUST match a chat message pattern
                    // Only let through notifications that look like actual incoming messages
                    const messagePatterns = [
                        'sent you a', 'sent a message', 'sent an audio',
                        'sent a voice', 'sent a photo', 'sent a video',
                        'sent a sticker', 'sent a gif', 'sent a file',
                        'sent a link', 'sent you', 'sent a',
                        'new message', 'replied to you',
                        'is calling', 'missed call', 'missed a call',
                        'voice message', 'voice call', 'video call',
                        'named the group', 'changed the group',
                        'added you to', 'removed you from',
                        '👍', 'thumbs up'
                    ]
                    const tag = (options.tag || '').toLowerCase()
                    const isMessengerTag = tag.includes('msg') || tag.includes('thread') ||
                        tag.includes('chat') || tag.includes('mercury')
                    const matchesMessagePattern = messagePatterns.some(p => combined.includes(p))
                    const matchedPattern = messagePatterns.find(p => combined.includes(p))

                    if (dbg) console.log(
                        `%c[NOTIF-FILTER] ${debugId} 🔎 Layer 5 check:`,
                        'color: #F59E0B',
                        '\n  Tag:', tag || '(none)',
                        '\n  Is messenger tag:', isMessengerTag,
                        '\n  Matches message pattern:', matchesMessagePattern, matchedPattern ? `('${matchedPattern}')` : '',
                        '\n  Body length:', bodyLower.length
                    )

                    // Allow if: has a messenger-specific tag, OR matches a message pattern,
                    // OR body is very short (≤ 30 chars, likely a genuine chat message like "hey" or emoji)
                    // AND does not contain suspicious Facebook engagement patterns
                    const suspiciousShortPatterns = [
                        'notification', 'update', 'new from', 'check', 'see ',
                        'view ', 'tap ', 'click', 'visit', 'open ',
                        'available', 'discover', 'explore', 'try ',
                        'join ', 'follow', 'subscribe', 'watch',
                        'suggested', 'recommended', 'popular',
                        'remind', 'upcoming', 'missed', 'trending'
                    ]
                    const hasSuspiciousContent = suspiciousShortPatterns.some(p => combined.includes(p))
                    const isShortBody = bodyLower.length <= 30 && !hasSuspiciousContent

                    if (!isMessengerTag && !matchesMessagePattern && !isShortBody) {
                        const reason = bodyLower.length > 30
                            ? `body too long (${bodyLower.length} chars, max 30)`
                            : `suspicious content in short body`
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED Layer 5: no messenger tag, no message pattern, ${reason}`, 'color: #EF4444')
                        logNotif('blocked', `No messenger tag, no message pattern, ${reason}`, 'Layer 5: Allowlist')
                        return
                    }
                    if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ✅ Layer 5 passed: ${isMessengerTag ? 'messenger tag' : matchesMessagePattern ? `pattern '${matchedPattern}'` : `short clean body (${bodyLower.length})`}`, 'color: #22C55E')

                    // Final safety: if body contains action verbs that indicate FB activity, block it
                    const actionVerbs = [
                        'commented', 'replied to a', 'reacted', 'liked', 'shared',
                        'tagged', 'mentioned', 'invited', 'posted', 'suggested',
                        'followed', 'is following'
                    ]
                    const matchedVerb = actionVerbs.find(v => bodyLower.includes(v))
                    if (matchedVerb && !matchesMessagePattern) {
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED Final: action verb '${matchedVerb}' without message pattern`, 'color: #EF4444')
                        logNotif('blocked', `Action verb "${matchedVerb}" without message pattern`, 'Layer 6: Action Verbs')
                        return
                    }

                    // Layer 7: Deduplication — suppress identical notifications within 10 seconds
                    const notifHash = `${titleLower}::${bodyLower}`
                    const now = Date.now()
                    const lastSeen = recentNotifHashes.current.get(notifHash)
                    if (lastSeen && now - lastSeen < 10000) {
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED Layer 7: duplicate notification (seen ${Math.round((now - lastSeen) / 1000)}s ago)`, 'color: #EF4444')
                        logNotif('blocked', `Duplicate (seen ${Math.round((now - lastSeen) / 1000)}s ago)`, 'Layer 7: Dedup')
                        return
                    }
                    // Record this notification hash and prune old entries
                    recentNotifHashes.current.set(notifHash, now)
                    if (recentNotifHashes.current.size > 50) {
                        const cutoff = now - 30000
                        for (const [key, ts] of recentNotifHashes.current) {
                            if (ts < cutoff) recentNotifHashes.current.delete(key)
                        }
                    }

                    if (dbg) console.log(
                        `%c[NOTIF-FILTER] ${debugId} ✅✅✅ NOTIFICATION ALLOWED — sending to main process`,
                        'background: #22C55E; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
                        '\n  Title:', title,
                        '\n  Body:', options.body
                    )

                    const allowReason = isMessengerTag ? 'Messenger tag' : matchedPattern ? `Pattern: "${matchedPattern}"` : `Short body (${bodyLower.length} chars)`
                    logNotif('allowed', allowReason, 'All layers passed')

                    // Show in-app toast notification (always works, no OS dependency)
                    showToast(title, options.body, options.icon || undefined, sourceUrl)

                    // Set unread indicator on messenger icon and dock badge
                    setHasUnread(true)
                    notifUnreadRef.current += 1
                    updateAggregatedUnreadCount()

                    window.electron.ipcRenderer.send('show-notification', {
                        title,
                        body: options.body,
                        icon: options.icon || undefined,
                        sourceUrl
                    })
                } else if (e.channel === 'unread-count') {
                    const count = e.args[0]

                    // Only count unreads from messenger and marketplace tabs
                    if (tab.type !== 'messenger' && tab.type !== 'marketplace') return

                    unreadCountsRef.current[tab.id] = count
                    updateAggregatedUnreadCount()
                } else if (e.channel === 'open-link') {
                    const url = e.args[0]
                    if (url) {
                        const lower = url.toLowerCase()
                        if (lower.includes('/marketplace/item/') ||
                            lower.includes('/marketplace/listing/') ||
                            lower.includes('marketplace_item_id') ||
                            lower.includes('referral_code=marketplace')) {
                            openMarketplaceItem(url)
                        } else {
                            // All other links (groups, reels, profiles, etc.) -> external browser
                            window.electron.ipcRenderer.send('open-external-url', url)
                        }
                    }
                } else if (e.channel === 'open-external') {
                    const url = e.args[0]
                    if (url) {
                        window.electron.ipcRenderer.send('open-external-url', url)
                    }
                } else if (e.channel === 'open-image-zoom') {
                    const data = e.args[0]
                    if (data && data.images && data.images.length > 0) {
                        setZoomGallery({ images: data.images, index: data.index || 0 })
                    } else if (typeof data === 'string') {
                        // Backwards compat: single URL string
                        setZoomGallery({ images: [data], index: 0 })
                    }
                }
            }

            // Add new handlers and store references for future cleanup
            el.addEventListener('new-window', handleNewWindow)
            el.addEventListener('will-navigate', handleWillNavigate)
            el.addEventListener('dom-ready', handleDomReady)
            el.addEventListener('did-finish-load', handleDidFinishLoad)
            el.addEventListener('ipc-message', handleIpcMessage)
            el.addEventListener('did-fail-load', handleDidFailLoad)
            el.addEventListener('render-process-gone', handleRenderProcessGone)
            handlersRef.current.set(tab.id, {
                newWindow: handleNewWindow,
                willNavigate: handleWillNavigate,
                domReady: handleDomReady,
                didFinishLoad: handleDidFinishLoad,
                ipcMessage: handleIpcMessage,
                didFailLoad: handleDidFailLoad,
                renderProcessGone: handleRenderProcessGone
            })
        })

        // Drop references for removed tabs immediately. Existing tabs have their
        // prior handlers replaced at the start of this effect.
        const currentTabIds = new Set(tabs.map(t => t.id))
        handlersRef.current.forEach((handlers, tabId) => {
            if (!currentTabIds.has(tabId)) {
                const el = webviewRefs.current[tabId]
                if (el) {
                    el.removeEventListener('new-window', handlers.newWindow)
                    el.removeEventListener('will-navigate', handlers.willNavigate)
                    el.removeEventListener('dom-ready', handlers.domReady)
                    el.removeEventListener('did-finish-load', handlers.didFinishLoad)
                    el.removeEventListener('ipc-message', handlers.ipcMessage)
                    el.removeEventListener('did-fail-load', handlers.didFailLoad)
                    el.removeEventListener('render-process-gone', handlers.renderProcessGone)
                }
                clearTabProblem(tabId)
                delete webviewRefs.current[tabId]
                handlersRef.current.delete(tabId)
            }
        })
    }, [webviewLifecycleKey, webviewPreloadPath])

    // Automated Unsave Injection for Saved Tab
    useEffect(() => {
        const el = webviewRefs.current['saved']
        if (!el) return

        if (!appSettings.unsaveButton) {
            el.executeJavaScript(UNSAVE_CLEANUP_SCRIPT).catch(() => {})
            return
        }

        if (activeTabId === 'saved') {
            try { el.insertCSS(facebookChromeCSS); } catch (e) { }
            el.executeJavaScript(UNSAVE_INJECTION_SCRIPT).catch(() => {})
        }
    }, [activeTabId, appSettings.unsaveButton, webviewLifecycleKey])

    const activeProblem = tabProblems[activeTabId]

    return (
        <div className="app-container">
            <div className="window-drag-region" aria-hidden="true" />
            <aside className="sidebar">
                <nav aria-label="App navigation">
                    {/* Persistent Back Button Area */}
                    <div className="nav-item-wrapper">
                        <button
                            className="nav-btn nav-btn-back"
                            onClick={() => {
                                const wv = webviewRefs.current[activeTabId]
                                const activeTab = tabs.find(t => t.id === activeTabId)

                                // If the webview has navigation history, go back
                                if (wv && wv.canGoBack()) {
                                    wv.goBack()
                                    return
                                }

                                // For marketplace-item tabs with no history, close tab and return to marketplace
                                if (activeTab?.type === 'marketplace-item') {
                                    setTabs(prev => prev.filter(t => t.id !== activeTabId))
                                    delete unreadCountsRef.current[activeTabId]
                                    clearTabProblem(activeTabId)
                                    handleTabSwitch('marketplace')
                                }
                            }}
                            aria-label="Go back"
                            style={{
                                visibility: activeTabId !== 'messenger' ? 'visible' : 'hidden'
                            }}
                        >
                            <NavIcon kind="back" />
                            <span className="nav-tooltip">Go back</span>
                        </button>
                    </div>

                    <div className="nav-divider" aria-hidden="true" />

                    {tabs.map(tab => (
                        <div key={tab.id} className="nav-item-wrapper">
                            <button
                                className={`nav-btn ${activeTabId === tab.id ? 'active' : ''}`}
                                onClick={() => {
                                    handleTabSwitch(tab.id)
                                    // Clear unread indicator and dock badge when switching to messenger
                                    if (tab.id === 'messenger') {
                                        setHasUnread(false)
                                        notifUnreadRef.current = 0
                                        updateAggregatedUnreadCount()
                                    }
                                }}
                                aria-label={getTabLabel(tab)}
                                aria-current={activeTabId === tab.id ? 'page' : undefined}
                            >
                                <NavIcon kind={tab.type} />
                                <span className="nav-tooltip">{getTabLabel(tab)}</span>
                                {tab.id === 'messenger' && hasUnread && (
                                    <span className="nav-unread-badge" />
                                )}
                            </button>
                            {tab.type === 'marketplace-item' && (
                                <button
                                    type="button"
                                    className="close-btn"
                                    onClick={(e) => closeTab(e, tab.id)}
                                    aria-label={`Close ${getTabLabel(tab)}`}
                                >×</button>
                            )}
                        </div>
                    ))}

                    <div className="spacer" style={{ flex: 1 }}></div>

                    {!isOnline && (
                        <div className="nav-item-wrapper">
                            <div className="connection-indicator" role="status" aria-label="Offline — waiting to reconnect">
                                <span className="connection-indicator-dot" aria-hidden="true" />
                                <span className="nav-tooltip">Offline — waiting to reconnect</span>
                            </div>
                        </div>
                    )}

                    {/* Notification log button */}
                    <div className="nav-item-wrapper">
                        <button
                            className={`nav-btn ${showNotifLog ? 'active' : ''}`}
                            onClick={() => {
                                setShowNotifLog(!showNotifLog)
                                setShowSettings(false)
                            }}
                            aria-label="Notification log"
                            aria-pressed={showNotifLog}
                        >
                            <NavIcon kind="notifications" />
                            <span className="nav-tooltip">Notification log</span>
                        </button>
                    </div>

                    {/* Settings button pinned to bottom */}
                    <div className="nav-item-wrapper">
                        <button
                            className={`nav-btn ${showSettings ? 'active' : ''}`}
                            onClick={() => {
                                setShowSettings(!showSettings)
                                setShowNotifLog(false)
                            }}
                            aria-label="Settings"
                            aria-pressed={showSettings}
                        >
                            <NavIcon kind="settings" />
                            <span className="nav-tooltip">Settings</span>
                        </button>
                    </div>
                </nav>
            </aside>
            <main className="content">
                {/* In-app Toast Notifications */}
                {toasts.length > 0 && (
                    <div className="toast-container">
                        {toasts.map(toast => (
                            <div
                                key={toast.id}
                                className="toast-notification"
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                    dismissToast(toast.id)
                                    openMessengerDestination(toast.sourceUrl)
                                    setHasUnread(false)
                                    notifUnreadRef.current = 0
                                    updateAggregatedUnreadCount()
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault()
                                        dismissToast(toast.id)
                                        openMessengerDestination(toast.sourceUrl)
                                        setHasUnread(false)
                                        notifUnreadRef.current = 0
                                        updateAggregatedUnreadCount()
                                    }
                                }}
                            >
                                <div className="toast-icon-area">
                                    {toast.icon ? (
                                        <img src={toast.icon} className="toast-avatar" alt="" />
                                    ) : (
                                        <span className="toast-icon-fallback"><NavIcon kind="messenger" /></span>
                                    )}
                                </div>
                                <div className="toast-content">
                                    <div className="toast-title">{toast.title}</div>
                                    <div className="toast-body">{toast.body}</div>
                                </div>
                                <button className="toast-dismiss" onClick={(e) => {
                                    e.stopPropagation()
                                    dismissToast(toast.id)
                                }} aria-label="Dismiss notification">×</button>
                            </div>
                        ))}
                    </div>
                )}
                {/* Image Zoom Lightbox — gallery with prev/next navigation */}
                {zoomGallery && (
                    <div
                        className="zoom-overlay"
                        onClick={() => setZoomGallery(null)}
                    >
                        <button
                            className="zoom-close"
                            onClick={() => setZoomGallery(null)}
                            title="Close (Esc)"
                        >×</button>

                        {/* Prev arrow */}
                        {zoomGallery.images.length > 1 && zoomGallery.index > 0 && (
                            <button
                                className="zoom-nav zoom-nav-prev"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    setZoomGallery(prev => prev ? { ...prev, index: prev.index - 1 } : prev)
                                }}
                                title="Previous image (←)"
                            >‹</button>
                        )}

                        {/* Next arrow */}
                        {zoomGallery.images.length > 1 && zoomGallery.index < zoomGallery.images.length - 1 && (
                            <button
                                className="zoom-nav zoom-nav-next"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    setZoomGallery(prev => prev ? { ...prev, index: prev.index + 1 } : prev)
                                }}
                                title="Next image (→)"
                            >›</button>
                        )}

                        {/* Counter indicator */}
                        {zoomGallery.images.length > 1 && (
                            <div className="zoom-counter">
                                {zoomGallery.index + 1} / {zoomGallery.images.length}
                            </div>
                        )}

                        <div className="zoom-img-wrapper" onClick={e => e.stopPropagation()}>
                            <webview
                                key={zoomGallery.images[zoomGallery.index]}
                                ref={zoomWebviewRef}
                                src={zoomGallery.images[zoomGallery.index]}
                                partition="persist:webview"
                                className="zoom-img-webview"
                                onDomReady={() => {
                                    const wv = zoomWebviewRef.current
                                    if (!wv) return
                                    wv.insertCSS(`
                                        html, body {
                                            margin: 0 !important;
                                            padding: 0 !important;
                                            background: #111 !important;
                                            display: flex !important;
                                            align-items: center !important;
                                            justify-content: center !important;
                                            min-height: 100vh !important;
                                            overflow: hidden !important;
                                        }
                                        img {
                                            max-width: 100vw !important;
                                            max-height: 100vh !important;
                                            object-fit: contain !important;
                                            display: block !important;
                                        }
                                    `).catch(() => {})
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Settings Overlay */}
                <Settings
                    visible={showSettings}
                    onClose={() => setShowSettings(false)}
                    settings={appSettings}
                    onSettingsChange={setAppSettings}
                />

                {/* Notification Log Overlay */}
                <NotificationLog
                    visible={showNotifLog}
                    onClose={() => setShowNotifLog(false)}
                    entries={notifLog}
                    onClear={() => setNotifLog([])}
                />
                {/* Update Banner */}
                {updateInfo && !updateDismissed && (
                    <div className="update-banner">
                        <div className="update-banner-content">
                            {updateStage === 'idle' ? (
                                <>
                                    <span className="update-banner-text">
                                        🚀 <strong>{updateInfo.releaseName}</strong> is available!
                                    </span>
                                    <button
                                        className="update-banner-download"
                                        onClick={handlePerformUpdate}
                                    >
                                        Update
                                    </button>
                                    <label className="update-banner-checkbox">
                                        <input
                                            type="checkbox"
                                            id="dont-remind-update"
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    handleDismissUpdate(true)
                                                }
                                            }}
                                        />
                                        Don't remind for this version
                                    </label>
                                    <button
                                        className="update-banner-close"
                                        onClick={() => handleDismissUpdate(false)}
                                        title="Dismiss"
                                    >
                                        ×
                                    </button>
                                </>
                            ) : updateStage === 'downloading' ? (
                                <>
                                    <span className="update-banner-text">
                                        ⬇️ Downloading update… {downloadPercent}%
                                    </span>
                                    <div className="update-progress-bar">
                                        <div className="update-progress-fill" style={{ width: `${downloadPercent}%` }} />
                                    </div>
                                </>
                            ) : updateStage === 'installing' ? (
                                <span className="update-banner-text">
                                    ⚙️ Installing update…
                                </span>
                            ) : updateStage === 'restarting' ? (
                                <span className="update-banner-text">
                                    🔄 Restarting…
                                </span>
                            ) : updateStage === 'error' ? (
                                <>
                                    <span className="update-banner-text">
                                        ❌ Update failed{updateErrorMessage ? `: ${updateErrorMessage}` : '. Please try again.'}
                                    </span>
                                    <button
                                        className="update-banner-download"
                                        onClick={handlePerformUpdate}
                                    >
                                        Retry
                                    </button>
                                    <button
                                        className="update-banner-close"
                                        onClick={() => handleDismissUpdate(false)}
                                        title="Dismiss"
                                    >
                                        ×
                                    </button>
                                </>
                            ) : null}
                        </div>
                    </div>
                )}
                {webviewPreloadPath && activeProblem && !showSettings && !showNotifLog && !zoomGallery && (
                    <div className="recovery-view" role="alert" aria-live="polite">
                        <div className={`recovery-mark ${activeProblem.kind}`} aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 11a8 8 0 1 0-2.35 5.65" />
                                <path d="M20 4v7h-7" />
                            </svg>
                        </div>
                        <div className="recovery-copy">
                            <span className={`recovery-status ${isOnline ? 'online' : 'offline'}`}>
                                <span aria-hidden="true" />
                                {isOnline ? 'Recovering connection' : 'No internet connection'}
                            </span>
                            <h2>{activeProblem.title}</h2>
                            <p>{activeProblem.message}</p>
                        </div>
                        <button
                            type="button"
                            className="recovery-button"
                            onClick={() => retryTab(activeTabId)}
                            disabled={!isOnline}
                        >
                            {isOnline ? 'Try again' : 'Waiting for network'}
                        </button>
                    </div>
                )}
                {!webviewPreloadPath ? (
                    <div className="app-loading" role="status" aria-live="polite">
                        <div className="app-loading-mark"><NavIcon kind="messenger" /></div>
                        <div className="app-loading-copy">
                            <strong>FB Missing Messenger</strong>
                            <span>Getting your conversations ready…</span>
                        </div>
                        <span className="app-loading-spinner" aria-hidden="true" />
                    </div>
                ) : (
                    tabs.map(tab => (
                        tab.hasBeenVisited && (
                            <webview
                                key={tab.id}
                                ref={el => { webviewRefs.current[tab.id] = el }}
                                src={tab.url}
                                className={`webview ${
                                    activeTabId === tab.id && !showSettings && !showNotifLog && !zoomGallery && !activeProblem
                                        ? 'visible'
                                        : 'hidden'
                                } ${showSettings || showNotifLog || zoomGallery || (activeTabId === tab.id && activeProblem) ? 'overlay-hidden' : ''}`}
                                useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                                allowpopups={true}
                                preload={webviewPreloadPath}
                                partition="persist:webview"
                            />
                        )
                    ))
                )}
            </main>
        </div>
    )
}

export default App
