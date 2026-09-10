import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(new URL('../src/renderer/src/assets/index.css', import.meta.url), 'utf8')

function declarationsFor(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
    assert.ok(match, `Missing ${selector} rule`)
    return match[1]
}

test('tab switches keep every webview full-size and skip reveal animation', () => {
    const base = declarationsFor('.webview')
    const hidden = declarationsFor('.webview.hidden')
    const visible = declarationsFor('.webview.visible')

    assert.match(base, /position:\s*absolute/)
    assert.match(base, /inset:\s*0/)
    assert.doesNotMatch(hidden, /-9999px|width:\s*1px|height:\s*1px|position:\s*fixed/)
    assert.doesNotMatch(visible, /animation\s*:/)
})
