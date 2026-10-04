import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export type AutoBackupOptions = {
  dir: string
  /** The full data file, as written by an export. */
  exportData(): unknown
  isEmpty(): boolean
  /** How many automatic copies are kept; older ones are removed. */
  keep?: number
  intervalMs?: number
  now?: () => number
}

const prefix = 'auto-'
const stamp = (time: number) => new Date(time).toISOString().replace(/[:.]/g, '-')
const parse = (name: string) => Date.parse(name.slice(prefix.length, -'.json'.length).replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, 'T$1:$2:$3.$4Z'))

/**
 * Daily copies of the data on this PC, for installs that work without Google Drive (and so without its revision history).
 * Restored through "Import a backup", like a manual one.
 */
export function createAutoBackup({ dir, exportData, isEmpty, keep = 30, intervalMs = 86_400_000, now = Date.now }: AutoBackupOptions) {
  const existing = () => {
    try {
      return readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith('.json') && !Number.isNaN(parse(name))).sort()
    } catch {
      return []
    }
  }

  return {
    /** Writes a copy when the last one is older than the interval. Returns the file written, if any. */
    run(): string | undefined {
      if (isEmpty()) return undefined
      const files = existing()
      const last = files.at(-1)
      if (last && now() - parse(last) < intervalMs) return undefined
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `${prefix}${stamp(now())}.json`)
      // Written under a temporary name first: a crash mid-write never leaves a truncated copy that looks valid.
      writeFileSync(`${file}.tmp`, JSON.stringify(exportData()))
      renameSync(`${file}.tmp`, file)
      for (const old of [...files, basename(file)].slice(0, -keep)) rmSync(join(dir, old), { force: true })
      return file
    },
    list: existing,
  }
}
