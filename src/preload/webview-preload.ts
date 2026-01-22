import { ipcRenderer } from 'electron'

// Override Notification API
const NativeNotification = window.Notification

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
    console.log('DYAD: Notification Intercepted:', title, options)
    
    // Send to host page (App.tsx)
    ipcRenderer.sendToHost('webview-notification', {
      title,
      options: {
        body: options?.body,
        icon: options?.icon,
        tag: options?.tag,
        data: options?.data
      }
    })
  }

  close() {
    // Optional: handle close
  }
}

// Unread count tracking via Title
let lastUnreadCount = -1
const updateUnreadCount = () => {
  const title = document.title
  const match = title.match(/\((\d+)\)/)
  const count = match ? parseInt(match[1], 10) : 0
  
  if (count !== lastUnreadCount) {
    console.log('DYAD: Unread count changed:', count, 'Title:', title)
    lastUnreadCount = count
    ipcRenderer.sendToHost('unread-count', count)
  }
}

// Observe title changes
const titleObserver = new MutationObserver(updateUnreadCount)
const titleElement = document.querySelector('title')
if (titleElement) {
  titleObserver.observe(titleElement, { childList: true, characterData: true, subtree: true })
  console.log('DYAD: Title observer attached')
} else {
  // Fallback if title element is not yet available
  console.log('DYAD: Title element not found, using interval fallback')
  setInterval(updateUnreadCount, 2000)
}

console.log('DYAD: Webview notification & unread tracking version 2.0')

// UI Cleanup for Non-Messenger Pages (Marketplace, generic FB)
// We check for messenger.com to skip this logic there.
// We DO NOT check for specific 'facebook.com' hostnames because redirects/local versions might vary.
if (!window.location.hostname.includes('messenger.com')) {
  console.log('DYAD: Enable aggressive UI cleanup (MutationObserver)')

  // 1. Static CSS Injection (Immediate visual hide)
  const hideCSS = `
    [role="complementary"], 
    [aria-label="Facebook Marketplace Assistant"],
    [aria-label="New message"],
    [aria-label="Chats"],
    .fbDockWrapper, 
    .fbDock,
    div[class*="x1n2onr6"][style*="bottom"][style*="right"],
    div[style*="position: fixed"][style*="bottom"][style*="right"] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        opacity: 0 !important;
        z-index: -9999 !important;
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
  const removeElement = (el: Element, reason: string) => {
      console.log(`DYAD: Removing element (${reason}):`, el)
      if (el instanceof HTMLElement) {
          el.style.display = 'none' // Hide immediately before removal
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
          // We look for small floating divs, not large containers, to avoid killing the page
          if (el.innerText && el.innerText.includes('Marketplace Assistant')) {
              removeElement(el, 'Text: Marketplace Assistant')
              return
          }

          // Heuristic 2: Aria Labels
          const label = el.getAttribute('aria-label')
          if (label && (
              label.includes('Facebook Marketplace Assistant') || 
              label === 'Chats' || 
              label === 'New message'
          )) {
              removeElement(el, `Aria: ${label}`)
              return
          }

          // Heuristic 3: Role Complementary (often the chat sidebar)
          if (role === 'complementary') {
              removeElement(el, 'Role: complementary')
              return
          }

          // Heuristic 4: Specific Data Pagelets (Chat Tabs)
          const pagelet = el.getAttribute('data-pagelet')
          if (pagelet === 'ChatTab' || pagelet === 'Dock') {
              removeElement(el, `Data-Pagelet: ${pagelet}`)
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
  // Sometimes MutationObserver misses things or they are pre-rendered.
  setInterval(() => {
      // A. Look for "Close chat" buttons and kill their container
      const closeButtons = document.querySelectorAll('[aria-label="Close chat"], [aria-label="Minimize chat"]')
      closeButtons.forEach(btn => {
          // Find the floating container (usually a few levels up)
          const container = btn.closest('[role="dialog"]') || btn.closest('[role="region"]') || btn.closest('.fbNub') || btn.closest('div[style*="position: fixed"]')
          if (container) removeElement(container, 'Interval: Close Button Found')
      })

      // B. Geometric + Computed Style Scan (The Nuclear Option)
      // We iterate ALL divs to find anything fixed in the bottom right.
      // Optimisation: use getElementsByTagName which is faster than querySelectorAll for live collections
      const allDivs = document.getElementsByTagName('div') as HTMLCollectionOf<HTMLElement>
      
      // We limit check to invalidating persistent floaters
      for (let i = 0; i < allDivs.length; i++) {
        const el = allDivs[i]
        
        // Quick visual checks before expensive computed style
        if (el.style.display === 'none') continue
        
        // Check geometry first (cheap)
        const rect = el.getBoundingClientRect()
        // Must be in bottom-right quadrant
        if (rect.bottom < window.innerHeight - 300 || rect.right < window.innerWidth - 450) continue
        
        // Must be small enough (not the entire page wrapper)
        if (rect.width > 500 || rect.height > 600) continue
        if (rect.width < 50 || rect.height < 50) continue // Too small (icon?)

        // Check if it's fixed position (expensive)
        const style = window.getComputedStyle(el)
        if (style.position === 'fixed' || style.position === 'sticky') {
            // Check z-index to ensure it's on top? Not strictly necessary but implies overlay.
             
             // Content Heuristics to confirm it's a chat
             // - Has an input?
             // - Has typical chat keywords in text?
             // - Close button inside?
             const hasInput = el.querySelector('input, textarea, [contenteditable="true"]')
             const hasClose = el.querySelector('[aria-label*="Close"], [aria-label*="Minimize"]')
             
             if (hasInput || hasClose || el.innerText.length > 0) {
                 // Final safety: ensure it's not a banner/navigation
                 const role = el.getAttribute('role') || ''
                 if (role !== 'banner' && role !== 'navigation') {
                     removeElement(el, 'Nuclear Scan: Fixed/Sticky Bottom-Right Element')
                 }
             }
        }
      }
  }, 1000)
}

// 5. Global Link Interceptor (Rescue "View listing" clicks)
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  
  // Check if we clicked "View listing" or similar call to action
  // We check the target and its parents
  const btn = target.closest('[role="button"], a, button')
  if (btn) {
      const text = (btn as HTMLElement).innerText || ''
      
      // Check for specific "View listing" text
      if (text.includes('View listing') || text.includes('View item')) {
          console.log('DYAD: Clicked "View listing" button:', btn)
          
          // Try to find a URL
          let url = (btn as HTMLAnchorElement).href
          
          // If no href, look for a nested or parent anchor
          if (!url) {
            const anchor = btn.closest('a') || btn.querySelector('a')
            if (anchor) url = anchor.href
          }

          // If still no URL, we might need to parse it from attributes or just let it fail naturally
          // But often these are <a> tags styled as buttons
          if (url) {
             console.log('DYAD: Intercepted explicit navigation to:', url)
             e.preventDefault()
             e.stopPropagation()
             ipcRenderer.sendToHost('open-link', url)
          }
      }
  }
}, true) // Capture phase to ensure we get it first

