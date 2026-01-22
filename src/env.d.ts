/// <reference types="vite/client" />
/// <reference types="electron" />


declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        send: (channel: string, ...args: any[]) => void
        on: (channel: string, func: (...args: any[]) => void) => () => void
        once: (channel: string, func: (...args: any[]) => void) => void
        invoke: (channel: string, ...args: any[]) => Promise<any>
      }
    }
    api: any
  }
}

export {}

declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string
      useragent?: string
      allowpopups?: string | boolean
      preload?: string
      onNewWindow?: (e: any) => void
      onDomReady?: (e: any) => void
    }
  }
}

