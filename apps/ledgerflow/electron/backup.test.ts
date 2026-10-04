import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createAutoBackup } from './backup.ts'

const day = 86_400_000
const start = Date.parse('2026-10-01T09:00:00Z')

function setup(empty = false) {
  const dir = join(mkdtempSync(join(tmpdir(), 'aicom-backup-')), 'backups')
  let clock = start
  const backup = createAutoBackup({ dir, exportData: () => ({ format: 'aicom-data', at: clock }), isEmpty: () => empty, keep: 3, now: () => clock })
  return { dir, backup, advance: (ms: number) => { clock += ms } }
}

test('one copy a day at most, readable as a data file', () => {
  const { dir, backup, advance } = setup()
  const first = backup.run()
  assert.ok(first)
  assert.deepEqual(JSON.parse(readFileSync(first, 'utf8')), { format: 'aicom-data', at: start })
  advance(5 * 3_600_000)
  assert.equal(backup.run(), undefined)
  advance(day)
  assert.ok(backup.run())
  assert.equal(readdirSync(dir).length, 2)
})

test('only the most recent copies are kept', () => {
  const { dir, backup, advance } = setup()
  for (let index = 0; index < 5; index += 1) {
    backup.run()
    advance(day)
  }
  const files = readdirSync(dir).sort()
  assert.equal(files.length, 3)
  assert.match(files[0], /^auto-2026-10-03T09-00-00-000Z\.json$/)
})

test('an empty data space is not backed up', () => {
  const { dir, backup } = setup(true)
  assert.equal(backup.run(), undefined)
  assert.deepEqual(backup.list(), [])
  assert.throws(() => readdirSync(dir))
})
