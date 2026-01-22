import React, { useState, useEffect } from 'react'

// Tab definitions
type TabType = 'messenger' | 'marketplace' | 'saved' | 'marketplace-item'
interface Tab {
    id: string
    type: TabType
    url: string
    title?: string
    icon?: string
}

function App(): React.ReactElement {
    const [tabs, setTabs] = useState<Tab[]>([
        { id: 'messenger', type: 'messenger', url: 'https://www.messenger.com/', icon: '💬' },
        { id: 'marketplace', type: 'marketplace', url: 'https://www.facebook.com/marketplace/', icon: '🏪' },
        { id: 'saved', type: 'saved', url: 'https://www.facebook.com/saved/', icon: '🔖' }
    ])
    const [activeTabId, setActiveTabId] = useState<string>('messenger')
    const [webviewPreloadPath, setWebviewPreloadPath] = useState<string>('')

    // Unread count aggregation
    const unreadCountsRef = React.useRef<{ [tabId: string]: number }>({})
    const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null)

    const updateAggregatedUnreadCount = () => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)

        debounceTimerRef.current = setTimeout(() => {
            const total = Object.values(unreadCountsRef.current).reduce((sum, count) => sum + count, 0)
            console.log('DYAD: Aggregated unread count:', total, unreadCountsRef.current)
            window.electron.ipcRenderer.send('unread-count', total)
        }, 500) // 500ms debounce to filter title blinking
    }

    // Fetch webview preload path
    useEffect(() => {
        window.electron.ipcRenderer.invoke('get-webview-preload-path').then(path => {
            console.log('DYAD: Webview preload path received:', path)
            // Convert to file:// URL if it's an absolute path
            const fileUrl = path.startsWith('/') ? `file://${path}` : path
            setWebviewPreloadPath(fileUrl)
        })
    }, [])

    // Refs for webviews (using a map)
    const webviewRefs = React.useRef<{ [key: string]: any }>({})

    // Function to open new marketplace item
    const openMarketplaceItem = (url: string) => {
        // basic normalization to avoid duplicates
        const cleanUrl = url.replace(/\/$/, '')

        // Check if tab already exists
        const existingTab = tabs.find(t => t.url.replace(/\/$/, '') === cleanUrl)

        if (existingTab) {
            console.log('DYAD: Tab already exists, switching to:', existingTab.id)
            setActiveTabId(existingTab.id)
            return
        }

        const id = `item-${Date.now()}`
        setTabs(prev => [...prev, {
            id,
            type: 'marketplace-item',
            url,
            icon: '📦' // New Package Icon
        }])
        setActiveTabId(id)
    }

    // Function to close tab
    const closeTab = (e: React.MouseEvent, id: string) => {
        e.stopPropagation()
        setTabs(prev => prev.filter(t => t.id !== id))
        if (activeTabId === id) {
            setActiveTabId('messenger')
        }
    }

    // Base CSS to hide Chat Bubbles and Floating elements that might appear on any FB property
    const baseHideCSS = `
        /* Floating Chat Heads / Bubbles / Bottom Right Containers */
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

    // Aggressive CSS for Non-Messenger tabs (Marketplace, Saved) to hide the main FB Chrome
    const facebookChromeCSS = `
        .fbDockWrapper, .fbDock, .fbNub, 
        /* Top Navigation Bar / Banner */
        [role="banner"],
        div[role="banner"],
        div[data-pagelet="BlueBar"],
        nav[role="navigation"],
        /* Bottom Right Floating Buttons (Messenger & Create) */
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
        /* Generic floating containers at bottom right */
        div[style*="position: fixed"][style*="bottom: 0"][style*="right: 0"],
        div[class*="x1n2onr6"][style*="right: 0px"],
        /* Sidebar Navigation often present on Marketplace */
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

    // Attach events manually for all webviews
    useEffect(() => {
        tabs.forEach(tab => {
            const el = webviewRefs.current[tab.id]
            if (!el) return


            // 2. New Window Handling (Marketplace Interception & Custom Protocols & External Links)
            const handleNewWindow = (e: any) => {
                const url = e.url
                console.log('DYAD: New Window Requested:', url)
                e.preventDefault()



                // Open marketplace items in a new tab within the app
                // Broadened check for various marketplace URL formats
                const lowerUrl = url.toLowerCase()
                if (lowerUrl.includes('/marketplace/item/') ||
                    lowerUrl.includes('/item/') ||
                    lowerUrl.includes('/marketplace/listing/') ||
                    lowerUrl.includes('marketplace_item_id') ||
                    lowerUrl.includes('referral_code=marketplace')) {
                    openMarketplaceItem(url)
                    return
                }

                // Open all other external links in the default browser
                if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                    window.electron.ipcRenderer.send('open-external-url', url)
                }
            }
            el.removeEventListener('new-window', handleNewWindow)
            el.addEventListener('new-window', handleNewWindow)

            // 3. Handle navigation to external links - open in default browser
            const handleWillNavigate = (e: any) => {
                const url = e.url
                console.log('DYAD: Will Navigate:', url)
                if (!url) return

                // Check for marketplace items even during navigation
                const lowerUrl = url.toLowerCase()
                if (lowerUrl.includes('/marketplace/item/') ||
                    lowerUrl.includes('/item/') ||
                    lowerUrl.includes('/marketplace/listing/') ||
                    lowerUrl.includes('marketplace_item_id')) {
                    e.preventDefault()
                    openMarketplaceItem(url)
                    return
                }

                // Allow navigation within Facebook/Messenger domains for other things (like switching chats)
                if (url.includes('facebook.com') || url.includes('messenger.com') || url.includes('fb.com')) {
                    return // Allow normal navigation
                }

                // Open external links in default browser
                if (url.startsWith('http://') || url.startsWith('https://')) {
                    e.preventDefault()
                    window.electron.ipcRenderer.send('open-external-url', url)
                }
            }
            el.removeEventListener('will-navigate', handleWillNavigate)
            el.addEventListener('will-navigate', handleWillNavigate)

            // 4. DOM Ready Handler - Inject CSS and cleanup scripts
            const handleDomReady = () => {
                console.log('DOM Ready for tab:', tab.id, tab.type)

                // Inject base hiding CSS for ALL tabs to be safe
                try {
                    el.insertCSS(baseHideCSS);
                } catch (e) {
                    console.error('Base CSS injection failed:', e);
                }

                // If non-messenger, inject additional chrome-hiding CSS
                if (tab.type !== 'messenger') {
                    try {
                        // Also inject cover overlay for header via script (Preload handles the rest)
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
                    } catch (e) {
                        console.error('Chrome CSS injection failed:', e);
                    }
                }
            }

            // Remove previous listener to avoid duplicates
            el.removeEventListener('dom-ready', handleDomReady)
            el.addEventListener('dom-ready', handleDomReady)

            // Also attach console message listener
            el.addEventListener('console-message', (e: any) => {
                console.log(`[${tab.id}]:`, e.message)
            })

            // Handle IPC notifications from webview
            const handleIpcMessage = (e: any) => {
                console.log('DYAD: IPC Message from webview:', e.channel, e.args)
                if (e.channel === 'webview-notification') {
                    const { title, options } = e.args[0]
                    window.electron.ipcRenderer.send('show-notification', {
                        title,
                        body: options.body
                    })
                } else if (e.channel === 'unread-count') {
                    const count = e.args[0]
                    unreadCountsRef.current[tab.id] = count
                    updateAggregatedUnreadCount()
                } else if (e.channel === 'open-link') {
                    const url = e.args[0]
                    console.log('DYAD: Explicit open-link requested:', url)
                    if (url) {
                        const lower = url.toLowerCase()
                        if (lower.includes('marketplace') || lower.includes('/item/')) {
                            openMarketplaceItem(url)
                        } else {
                            window.electron.ipcRenderer.send('open-external-url', url)
                        }
                    }
                }
            }
            el.removeEventListener('ipc-message', handleIpcMessage)
            el.addEventListener('ipc-message', handleIpcMessage)
        })
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
                    <div className="nav-item-wrapper" style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                        <button
                            className="nav-btn"
                            onClick={() => {
                                const wv = webviewRefs.current[activeTabId]
                                if (wv && wv.canGoBack()) wv.goBack()
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
                        <div key={tab.id} className="nav-item-wrapper" style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
                            <button
                                className={`nav-btn ${activeTabId === tab.id ? 'active' : ''}`}
                                onClick={() => setActiveTabId(tab.id)}
                                title={tab.type}
                            >
                                {tab.icon}
                            </button>
                            {tab.type === 'marketplace-item' && (
                                <div
                                    className="close-btn"
                                    onClick={(e) => closeTab(e, tab.id)}
                                    style={{
                                        position: 'absolute', top: -5, right: 5,
                                        cursor: 'pointer', background: 'red', borderRadius: '50%',
                                        width: 12, height: 12, fontSize: 8, display: 'flex',
                                        alignItems: 'center', justifyContent: 'center', color: 'white'
                                    }}
                                >x</div>
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
                        <webview
                            key={tab.id}
                            ref={el => { webviewRefs.current[tab.id] = el }}
                            src={tab.url}
                            className={`webview ${activeTabId === tab.id ? 'visible' : 'hidden'}`}
                            useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                            allowpopups={true}
                            preload={webviewPreloadPath}
                        ></webview>
                    ))
                )}
            </main>
        </div >
    )
}

export default App
