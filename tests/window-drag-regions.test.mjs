import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDirectory, '..')

test('rendered shell provides broad drag regions without consuming navigation clicks', () => {
    const build = spawnSync('npm', ['run', 'build'], {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 30_000
    })
    assert.equal(build.status, 0, build.stderr || build.stdout)

    const electron = path.join(projectRoot, 'node_modules/.bin/electron')
    const harness = path.join(testDirectory, 'fixtures/drag-region-harness.cjs')
    const run = spawnSync(electron, [harness], {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 30_000,
        env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    })
    assert.equal(run.status, 0, run.stderr || run.stdout)

    const resultLine = run.stdout.split('\n').find(line => line.startsWith('DRAG_REGION_RESULT:'))
    assert.ok(resultLine, `Missing drag-region result:\n${run.stdout}\n${run.stderr}`)
    const result = JSON.parse(resultLine.slice('DRAG_REGION_RESULT:'.length))

    assert.equal(result.sidebar.appRegion, 'drag')
    assert.equal(result.navigationButton.appRegion, 'no-drag')
    assert.ok(result.topDragRegion, 'The rendered shell needs a top drag region')
    assert.equal(result.topDragRegion.appRegion, 'drag')
    assert.equal(result.topDragRegion.top, 0)
    assert.equal(result.topDragRegion.left, result.sidebar.right)
    assert.equal(result.topDragRegion.right, result.viewportWidth)
    assert.ok(result.topDragRegion.height >= 48)
})
