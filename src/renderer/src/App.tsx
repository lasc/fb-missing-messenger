import React, { useState, useEffect } from 'react'

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
            { id: 'messenger', type: 'messenger', url: 'https://www.messenger.com/', icon: '💬' },
            { id: 'marketplace', type: 'marketplace', url: 'https://www.facebook.com/marketplace/', icon: '🏪' },
            { id: 'saved', type: 'saved', url: 'https://www.facebook.com/saved/', icon: '🔖' }
        ]
        // Mark the initially active tab as visited
        return initialTabs.map(t => t.id === 'messenger' ? { ...t, hasBeenVisited: true, lastVisited: Date.now() } : t)
    })
    const [activeTabId, setActiveTabId] = useState<string>('messenger')
    const [webviewPreloadPath, setWebviewPreloadPath] = useState<string>('')

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
    }, [])

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

    // Base CSS to hide Chat Bubbles and Floating elements
    const baseHideCSS = `
        div.mw227v9j span, 
        div[class*="x1n2onr6"][style*="bottom"][style*="right"],
        div[style*="position: fixed"][style*="bottom"][style*="right"],
        div[style*="position: absolute"][style*="bottom"][style*="right"],
        div[data-pagelet="Dock"], 
        div[data-pagelet="ChatTab"],
        div[role="complementary"] iframe
        { 
            display: none !important; 
            opacity: 0 !important; 
            pointer-events: none !important; 
            visibility: hidden !important;
            z-index: -9999 !important;
        }
    `

    // Aggressive CSS for Non-Messenger tabs
    const facebookChromeCSS = `
        .fbDockWrapper, .fbDock, .fbNub, 
        [role="banner"],
        div[role="banner"],
        div[data-pagelet="BlueBar"],
        nav[role="navigation"],
        [aria-label="New message"], 
        [aria-label="New Message"],
        [aria-label="Compose message"],
        [aria-label="Create"],
        [aria-label="Messenger"],
        [aria-label="Chat settings"],
        [aria-label="Facebook Marketplace Assistant"],
        div[aria-label="New message"],
        div[role="button"][aria-label="New message"],
        div[role="button"][aria-label="Messenger"],
        div[role="button"][aria-label="Create"],
        div[role="link"][aria-label="Create new listing"],
        div[data-pagelet="Dock"],
        div[data-pagelet="ChatTab"],
        div[data-testid="mw_chat_tab_container"],
        div[data-testid="mw_chat_tabs_container"],
        div.mw227v9j,
        div.fbDockWrapper,
        div.fbDock,
        div[style*="position: fixed"][style*="bottom: 0"][style*="right: 0"],
        div[class*="x1n2onr6"][style*="right: 0px"],
        div[role="navigation"].x9f619
        { 
            display: none !important; 
            opacity: 0 !important; 
            pointer-events: none !important; 
            visibility: hidden !important;
            height: 0 !important;
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
                if (lowerUrl.includes('/marketplace/item/') ||
                    lowerUrl.includes('/item/') ||
                    lowerUrl.includes('/marketplace/listing/') ||
                    lowerUrl.includes('marketplace_item_id')) {
                    e.preventDefault()
                    openMarketplaceItem(url)
                    return
                }

                if (url.includes('facebook.com') || url.includes('messenger.com') || url.includes('fb.com')) {
                    return
                }

                if (url.startsWith('http://') || url.startsWith('https://')) {
                    e.preventDefault()
                    window.electron.ipcRenderer.send('open-external-url', url)
                }
            }

            const handleDomReady = () => {
                try {
                    el.insertCSS(baseHideCSS);
                } catch (e) { }

                if (tab.type !== 'messenger') {
                    try {
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
                }
            }

            const handleIpcMessage = (e: any) => {
                if (e.channel === 'webview-notification') {
                    const { title, options } = e.args[0]

                    // Only show notifications from messenger and marketplace tabs
                    if (tab.type !== 'messenger' && tab.type !== 'marketplace') return

                    // Skip "new requests" / "message requests" notifications
                    const text = `${title} ${options.body || ''}`.toLowerCase()
                    if (text.includes('message request') || text.includes('new request')) return

                    window.electron.ipcRenderer.send('show-notification', {
                        title,
                        body: options.body
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
                        if (lower.includes('marketplace') || lower.includes('/item/')) {
                            openMarketplaceItem(url)
                        } else {
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
                </nav>
            </aside>
            <main className="content">
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
                            ></webview>

                        )
                    ))
                )}
            </main>
        </div>
    )
}

export default App
