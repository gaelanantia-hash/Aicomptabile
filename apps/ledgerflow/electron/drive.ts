import { promisify } from 'node:util'
import { gunzip, gzip } from 'node:zlib'
import type { Revision } from '../src/desktopApi.ts'
import type { GoogleEndpoints } from './oauth.ts'

export const DATA_FILE = 'aicom-data.json'
export const DATA_FOLDER = 'AICOM'

export type DriveFile = { id: string; headRevisionId?: string; modifiedTime?: string; appProperties?: Record<string, string> }
export type Drive = ReturnType<typeof createDrive>

export class DriveError extends Error {
  status: number
  reason: string
  constructor(status: number, reason: string, message: string) {
    super(message)
    this.name = 'DriveError'
    this.status = status
    this.reason = reason
  }
}

const fileFields = 'id,headRevisionId,modifiedTime,appProperties'
const DATA_TYPE = 'application/gzip'

/** The data file travels gzip-compressed: accounting JSON shrinks several times over, which matters on slow connections. */
export async function encodeData(content: string) {
  return promisify(gzip)(content, { level: 9 })
}

/** Reads both the compressed format and the plain JSON written by earlier versions (older Drive revisions included). */
export async function decodeData(bytes: Buffer) {
  const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b
  return (compressed ? await promisify(gunzip)(bytes) : bytes).toString('utf8')
}

/** Google Drive client limited to what the `drive.file` scope allows: the folder and file this app created. */
export function createDrive(endpoints: GoogleEndpoints, getToken: (refresh?: boolean) => Promise<string>) {
  async function request(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${await getToken(!retry)}`)
    const response = await fetch(url, { ...init, headers })
    if (response.status === 401 && retry) return request(url, init, false)
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string; errors?: { reason?: string }[] } }
      throw new DriveError(response.status, payload.error?.errors?.[0]?.reason ?? '', payload.error?.message ?? `Google Drive request failed (${response.status}).`)
    }
    return response
  }

  async function json<T>(url: string, init?: RequestInit) {
    return await (await request(url, init)).json() as T
  }

  async function multipart(metadata: object, content: string) {
    const boundary = `aicom${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    const head = [`--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(metadata), `--${boundary}`, `Content-Type: ${DATA_TYPE}`, '', ''].join('\r\n')
    const body = Buffer.concat([Buffer.from(head), await encodeData(content), Buffer.from(`\r\n--${boundary}--\r\n`)])
    return { body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } }
  }

  async function find(name: string, mimeType?: string) {
    const query = [`name = '${name}'`, 'trashed = false', mimeType ? `mimeType = '${mimeType}'` : `mimeType != 'application/vnd.google-apps.folder'`].join(' and ')
    const list = await json<{ files: DriveFile[] }>(`${endpoints.api}/files?${new URLSearchParams({ q: query, spaces: 'drive', fields: `files(${fileFields})`, orderBy: 'modifiedTime desc' })}`)
    return list.files[0]
  }

  return {
    findDataFile: () => find(DATA_FILE),

    async getFile(id: string) {
      try {
        return await json<DriveFile & { trashed?: boolean }>(`${endpoints.api}/files/${id}?fields=${fileFields},trashed`).then((file) => file.trashed ? undefined : file)
      } catch (error) {
        if (error instanceof DriveError && error.status === 404) return undefined
        throw error
      }
    },

    async createDataFile(content: string, appProperties: Record<string, string>) {
      const folderType = 'application/vnd.google-apps.folder'
      const folder = await find(DATA_FOLDER, folderType)
        ?? await json<DriveFile>(`${endpoints.api}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: DATA_FOLDER, mimeType: folderType }) })
      const upload = await multipart({ name: DATA_FILE, parents: [folder.id], mimeType: DATA_TYPE, appProperties }, content)
      return json<DriveFile>(`${endpoints.upload}/files?uploadType=multipart&fields=${fileFields}`, { method: 'POST', ...upload })
    },

    async updateDataFile(id: string, content: string, appProperties: Record<string, string>) {
      const upload = await multipart({ mimeType: DATA_TYPE, appProperties }, content)
      return json<DriveFile>(`${endpoints.upload}/files/${id}?uploadType=multipart&fields=${fileFields}`, { method: 'PATCH', ...upload })
    },

    /** Metadata only: does not create a new revision of the data. */
    setProperties(id: string, appProperties: Record<string, string>) {
      return json<DriveFile>(`${endpoints.api}/files/${id}?fields=${fileFields}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appProperties }) })
    },

    async download(id: string, revision?: string) {
      const path = revision ? `${id}/revisions/${revision}` : id
      return decodeData(Buffer.from(await (await request(`${endpoints.api}/files/${path}?alt=media`)).arrayBuffer()))
    },

    async listRevisions(id: string) {
      const list = await json<{ revisions?: Revision[] }>(`${endpoints.api}/files/${id}/revisions?fields=revisions(id,modifiedTime,size)&pageSize=200`)
      return (list.revisions ?? []).reverse()
    },

    async quota() {
      const about = await json<{ storageQuota?: { limit?: string; usage?: string } }>(`${endpoints.api}/about?fields=storageQuota`)
      return { limit: about.storageQuota?.limit ? Number(about.storageQuota.limit) : undefined, usage: about.storageQuota?.usage ? Number(about.storageQuota.usage) : undefined }
    },
  }
}
