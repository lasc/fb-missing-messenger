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
    lastUnreadCount = count
    ipcRenderer.sendToHost('unread-count', count)
  }
}

// Observe title changes
const titleObserver = new MutationObserver(updateUnreadCount)
const titleElement = document.querySelector('title')
if (titleElement) {
  titleObserver.observe(titleElement, { childList: true, characterData: true, subtree: true })
} else {
  // Fallback if title element is not yet available
  setInterval(updateUnreadCount, 2000)
}

// UI Cleanup for Non-Messenger Pages (Marketplace, generic FB)
if (!window.location.hostname.includes('messenger.com')) {
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
              label === 'Chats' || 
              label === 'New message'
          )) {
              removeElement(el)
              return
          }

          // Heuristic 3: Role Complementary (often the chat sidebar)
          if (role === 'complementary') {
              removeElement(el)
              return
          }

          // Heuristic 4: Specific Data Pagelets (Chat Tabs)
          const pagelet = el.getAttribute('data-pagelet')
          if (pagelet === 'ChatTab' || pagelet === 'Dock') {
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
      const closeButtons = document.querySelectorAll('[aria-label="Close chat"], [aria-label="Minimize chat"]')
      closeButtons.forEach(btn => {
          const container = btn.closest('[role="dialog"]') || btn.closest('[role="region"]') || btn.closest('.fbNub') || btn.closest('div[style*="position: fixed"]')
          if (container) removeElement(container)
      })

      // B. Geometric + Computed Style Scan
      const allDivs = document.getElementsByTagName('div')
      const winHeight = window.innerHeight
      const winWidth = window.innerWidth
      
      for (let i = 0; i < allDivs.length; i++) {
        const el = allDivs[i] as HTMLElement
        
        if (el.style.display === 'none' || el.childElementCount === 0) continue
        
        const rect = el.getBoundingClientRect()
        if (rect.bottom < winHeight - 300 || rect.right < winWidth - 450) continue
        if (rect.width > 500 || rect.height > 600) continue
        if (rect.width < 50 || rect.height < 50) continue

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
  }, 3000)
}

// 5. Global Link Interceptor - Handle all link clicks
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  
  // Find the closest anchor element
  const anchor = target.closest('a') as HTMLAnchorElement
  if (!anchor || !anchor.href) return
  
  const url = anchor.href
  const lowerUrl = url.toLowerCase()
  
  // Skip javascript: and # links
  if (url.startsWith('javascript:') || url.startsWith('#') || url === '') return
  
  // Handle marketplace item links - open in app
  if (lowerUrl.includes('/marketplace/item/') ||
      lowerUrl.includes('/marketplace/listing/') ||
      lowerUrl.includes('marketplace_item_id') ||
      lowerUrl.includes('referral_code=marketplace')) {
      e.preventDefault()
      e.stopPropagation()
      ipcRenderer.sendToHost('open-link', url)
      return
  }
  
  // Allow Facebook/Messenger internal navigation
  if (lowerUrl.includes('facebook.com') || 
      lowerUrl.includes('messenger.com') || 
      lowerUrl.includes('fb.com') ||
      lowerUrl.includes('fbcdn.net')) {
      return // Let normal navigation happen
  }
  
  // All other external links - open in default browser
  if (url.startsWith('http://') || url.startsWith('https://')) {
      e.preventDefault()
      e.stopPropagation()
      ipcRenderer.sendToHost('open-external', url)
  }
}, true)
