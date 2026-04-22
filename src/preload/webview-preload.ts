import { ipcRenderer } from 'electron'

// Override Notification API
// @ts-ignore
window.Notification = class extends EventTarget {
  static requestPermission(callback?: (permission: NotificationPermission) => void) {
    if (callback) callback('granted')
    return Promise.resolve('granted' as NotificationPermission)
  }

  static get permission() {
    return 'granted'
  }

  constructor(title: string, options?: NotificationOptions) {
    super()
    
    const payload = {
      title,
      options: {
        body: options?.body,
        icon: options?.icon,
        tag: options?.tag,
        data: options?.data
      },
      sourceUrl: window.location.href,
      sourcePathname: window.location.pathname
    }

    // 🔍 DEBUG: Log every notification Facebook fires at the source
    console.log(
      '%c[NOTIF-PRELOAD] 🔔 Notification intercepted',
      'background: #FF6B00; color: white; padding: 2px 6px; border-radius: 3px;',
      '\n  Title:', title,
      '\n  Body:', options?.body || '(none)',
      '\n  Tag:', options?.tag || '(none)',
      '\n  Icon:', options?.icon ? '(has icon)' : '(no icon)',
      '\n  Data:', options?.data || '(none)',
      '\n  Source URL:', window.location.href,
      '\n  Source Path:', window.location.pathname
    )

    // Send to host page (App.tsx) with source context for filtering
    ipcRenderer.sendToHost('webview-notification', payload)
  }

  close() {
    // Optional: handle close
  }
}

// Unread count tracking
let lastUnreadCount = -1

const isMessengerPage = window.location.hostname.includes('messenger.com') ||
  (window.location.hostname.includes('facebook.com') && window.location.pathname.startsWith('/messages')) ||
  (window.location.hostname.includes('fb.com') && window.location.pathname.startsWith('/messages'))

const isOldMessenger = window.location.hostname.includes('messenger.com')

const updateUnreadCount = () => {
  let count = 0
  let source = 'unknown'

  if (isOldMessenger) {
    // Old messenger.com: title (N) is reliable for message count
    const title = document.title
    const match = title.match(/\((\d+)\)/)
    count = match ? parseInt(match[1], 10) : 0
    source = `old-messenger title="${title}"`
  } else if (isMessengerPage) {
    // facebook.com/messages: title (N) includes ALL FB notifications.
    // Instead, count unread indicators in the chat list.
    // Facebook marks unread chats with a bold/unread indicator dot or bold text.
    const unreadDots = document.querySelectorAll(
      '[data-testid="mwthreadlist-item"] [data-visualcompletion="ignore"] span[style*="background"],' +
      '[aria-label*="unread"]'
    )
    // Also try the Messenger-specific navigation badge if available
    const messengerBadge = document.querySelector(
      '[aria-label="Chats"] [data-visualcompletion="ignore"] span,' +
      'a[href="/messages/"] span[data-visualcompletion="ignore"]'
    )
    if (messengerBadge && messengerBadge.textContent) {
      const badgeNum = parseInt(messengerBadge.textContent.trim(), 10)
      if (!isNaN(badgeNum)) {
        count = badgeNum
        source = `messenger-badge text="${messengerBadge.textContent.trim()}"`
      }
    } else if (unreadDots.length > 0) {
      count = unreadDots.length
      source = `unread-dots count=${unreadDots.length}`
    } else {
      // Last resort: check the page title, but this may overcount
      const title = document.title
      const match = title.match(/\((\d+)\)/)
      count = match ? parseInt(match[1], 10) : 0
      source = `title-fallback title="${title}"`
    }
  } else {
    // Marketplace/Saved: title-based count is fine
    const title = document.title
    const match = title.match(/\((\d+)\)/)
    count = match ? parseInt(match[1], 10) : 0
    source = `other-page title="${title}"`
  }

  if (count !== lastUnreadCount) {
    console.log(
      `%c[UNREAD] 📊 Count changed: ${lastUnreadCount} → ${count}`,
      'background: #7C3AED; color: white; padding: 2px 6px; border-radius: 3px;',
      `\n  Source: ${source}`,
      `\n  Page: ${window.location.pathname}`
    )
    lastUnreadCount = count
    ipcRenderer.sendToHost('unread-count', count)
  }
}

// Observe title changes and DOM mutations for unread tracking
if (isMessengerPage && !isOldMessenger) {
  // For facebook.com/messages, poll since the unread indicators are deep in the DOM
  console.log('[UNREAD] 📡 Starting 3s polling for facebook.com/messages unread count')
  setInterval(updateUnreadCount, 3000)
} else {
  const titleObserver = new MutationObserver(updateUnreadCount)
  const titleElement = document.querySelector('title')
  if (titleElement) {
    console.log('[UNREAD] 👁️ Observing <title> element for changes')
    titleObserver.observe(titleElement, { childList: true, characterData: true, subtree: true })
  } else {
    console.log('[UNREAD] ⚠️ No <title> element found, falling back to 2s polling')
    setInterval(updateUnreadCount, 2000)
  }
}

// UI Cleanup for Non-Messenger Pages (Marketplace, generic FB)
const isMessenger = window.location.hostname.includes('messenger.com') ||
  (window.location.hostname.includes('facebook.com') && window.location.pathname.startsWith('/messages')) ||
  (window.location.hostname.includes('fb.com') && window.location.pathname.startsWith('/messages'))
if (!isMessenger) {
  // 1. Static CSS Injection (Immediate visual hide)
  const hideCSS = `
    [role="complementary"], 
    [aria-label="Facebook Marketplace Assistant"],
    [aria-label="New message"],
    [aria-label="New Message"],
    [aria-label="Chats"],
    [aria-label="Contacts"],
    [aria-label="Active contacts"],
    [aria-label="Messenger overlay"],
    [aria-label="Chat tab"],
    [aria-label="Chat conversation"],
    [aria-label="Close chat"],
    [aria-label="Minimize chat"],
    [aria-label="Open chat"],
    .fbDockWrapper, 
    .fbDock,
    .fbNub,
    div[data-pagelet="RightRail"],
    div[data-pagelet="BuddyListPaglet"],
    div[data-pagelet="ContactList"],
    div[data-pagelet="Dock"],
    div[data-pagelet="ChatTab"],
    div[data-testid="mw_chat_tab_container"],
    div[data-testid="mw_chat_tabs_container"],
    div[data-testid="messenger_dock"],
    div[class*="x1n2onr6"][style*="bottom"][style*="right"],
    div[style*="position: fixed"][style*="bottom"][style*="right"],
    div[style*="position: fixed"][style*="bottom: 0"],
    div[role="dialog"][style*="position: fixed"],
    div.mw227v9j {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        opacity: 0 !important;
        z-index: -9999 !important;
        width: 0 !important;
        height: 0 !important;
        max-height: 0 !important;
        overflow: hidden !important;
    }
  `
  const style = document.createElement('style')
  style.textContent = hideCSS
  
  if (document.head) {
      document.head.appendChild(style)
  } else {
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style))
  }

  // 2. DOM Removal Helper
  const removeElement = (el: Element) => {
      if (el instanceof HTMLElement) {
          el.style.display = 'none'
      }
      el.remove()
  }

  // 3. MutationObserver for Dynamic Content
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement
          
          // Safety: Don't remove main content
          const role = el.getAttribute('role')
          if (role === 'main' || role === 'navigation' || role === 'banner') return

          // Heuristic 1: Text Content (Marketplace Assistant)
          if (el.innerText && el.innerText.includes('Marketplace Assistant')) {
              removeElement(el)
              return
          }

          // Heuristic 2: Aria Labels
          const label = el.getAttribute('aria-label')
          if (label && (
              label.includes('Facebook Marketplace Assistant') || 
              label.includes('Messenger overlay') ||
              label.includes('Chat tab') ||
              label.includes('Chat conversation') ||
              label.includes('Close chat') ||
              label.includes('Minimize chat') ||
              label.includes('Open chat') ||
              label === 'Chats' || 
              label === 'New message' ||
              label === 'New Message'
          )) {
              removeElement(el)
              return
          }

          // Heuristic 3: Role Complementary (often the chat sidebar)
          if (role === 'complementary') {
              removeElement(el)
              return
          }

          // Heuristic 3b: Dialog role with fixed positioning (chat popups)
          if (role === 'dialog') {
              const style = window.getComputedStyle(el)
              if (style.position === 'fixed') {
                  removeElement(el)
                  return
              }
          }

          // Heuristic 4: Specific Data Pagelets (Chat Tabs)
          const pagelet = el.getAttribute('data-pagelet')
          if (pagelet === 'ChatTab' || pagelet === 'Dock') {
              removeElement(el)
              return
          }

          // Heuristic 5: Data-testid for chat containers
          const testid = el.getAttribute('data-testid')
          if (testid && (
              testid === 'mw_chat_tab_container' ||
              testid === 'mw_chat_tabs_container' ||
              testid === 'messenger_dock' ||
              testid === 'Messenger'
          )) {
              removeElement(el)
              return
          }
        }
      })
    }
  })

  // Start observing
  if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true })
  } else {
      document.addEventListener('DOMContentLoaded', () => {
          observer.observe(document.body, { childList: true, subtree: true })
      })
  }

  // 4. "Scorched Earth" Interval Check (Geometric & Content)
  setInterval(() => {
      // A. Look for "Close chat" buttons and kill their container
      const closeButtons = document.querySelectorAll('[aria-label="Close chat"], [aria-label="Minimize chat"], [aria-label="Open chat"]')
      closeButtons.forEach(btn => {
          // Walk up to find the chat window container
          let container = btn.closest('[role="dialog"]') || btn.closest('[role="region"]') || btn.closest('.fbNub') || btn.closest('div[style*="position: fixed"]')
          if (container) {
              removeElement(container)
          } else {
              // Try walking up the tree manually to find a fixed-position ancestor
              let parent = btn.parentElement
              for (let depth = 0; parent && depth < 15; depth++) {
                  const ps = window.getComputedStyle(parent)
                  if (ps.position === 'fixed') {
                      removeElement(parent)
                      break
                  }
                  parent = parent.parentElement
              }
          }
      })

      // B. Targeted chat element removal by aria-label and data-testid
      const chatSelectors = [
          '[aria-label="Messenger"]',
          '[aria-label="Messenger overlay"]',
          '[aria-label="Chats"]',
          '[aria-label="New message"]',
          '[aria-label="New Message"]',
          '[aria-label="Start a new chat"]',
          '[aria-label="Chat tab"]',
          '[aria-label="Chat conversation"]',
          '[data-testid="mw_chat_tab_container"]',
          '[data-testid="mw_chat_tabs_container"]',
          '[data-testid="Messenger"]',
          '[data-testid="messenger_dock"]',
          '[data-pagelet="Dock"]',
          '[data-pagelet="ChatTab"]'
      ]
      chatSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
              const role = el.getAttribute('role') || ''
              if (role !== 'main' && role !== 'navigation') {
                  removeElement(el)
              }
          })
      })

      // C. Geometric + Computed Style Scan
      const allDivs = document.getElementsByTagName('div')
      const winHeight = window.innerHeight
      const winWidth = window.innerWidth
      
      for (let i = 0; i < allDivs.length; i++) {
        const el = allDivs[i] as HTMLElement
        
        if (el.style.display === 'none' || el.childElementCount === 0) continue
        
        const rect = el.getBoundingClientRect()
        if (rect.bottom < winHeight - 300 || rect.right < winWidth - 450) continue
        if (rect.width > 500 || rect.height > 600) continue
        if (rect.width < 20 || rect.height < 20) continue

        const style = window.getComputedStyle(el)
        if (style.position === 'fixed' || style.position === 'sticky') {
             const hasInput = el.querySelector('input, textarea, [contenteditable="true"]')
             const hasClose = el.querySelector('[aria-label*="Close"], [aria-label*="Minimize"]')
             
             if (hasInput || hasClose || el.innerText.length > 0) {
                 const role = el.getAttribute('role') || ''
                 if (role !== 'banner' && role !== 'navigation') {
                     removeElement(el)
                 }
             }
        }
      }

      // D. Nuclear option: find ANY fixed/absolute element at bottom-right with chat-like characteristics
      // (avatar images, message text, input fields anchored to bottom-right corner)
      const bottomElements = document.querySelectorAll(
          'div[style*="position: fixed"][style*="bottom"],' +
          'div[style*="position: absolute"][style*="bottom"]'
      )
      bottomElements.forEach(el => {
          const htmlEl = el as HTMLElement
          const rect = htmlEl.getBoundingClientRect()
          // Only target elements positioned in bottom-right quadrant
          if (rect.bottom > winHeight - 100 && rect.right > winWidth - 500) {
              const role = htmlEl.getAttribute('role') || ''
              if (role !== 'main' && role !== 'navigation' && role !== 'banner') {
                  // Check if it looks like a chat (has images/avatars, input, or message-like content)
                  const hasAvatar = htmlEl.querySelector('img[src*="scontent"], image, svg')
                  const hasInput = htmlEl.querySelector('input, textarea, [contenteditable]')
                  const hasChatUI = htmlEl.querySelector('[aria-label*="chat"], [aria-label*="Chat"], [aria-label*="message"], [aria-label*="Message"]')
                  if (hasAvatar || hasInput || hasChatUI) {
                      removeElement(htmlEl)
                  }
              }
          }
      })
  }, 2000)
}

// 5. Global Link Interceptor - Handle all link clicks
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement

  // Skip clicks on our injected zoom buttons — they handle their own IPC
  if (target.closest('.img-zoom-btn-wrapper') || target.getAttribute('data-zoom')) return

  // Find the closest anchor element
  const anchor = target.closest('a') as HTMLAnchorElement
  if (!anchor || !anchor.href) return

  const url = anchor.href
  const lowerUrl = url.toLowerCase()

  // Skip javascript: and # links
  if (url.startsWith('javascript:') || url.startsWith('#') || url === '') return

  // Handle marketplace item links - open in app tab
  if (lowerUrl.includes('/marketplace/item/') ||
      lowerUrl.includes('/marketplace/listing/') ||
      lowerUrl.includes('marketplace_item_id') ||
      lowerUrl.includes('referral_code=marketplace')) {
      e.preventDefault()
      e.stopPropagation()
      ipcRenderer.sendToHost('open-link', url)
      return
  }
  
  // Allow core Messenger navigation to stay in-app
  if ((lowerUrl.includes('messenger.com') && !lowerUrl.includes('l.messenger.com')) ||
      (lowerUrl.includes('facebook.com') && (lowerUrl.includes('/messages') || lowerUrl.includes('/messenger_media'))) ||
      (lowerUrl.includes('fb.com') && (lowerUrl.includes('/messages') || lowerUrl.includes('/messenger_media')))) {
      return
  }

  // Allow marketplace & saved internal navigation to stay in-app
  if ((lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.com')) &&
      (lowerUrl.includes('/marketplace') || lowerUrl.includes('/saved'))) {
      return
  }

  // All other Facebook links (groups, reels, profiles, events) and messenger redirect links -> external browser
  if (lowerUrl.includes('facebook.com') || 
      lowerUrl.includes('l.messenger.com') ||
      lowerUrl.includes('fb.com') ||
      lowerUrl.includes('fbcdn.net')) {
      e.preventDefault()
      e.stopPropagation()
      ipcRenderer.sendToHost('open-external', url)
      return
  }
  
  // All other external links - open in default browser
  if (url.startsWith('http://') || url.startsWith('https://')) {
      e.preventDefault()
      e.stopPropagation()
      ipcRenderer.sendToHost('open-external', url)
  }
}, true)

// 6. Image Zoom — Marketplace & Marketplace Item pages only
const isMarketplacePage = window.location.hostname.includes('facebook.com') &&
  (window.location.pathname.startsWith('/marketplace') ||
   window.location.pathname.includes('/marketplace/item/'))

if (isMarketplacePage) {

  // Inject CSS for the magnifier button (done once on load)
  const zoomCSS = `
    .img-zoom-btn-wrapper {
      position: absolute !important;
      top: 6px !important;
      right: 6px !important;
      z-index: 9999 !important;
      pointer-events: auto !important;
    }

    .img-zoom-btn {
      width: 32px !important;
      height: 32px !important;
      border-radius: 50% !important;
      background: rgba(0, 0, 0, 0.65) !important;
      backdrop-filter: blur(4px) !important;
      border: 1.5px solid rgba(255,255,255,0.25) !important;
      color: white !important;
      font-size: 15px !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      opacity: 0 !important;
      transition: opacity 0.18s ease, transform 0.15s ease, background 0.15s !important;
      pointer-events: auto !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.35) !important;
      line-height: 1 !important;
      padding: 0 !important;
    }

    .img-zoom-btn:hover {
      background: rgba(8, 102, 255, 0.85) !important;
      transform: scale(1.1) !important;
    }

    .img-zoom-parent:hover .img-zoom-btn,
    .img-zoom-parent.img-zoom-hover .img-zoom-btn {
      opacity: 1 !important;
    }

    .img-zoom-parent {
      position: relative !important;
    }
  `

  const styleEl = document.createElement('style')
  styleEl.textContent = zoomCSS
  const injectStyle = () => document.head?.appendChild(styleEl)
  if (document.head) injectStyle()
  else document.addEventListener('DOMContentLoaded', injectStyle)

  // Track which images we've already processed to avoid duplicates
  const processedImages = new WeakSet<HTMLImageElement>()

  function attachZoomButton(img: HTMLImageElement) {
    if (processedImages.has(img)) return
    const src = img.src || img.getAttribute('src') || ''
    // Only target Facebook CDN images (scontent) of reasonable size
    if (!src.includes('scontent') && !src.includes('fbcdn')) return
    if (img.naturalWidth < 100 && img.width < 100) return  // skip tiny icons
    // Skip avatars / profile pictures (they're usually circular small images)
    if (src.includes('profile')) return

    processedImages.add(img)

    // Wrap image in a relative-positioned parent if needed
    const parent = img.parentElement
    if (!parent) return

    // Make sure parent can hold an absolute child
    parent.classList.add('img-zoom-parent')

    // Create wrapper + button
    const wrapper = document.createElement('div')
    wrapper.className = 'img-zoom-btn-wrapper'

    const btn = document.createElement('button')
    btn.className = 'img-zoom-btn'
    btn.title = 'View full size'
    btn.innerHTML = '&#128269;'  // 🔍
    btn.setAttribute('data-zoom', '1')

    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()

      // Collect all CDN images from the same listing card/container
      const container = img.closest('[role="article"], [role="main"], [data-visualcompletion], a[href*="marketplace"]')
        || img.parentElement?.parentElement?.parentElement  // fallback: walk up 3 levels
        || document.body

      const siblingImgs = Array.from(
        container.querySelectorAll<HTMLImageElement>('img[src*="scontent"], img[src*="fbcdn"]')
      ).filter(i => {
        const s = i.src || ''
        if (s.includes('profile')) return false
        if (i.naturalWidth < 80 && i.width < 80) return false
        return true
      })

      // Deduplicate by src
      const seen = new Set<string>()
      const urls: string[] = []
      siblingImgs.forEach(i => {
        const src = i.currentSrc || i.src
        if (!seen.has(src)) { seen.add(src); urls.push(src) }
      })

      const currentSrc = img.currentSrc || img.src
      let index = urls.indexOf(currentSrc)
      if (index === -1) { urls.unshift(currentSrc); index = 0 }

      ipcRenderer.sendToHost('open-image-zoom', { images: urls, index })
    })

    wrapper.appendChild(btn)
    parent.appendChild(wrapper)
  }

  // Scan for marketplace images and attach zoom buttons
  function scanImages() {
    const imgs = document.querySelectorAll<HTMLImageElement>(
      'img[src*="scontent"], img[src*="fbcdn"]'
    )
    imgs.forEach(attachZoomButton)
  }

  // Initial scan + periodic rescan (FB lazy-loads images)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scanImages()
      setInterval(scanImages, 2000)
    })
  } else {
    scanImages()
    setInterval(scanImages, 2000)
  }

  // Also scan on DOM mutations (new listing cards added)
  const zoomObserver = new MutationObserver(() => scanImages())
  const startObserver = () => {
    const main = document.querySelector('[role="main"]') || document.body
    if (main) zoomObserver.observe(main, { childList: true, subtree: true })
  }
  if (document.body) startObserver()
  else document.addEventListener('DOMContentLoaded', startObserver)
}
