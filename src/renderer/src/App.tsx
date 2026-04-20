import React, { useState, useEffect } from 'react'
import { Settings, AppSettings, DEFAULT_SETTINGS } from './Settings'

// Tab definitions
type TabType = 'messenger' | 'marketplace' | 'saved' | 'marketplace-item'
interface Tab {
    id: string
    type: TabType
    url: string
    title?: string
    icon?: string
    hasBeenVisited?: boolean
    lastVisited?: number
}

const MAX_PRUNABLE_TABS = 5

function App(): React.ReactElement {
    const [tabs, setTabs] = useState<Tab[]>(() => {
        const initialTabs: Tab[] = [
            { id: 'messenger', type: 'messenger', url: 'https://www.facebook.com/messages/', icon: '💬', hasBeenVisited: true, lastVisited: Date.now() },
            { id: 'marketplace', type: 'marketplace', url: 'https://www.facebook.com/marketplace/', icon: '🏪', hasBeenVisited: true, lastVisited: Date.now() - 1 },
            { id: 'saved', type: 'saved', url: 'https://www.facebook.com/saved/', icon: '🔖', hasBeenVisited: true, lastVisited: Date.now() - 2 }
        ]
        return initialTabs
    })
    const [activeTabId, setActiveTabId] = useState<string>('messenger')
    const [webviewPreloadPath, setWebviewPreloadPath] = useState<string>('')

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

    // Update visited state and timestamp when switching tabs
    const handleTabSwitch = (id: string) => {
        setActiveTabId(id)
        setTabs(prev => prev.map(t =>
            t.id === id ? { ...t, hasBeenVisited: true, lastVisited: Date.now() } : t
        ))
    }

    // Keep tabsRef in sync so event handlers always see latest tabs
    const tabsRef = React.useRef(tabs)
    useEffect(() => { tabsRef.current = tabs }, [tabs])

    // Tab Pruning Logic: Keep only N most recently visited marketplace items
    useEffect(() => {
        const marketplaceItems = tabs.filter(t => t.type === 'marketplace-item')
        if (marketplaceItems.length > MAX_PRUNABLE_TABS) {
            const sorted = [...marketplaceItems].sort((a, b) => (a.lastVisited || 0) - (b.lastVisited || 0))
            const tabsToPrune = sorted.slice(0, marketplaceItems.length - MAX_PRUNABLE_TABS)
            const pruneIds = new Set(tabsToPrune.map(t => t.id).filter(id => id !== activeTabId))

            if (pruneIds.size > 0) {
                pruneIds.forEach(id => delete unreadCountsRef.current[id])
                updateAggregatedUnreadCount()
                setTabs(prev => prev.filter(t => !pruneIds.has(t.id)))
            }
        }
    }, [activeTabId, tabs.length])

    // Unread count aggregation
    const unreadCountsRef = React.useRef<{ [tabId: string]: number }>({})
    const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null)
    const lastSentCountRef = React.useRef<number>(0)

    const updateAggregatedUnreadCount = () => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)

        const total = Object.values(unreadCountsRef.current).reduce((sum, count) => sum + count, 0)

        if (total > lastSentCountRef.current) {
            // Increase: send immediately so badge appears without delay
            lastSentCountRef.current = total
            window.electron.ipcRenderer.send('unread-count', total)
        } else if (total < lastSentCountRef.current) {
            // Decrease: debounce with longer timeout to avoid flicker
            // (Facebook briefly resets the title during re-renders)
            debounceTimerRef.current = setTimeout(() => {
                const finalTotal = Object.values(unreadCountsRef.current).reduce((sum, count) => sum + count, 0)
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

        // Listen for notification click — switch to messenger tab
        const removeNotifClickListener = window.electron.ipcRenderer.on('notification-clicked', () => {
            console.log('[NOTIF] Notification clicked — switching to messenger tab')
            handleTabSwitch('messenger')
        })

        return () => { removeListener?.(); removeForceListener?.(); removeNotifClickListener?.() }
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

    // Refs for webviews (using a map)
    const webviewRefs = React.useRef<{ [key: string]: any }>({})

    // Refs for event handlers so removeEventListener works with the exact same reference
    const handlersRef = React.useRef<Map<string, { newWindow: any; willNavigate: any; domReady: any; ipcMessage: any }>>(new Map())

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
                icon: '📦',
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
                el.removeEventListener('ipc-message', oldHandlers.ipcMessage)
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

                    // JS-based chat killer — catches elements where Facebook sets styles via JS
                    // (not as inline style attributes), which CSS attribute selectors can't target
                    try {
                        const chatKillerScript = `
                            (function() {
                                function killChats() {
                                    // Kill by aria-label
                                    var chatLabels = ['Close chat','Minimize chat','Open chat','Chat tab',
                                        'Chat conversation','Messenger overlay','Chats','New message','New Message'];
                                    chatLabels.forEach(function(label) {
                                        document.querySelectorAll('[aria-label="' + label + '"]').forEach(function(el) {
                                            var r = el.getAttribute('role') || '';
                                            if (r !== 'main' && r !== 'navigation') {
                                                // Walk up to find the top-level chat container
                                                var target = el.closest('[role="dialog"]') || el.closest('[role="region"]');
                                                if (!target) {
                                                    var p = el;
                                                    for (var d = 0; p && d < 20; d++) {
                                                        var cs = window.getComputedStyle(p);
                                                        if (cs.position === 'fixed' || cs.position === 'absolute') {
                                                            target = p;
                                                            break;
                                                        }
                                                        p = p.parentElement;
                                                    }
                                                }
                                                if (target) {
                                                    target.style.display = 'none';
                                                    target.remove();
                                                } else {
                                                    el.style.display = 'none';
                                                    el.remove();
                                                }
                                            }
                                        });
                                    });

                                    // Kill fixed-position elements at bottom-right (chat dock area)
                                    var divs = document.getElementsByTagName('div');
                                    var wh = window.innerHeight;
                                    var ww = window.innerWidth;
                                    for (var i = 0; i < divs.length; i++) {
                                        var el = divs[i];
                                        if (el.style.display === 'none') continue;
                                        var cs = window.getComputedStyle(el);
                                        if (cs.position !== 'fixed') continue;
                                        var rect = el.getBoundingClientRect();
                                        if (rect.bottom > wh - 50 && rect.right > ww - 500 && rect.height < 600 && rect.width < 500) {
                                            var hasChat = el.querySelector('[contenteditable], textarea, input, [aria-label*="chat"], [aria-label*="Chat"], [aria-label*="message"], [aria-label*="Message"]');
                                            if (hasChat) {
                                                el.style.display = 'none';
                                                el.remove();
                                            }
                                        }
                                    }
                                }
                                // Run immediately and then periodically
                                killChats();
                                setInterval(killChats, 2000);
                            })();
                        `;
                        el.executeJavaScript(chatKillerScript);
                    } catch (e) { }
                }
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

                    // Check if notifications are disabled in renderer-side settings
                    if (!settingsRef.current.notifications) {
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ⏭️ Notifications disabled in settings`, 'color: #F59E0B')
                        return
                    }

                    // Only show notifications from messenger and marketplace tabs
                    if (tab.type !== 'messenger' && tab.type !== 'marketplace') {
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED: tab type is '${tab.type}' (not messenger/marketplace)`, 'color: #EF4444')
                        return
                    }

                    // --- STRICT FILTERING: Block by default, only allow real chat messages ---

                    // Layer 1: Source URL — must originate from /messages path
                    if (tab.type === 'messenger') {
                        const path = sourcePathname || ''
                        if (!path.startsWith('/messages')) {
                            if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED Layer 1: source path '${path}' doesn't start with /messages`, 'color: #EF4444')
                            return
                        }
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ✅ Layer 1 passed: source path OK`, 'color: #22C55E')
                    }

                    // Layer 2: Must have BOTH title AND body
                    // Real message notifications = sender name (title) + message preview (body)
                    // Most generic Facebook notifications lack a body or have title-only
                    if (!title || !options.body) {
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED Layer 2: missing title or body (title=${!!title}, body=${!!options.body})`, 'color: #EF4444')
                        return
                    }
                    if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ✅ Layer 2 passed: has title and body`, 'color: #22C55E')

                    // Layer 3: Title length — sender names are short, action descriptions are long
                    if (title.length > 50) {
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED Layer 3: title too long (${title.length} chars)`, 'color: #EF4444')
                        return
                    }
                    if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ✅ Layer 3 passed: title length OK (${title.length})`, 'color: #22C55E')

                    const titleLower = title.toLowerCase()
                    const bodyLower = (options.body || '').toLowerCase()
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
                        'message request', 'new request', 'pending request'
                    ]
                    const matchedBlock = blockPatterns.find(p => combined.includes(p))
                    if (matchedBlock) {
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED Layer 4: blocklist match '${matchedBlock}'`, 'color: #EF4444', '\n  Combined:', combined)
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
                    // OR body is very short (< 100 chars, likely a chat message preview with no keywords)
                    if (!isMessengerTag && !matchesMessagePattern && bodyLower.length > 100) {
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED Layer 5: no messenger tag, no message pattern, body too long (${bodyLower.length})`, 'color: #EF4444')
                        return
                    }
                    if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ✅ Layer 5 passed: ${isMessengerTag ? 'messenger tag' : matchesMessagePattern ? `pattern '${matchedPattern}'` : `short body (${bodyLower.length})`}`, 'color: #22C55E')

                    // Final safety: if body contains action verbs that indicate FB activity, block it
                    const actionVerbs = [
                        'commented', 'replied to a', 'reacted', 'liked', 'shared',
                        'tagged', 'mentioned', 'invited', 'posted', 'suggested',
                        'followed', 'is following'
                    ]
                    const matchedVerb = actionVerbs.find(v => bodyLower.includes(v))
                    if (matchedVerb && !matchesMessagePattern) {
                        if (dbg) console.log(`%c[NOTIF-FILTER] ${debugId} ❌ BLOCKED Final: action verb '${matchedVerb}' without message pattern`, 'color: #EF4444')
                        return
                    }

                    if (dbg) console.log(
                        `%c[NOTIF-FILTER] ${debugId} ✅✅✅ NOTIFICATION ALLOWED — sending to main process`,
                        'background: #22C55E; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
                        '\n  Title:', title,
                        '\n  Body:', options.body
                    )

                    window.electron.ipcRenderer.send('show-notification', {
                        title,
                        body: options.body,
                        icon: options.icon || undefined
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
                }
            }

            // Add new handlers and store references for future cleanup
            el.addEventListener('new-window', handleNewWindow)
            el.addEventListener('will-navigate', handleWillNavigate)
            el.addEventListener('dom-ready', handleDomReady)
            el.addEventListener('ipc-message', handleIpcMessage)
            handlersRef.current.set(tab.id, { newWindow: handleNewWindow, willNavigate: handleWillNavigate, domReady: handleDomReady, ipcMessage: handleIpcMessage })
        })

        // Cleanup: remove handlers for tabs that no longer exist
        return () => {
            const currentTabIds = new Set(tabs.map(t => t.id))
            handlersRef.current.forEach((handlers, tabId) => {
                if (!currentTabIds.has(tabId)) {
                    const el = webviewRefs.current[tabId]
                    if (el) {
                        el.removeEventListener('new-window', handlers.newWindow)
                        el.removeEventListener('will-navigate', handlers.willNavigate)
                        el.removeEventListener('dom-ready', handlers.domReady)
                        el.removeEventListener('ipc-message', handlers.ipcMessage)
                    }
                    handlersRef.current.delete(tabId)
                }
            })
        }
    }, [tabs, webviewPreloadPath])

    // Automated Unsave Injection for Saved Tab
    useEffect(() => {
        if (!appSettings.unsaveButton) return

        const el = webviewRefs.current['saved'];

        // Hide Chat Dock on Saved Page
        if (el && activeTabId === 'saved') {
            try { el.insertCSS(facebookChromeCSS); } catch (e) { }

            const injectUnsave = `
            (function() {
                // We use a recurring check because MutationObserver sometimes misses deep nested changes 
                // effectively or the page re-renders significantly.
                // But we still use observer for efficiency, supplemented by interval.
                
                const injectButtons = () => {
                     // Target only the main content area to avoid sidebar clutter
                     const mainContent = document.querySelector('[role="main"]');
                     if (!mainContent) return;

                     // Look for the "More" buttons (three dots) specifically within saved item cards
                     // We try to be specific to the "Saved items" list to avoid navigation/header buttons
                     const candidates = Array.from(mainContent.querySelectorAll('[aria-label="Collection options"], [aria-label="More"], [aria-label="Actions needed"]'));
                     
                     candidates.forEach(trigger => {
                        // 1. Avoid Header/Navigation buttons
                        if (trigger.closest('[role="banner"]') || trigger.closest('[role="navigation"]')) return;
                        
                        // 2. Specific check: Is this likely a Saved Item card?
                        // Saved items usually have an image and description nearby.
                        // We filter out the "My collections" sidebar list by checking container width or context
                        const card = trigger.closest('[role="article"]') || trigger.closest('div[style*="border-radius"]');
                        if (!card) return;
                        
                        // Heuristic: Sidebar items are usually small/narrow. Main feed items are wider.
                        // This prevents buttons appearing on the left sidebar "My collections" list
                        if (card.clientWidth < 300) return; 

                        // 3. Find the container to inject into (the "More" button's wrapper)
                        const container = trigger.parentElement;
                        if (!container || container.querySelector('.custom-unsave-btn')) return;
                        
                        // 4. Create and Style Button
                        // We place it to the LEFT of the three dots to avoid covering content
                        const btn = document.createElement('button');
                        btn.innerText = 'Unsave';
                        btn.className = 'custom-unsave-btn';
                        Object.assign(btn.style, {
                           // Position relative to the button wrapper
                           position: 'absolute', 
                           right: '100%', // Push to the left of the container
                           top: '50%',
                           transform: 'translateY(-50%)', // Vertically center
                           marginRight: '8px',
                           zIndex: '999',
                           whiteSpace: 'nowrap',
                           backgroundColor: '#DC2626', 
                           color: 'white', 
                           border: '1px solid rgba(255,255,255,0.2)', 
                           borderRadius: '6px',
                           padding: '6px 10px', 
                           fontSize: '13px', 
                           cursor: 'pointer', 
                           fontWeight: '600',
                           boxShadow: '0 2px 4px rgba(0,0,0,0.15)'
                        });

                        // Ensure parent is relative for absolute positioning
                        if (getComputedStyle(container).position === 'static') {
                            container.style.position = 'relative';
                            // Allow button to overflow out of the small button wrapper
                            container.style.overflow = 'visible'; 
                        }
                        
                        btn.onclick = async (e) => {
                            e.preventDefault(); e.stopPropagation();
                            btn.innerText = '...';
                            try {
                                trigger.click();
                                await new Promise(r => setTimeout(r, 500));
                                
                                // Menu items
                                const menuItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], div[role="button"]'));
                                const unsaveOption = menuItems.find(el => {
                                    const t = el.innerText.toLowerCase();
                                    return t.includes('unsave') || t.includes('remove') || t.includes('delete');
                                });
                                
                                if(unsaveOption) {
                                    unsaveOption.click();
                                    btn.innerText = 'Done';
                                    btn.style.backgroundColor = 'green';
                                    if(card) {
                                       card.style.opacity = '0.3';
                                       card.style.pointerEvents = 'none';
                                       card.style.transition = 'opacity 0.3s';
                                    }
                                } else {
                                     trigger.click(); // close menu
                                     btn.innerText = '?';
                                }
                            } catch(err) {
                                btn.innerText = 'Err';
                            }
                        };
                        
                        container.appendChild(btn);
                     });
                };

                // Run frequently
                setInterval(injectButtons, 2000);
                injectButtons();
            })();
            `;
            try {
                el.executeJavaScript(injectUnsave);
            } catch (e) { }
        }
    }, [activeTabId, webviewRefs.current['saved']])

    return (
        <div className="app-container">
            <aside className="sidebar">
                <div className="sidebar-drag-region"></div>
                <nav>
                    {/* Persistent Back Button Area */}
                    <div className="nav-item-wrapper">
                        <button
                            className="nav-btn"
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
                                    handleTabSwitch('marketplace')
                                }
                            }}
                            title="Go Back"
                            style={{
                                visibility: activeTabId !== 'messenger' ? 'visible' : 'hidden'
                            }}
                        >
                            ◀
                        </button>
                    </div>

                    {tabs.map(tab => (
                        <div key={tab.id} className="nav-item-wrapper">
                            <button
                                className={`nav-btn ${activeTabId === tab.id ? 'active' : ''}`}
                                onClick={() => handleTabSwitch(tab.id)}
                                title={tab.type}
                            >
                                {tab.icon}
                            </button>
                            {tab.type === 'marketplace-item' && (
                                <div
                                    className="close-btn"
                                    onClick={(e) => closeTab(e, tab.id)}
                                >×</div>
                            )}
                        </div>
                    ))}

                    <div className="spacer" style={{ flex: 1 }}></div>

                    {/* Settings button pinned to bottom */}
                    <div className="nav-item-wrapper">
                        <button
                            className={`nav-btn ${showSettings ? 'active' : ''}`}
                            onClick={() => setShowSettings(!showSettings)}
                            title="Settings"
                        >
                            ⚙️
                        </button>
                    </div>
                </nav>
            </aside>
            <main className="content">
                {/* Settings Overlay */}
                <Settings
                    visible={showSettings}
                    onClose={() => setShowSettings(false)}
                    settings={appSettings}
                    onSettingsChange={setAppSettings}
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
                {!webviewPreloadPath ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'white' }}>
                        Loading...
                    </div>
                ) : (
                    tabs.map(tab => (
                        tab.hasBeenVisited && (
                            <webview
                                key={tab.id}
                                ref={el => { webviewRefs.current[tab.id] = el }}
                                src={tab.url}
                                className={`webview ${activeTabId === tab.id ? 'visible' : 'hidden'}`}
                                useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                                allowpopups={true}
                                preload={webviewPreloadPath}
                                partition="persist:webview"
                            ></webview>

                        )
                    ))
                )}
            </main>
        </div>
    )
}

export default App
