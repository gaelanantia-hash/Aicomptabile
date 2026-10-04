import { createHash, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { GoogleEndpoints } from '../oauth.ts'

type FakeFile = { id: string; name: string; mimeType: string; appProperties: Record<string, string>; trashed: boolean; revisions: { id: string; content: string; modifiedTime: string }[] }

/** In-memory stand-in for Google's sign-in and Drive endpoints, for automated tests. Implements only what the app calls. */
export async function startFakeGoogle() {
  const files = new Map<string, FakeFile>()
  const refreshTokens = new Map<string, { sub: string; email: string }>()
  const accessTokens = new Set<string>()
  const codes = new Map<string, { challenge: string; redirectUri: string }>()
  const options = { quotaExceeded: false, insufficientScopes: false, account: { sub: 'sub-1', email: 'cliente@example.com' }, onUpload: undefined as (() => void) | undefined }

  const body = (request: IncomingMessage) => new Promise<string>((resolve) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk)).on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
  const json = (response: ServerResponse, status: number, payload: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(payload))
  }
  const describe = (file: FakeFile) => {
    const head = file.revisions.at(-1)
    return { id: file.id, name: file.name, mimeType: file.mimeType, headRevisionId: head?.id, modifiedTime: head?.modifiedTime, appProperties: file.appProperties, trashed: file.trashed }
  }
  const parseMultipart = (request: IncomingMessage, raw: string) => {
    const boundary = /boundary=(.+)$/.exec(request.headers['content-type'] ?? '')?.[1]
    const parts = raw.split(`--${boundary}`).slice(1, -1).map((part) => part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''))
    return { metadata: JSON.parse(parts[0]) as { name?: string; mimeType?: string; appProperties?: Record<string, string> }, content: parts[1] }
  }
  const addRevision = (file: FakeFile, content: string) => file.revisions.push({ id: randomUUID(), content, modifiedTime: new Date().toISOString() })

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const path = url.pathname
      const raw = await body(request)

      if (path === '/auth') {
        const code = randomUUID()
        codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', redirectUri: url.searchParams.get('redirect_uri') ?? '' })
        response.writeHead(302, { Location: `${url.searchParams.get('redirect_uri')}?${new URLSearchParams({ code, state: url.searchParams.get('state') ?? '' })}` }).end()
        return
      }
      if (path === '/token') {
        const form = new URLSearchParams(raw)
        const access = randomUUID()
        if (form.get('grant_type') === 'authorization_code') {
          const pending = codes.get(form.get('code') ?? '')
          const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url')
          if (!pending || pending.challenge !== challenge || pending.redirectUri !== form.get('redirect_uri')) return json(response, 400, { error: 'invalid_grant' })
          codes.delete(form.get('code') ?? '')
          const refresh = randomUUID()
          refreshTokens.set(refresh, options.account)
          accessTokens.add(access)
          const idToken = `x.${Buffer.from(JSON.stringify(options.account)).toString('base64url')}.x`
          return json(response, 200, { access_token: access, expires_in: 3600, refresh_token: refresh, id_token: idToken })
        }
        if (!refreshTokens.has(form.get('refresh_token') ?? '')) return json(response, 400, { error: 'invalid_grant' })
        accessTokens.add(access)
        return json(response, 200, { access_token: access, expires_in: 3600 })
      }
      if (path === '/revoke') {
        refreshTokens.delete(new URLSearchParams(raw).get('token') ?? '')
        return json(response, 200, {})
      }

      if (!accessTokens.has((request.headers.authorization ?? '').replace('Bearer ', ''))) return json(response, 401, { error: { message: 'Invalid credentials' } })
      if (options.insufficientScopes && (path.startsWith('/drive/v3/files') || path.startsWith('/upload/drive/v3/files'))) {
        return json(response, 403, { error: { message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] } })
      }

      if (path === '/drive/v3/about') return json(response, 200, { storageQuota: { limit: '16106127360', usage: '1024' } })
      if (path === '/drive/v3/files' && request.method === 'GET') {
        const query = url.searchParams.get('q') ?? ''
        const name = /name = '([^']+)'/.exec(query)?.[1]
        const folder = /mimeType = 'application\/vnd\.google-apps\.folder'/.test(query)
        const matches = [...files.values()].filter((file) => !file.trashed && file.name === name && (file.mimeType === 'application/vnd.google-apps.folder') === folder)
        return json(response, 200, { files: matches.map(describe) })
      }
      if (path === '/drive/v3/files' && request.method === 'POST') {
        const metadata = JSON.parse(raw) as { name: string; mimeType: string }
        const file: FakeFile = { id: randomUUID(), name: metadata.name, mimeType: metadata.mimeType, appProperties: {}, trashed: false, revisions: [] }
        files.set(file.id, file)
        return json(response, 200, describe(file))
      }
      if (path.startsWith('/upload/')) options.onUpload?.()
      if (path === '/upload/drive/v3/files' && request.method === 'POST') {
        if (options.quotaExceeded) return json(response, 403, { error: { message: 'The user has exceeded their Drive storage quota', errors: [{ reason: 'storageQuotaExceeded' }] } })
        const { metadata, content } = parseMultipart(request, raw)
        const file: FakeFile = { id: randomUUID(), name: metadata.name ?? '', mimeType: metadata.mimeType ?? '', appProperties: metadata.appProperties ?? {}, trashed: false, revisions: [] }
        addRevision(file, content)
        files.set(file.id, file)
        return json(response, 200, describe(file))
      }

      const [, uploadId] = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path) ?? []
      const [, fileId, revisionPath, revisionId] = /^\/drive\/v3\/files\/([^/]+)(\/revisions(?:\/([^/]+))?)?$/.exec(path) ?? []
      const file = files.get(uploadId ?? fileId ?? '')
      if (!file) return json(response, 404, { error: { message: 'File not found', errors: [{ reason: 'notFound' }] } })

      if (uploadId) {
        if (options.quotaExceeded) return json(response, 403, { error: { message: 'The user has exceeded their Drive storage quota', errors: [{ reason: 'storageQuotaExceeded' }] } })
        const { metadata, content } = parseMultipart(request, raw)
        Object.assign(file.appProperties, metadata.appProperties)
        addRevision(file, content)
        return json(response, 200, describe(file))
      }
      if (revisionPath && !revisionId) return json(response, 200, { revisions: file.revisions.map((revision) => ({ id: revision.id, modifiedTime: revision.modifiedTime, size: String(revision.content.length) })) })
      if (request.method === 'PATCH') {
        Object.assign(file.appProperties, (JSON.parse(raw) as { appProperties?: Record<string, string> }).appProperties)
        return json(response, 200, describe(file))
      }
      if (url.searchParams.get('alt') === 'media') {
        const revision = revisionId ? file.revisions.find((item) => item.id === revisionId) : file.revisions.at(-1)
        if (!revision) return json(response, 404, { error: { message: 'Revision not found' } })
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(revision.content)
        return
      }
      return json(response, 200, describe(file))
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const endpoints: GoogleEndpoints = { auth: `${origin}/auth`, token: `${origin}/token`, revoke: `${origin}/revoke`, api: `${origin}/drive/v3`, upload: `${origin}/upload/drive/v3` }

  return {
    endpoints,
    files,
    options,
    /** Signs an account in without going through the browser step. */
    grant(account = options.account) {
      const refresh = randomUUID()
      refreshTokens.set(refresh, account)
      return refresh
    },
    revokeAll() {
      refreshTokens.clear()
      accessTokens.clear()
    },
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    }),
  }
}
