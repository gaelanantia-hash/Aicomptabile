import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Storage } from '@google-cloud/storage'
import { Pool, type PoolClient } from 'pg'

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
if (!projectId) throw new Error('FIREBASE_PROJECT_ID or GCLOUD_PROJECT is required.')
if (!process.env.DOCUMENTS_BUCKET) throw new Error('DOCUMENTS_BUCKET is required.')

const firebaseApp = getApps()[0] ?? initializeApp({
  credential: applicationDefault(),
  projectId,
})
const firebaseAuth = getAuth(firebaseApp)
const storage = new Storage({ projectId })
const bucket = storage.bucket(process.env.DOCUMENTS_BUCKET)
const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

const app = express()
app.disable('x-powered-by')
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}))
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }))
app.use(express.json({ limit: '100kb', strict: true }))

type Role = 'owner' | 'admin' | 'accountant' | 'viewer'
type WorkspaceMembership = { role: Role }
type CloudRequest = Request & { userId?: string }
type WorkspaceRow = { id: string; name: string; storage_quota_bytes: string; storage_used_bytes: string; storage_reserved_bytes: string }

const allowedQuotaGiB = new Set([10, 50, 200])
const allowedCurrencies = new Set(['EUR', 'USD', 'GBP', 'CHF', 'CAD'])
const maximumPdfBytes = 20 * 1024 * 1024
const maximumXmlBytes = 5 * 1024 * 1024
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function userId(request: Request): string {
  return (request as CloudRequest).userId ?? ''
}

function requireUser(request: Request, response: Response, next: NextFunction) {
  const token = request.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
  if (!token) {
    response.status(401).json({ error: 'Authentication required.' })
    return
  }

  void firebaseAuth.verifyIdToken(token, true).then((decoded) => {
    if (!decoded.email_verified) {
      response.status(403).json({ error: 'Verify your email address before accessing AICOM.' })
      return
    }
    ;(request as CloudRequest).userId = decoded.uid
    next()
  }).catch(() => response.status(401).json({ error: 'Invalid or expired authentication token.' }))
}

async function getMembership(workspaceId: string, uid: string): Promise<WorkspaceMembership | undefined> {
  const result = await pool.query<WorkspaceMembership>(
    'SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_uid = $2',
    [workspaceId, uid],
  )
  return result.rows[0]
}

async function requireWorkspace(request: Request, response: Response, workspaceId: string): Promise<WorkspaceMembership | undefined> {
  if (!uuidPattern.test(workspaceId)) {
    response.status(400).json({ error: 'Invalid workspace ID.' })
    return undefined
  }

  const membership = await getMembership(workspaceId, userId(request))
  if (!membership) {
    response.status(404).json({ error: 'Workspace not found.' })
    return undefined
  }
  return membership
}

function logAudit(workspaceId: string, uid: string, action: string, entityType: string, entityId: string, client: Pool | PoolClient = pool) {
  return client.query(
    `INSERT INTO audit_events (workspace_id, user_uid, action, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [workspaceId, uid, action, entityType, entityId],
  )
}

app.get('/healthz', (_request, response) => response.status(200).send('ok'))
app.get('/api/readyz', async (_request, response) => {
  try {
    await pool.query('SELECT 1')
    await bucket.exists()
    response.status(200).json({ status: 'ready' })
  } catch {
    response.status(503).json({ status: 'not-ready' })
  }
})

app.get('/api/me', requireUser, (request, response) => {
  response.json({ uid: userId(request) })
})

app.get('/api/workspaces', requireUser, async (request, response, next) => {
  try {
    const result = await pool.query<WorkspaceRow>(
      `SELECT w.id, w.name, w.storage_quota_bytes, w.storage_used_bytes, w.storage_reserved_bytes
       FROM workspaces w JOIN workspace_memberships m ON m.workspace_id = w.id
       WHERE m.user_uid = $1 ORDER BY w.created_at`,
      [userId(request)],
    )
    response.json({ workspaces: result.rows })
  } catch (error) { next(error) }
})

app.post('/api/workspaces', requireUser, async (request, response, next) => {
  const name = typeof request.body?.name === 'string' ? request.body.name.trim() : ''
  const quotaGiB = Number(request.body?.quotaGiB)
  if (!name || name.length > 120 || !allowedQuotaGiB.has(quotaGiB)) {
    response.status(400).json({ error: 'Enter a workspace name and choose a supported storage quota.' })
    return
  }

  const client = await pool.connect()
  const workspaceId = randomUUID()
  try {
    await client.query('BEGIN')
    await client.query(
      'INSERT INTO workspaces (id, name, owner_uid, storage_quota_bytes) VALUES ($1, $2, $3, $4)',
      [workspaceId, name, userId(request), quotaGiB * 1024 ** 3],
    )
    await client.query(
      "INSERT INTO workspace_memberships (workspace_id, user_uid, role) VALUES ($1, $2, 'owner')",
      [workspaceId, userId(request)],
    )
    await logAudit(workspaceId, userId(request), 'workspace.created', 'workspace', workspaceId, client)
    await client.query('COMMIT')
    response.status(201).json({ id: workspaceId, name, quotaGiB, storageUsedBytes: 0 })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally { client.release() }
})

app.patch('/api/workspaces/:workspaceId/quota', requireUser, async (request, response, next) => {
  const workspaceId = String(request.params.workspaceId)
  const quotaGiB = Number(request.body?.quotaGiB)
  if (!uuidPattern.test(workspaceId)) {
    response.status(400).json({ error: 'Invalid workspace ID.' })
    return
  }
  if (!allowedQuotaGiB.has(quotaGiB)) {
    response.status(400).json({ error: 'Supported quotas are 10, 50 and 200 GB.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const workspace = await client.query<WorkspaceRow>(
      `SELECT id, name, storage_quota_bytes, storage_used_bytes, storage_reserved_bytes
       FROM workspaces WHERE id = $1 FOR UPDATE`,
      [workspaceId],
    )
    if (!workspace.rows[0]) {
      await client.query('ROLLBACK')
      response.status(404).json({ error: 'Workspace not found.' })
      return
    }
    const membership = await getMembership(workspaceId, userId(request))
    if (!membership || membership.role !== 'owner') {
      await client.query('ROLLBACK')
      response.status(403).json({ error: 'Only a workspace owner can change storage quota.' })
      return
    }
    const row = workspace.rows[0]
    const quotaBytes = BigInt(quotaGiB) * 1024n ** 3n
    const committedBytes = BigInt(row.storage_used_bytes) + BigInt(row.storage_reserved_bytes)
    if (quotaBytes < committedBytes) {
      await client.query('ROLLBACK')
      response.status(409).json({ error: 'The new quota is smaller than the space already used or reserved.' })
      return
    }
    await client.query('UPDATE workspaces SET storage_quota_bytes = $2 WHERE id = $1', [workspaceId, quotaBytes.toString()])
    await logAudit(workspaceId, userId(request), 'workspace.quota_changed', 'workspace', workspaceId, client)
    await client.query('COMMIT')
    response.json({ quotaGiB, storageUsedBytes: row.storage_used_bytes })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally { client.release() }
})

app.get('/api/documents', requireUser, async (request, response, next) => {
  try {
    const workspaceId = String(request.query.workspaceId ?? '')
    if (!await requireWorkspace(request, response, workspaceId)) return
    const result = await pool.query(
      `SELECT id, file_name, content_type, byte_size, status, created_at
       FROM cloud_documents WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [workspaceId],
    )
    response.json({ documents: result.rows })
  } catch (error) { next(error) }
})

app.get('/api/documents/:documentId/content', requireUser, async (request, response, next) => {
  const workspaceId = String(request.query.workspaceId ?? '')
  const documentId = String(request.params.documentId)
  try {
    if (!await requireWorkspace(request, response, workspaceId)) return
    if (!uuidPattern.test(documentId)) {
      response.status(400).json({ error: 'Invalid document ID.' })
      return
    }
    const result = await pool.query<{ file_name: string; content_type: string; object_key: string }>(
      "SELECT file_name, content_type, object_key FROM cloud_documents WHERE id = $1 AND workspace_id = $2 AND status = 'uploaded'",
      [documentId, workspaceId],
    )
    const document = result.rows[0]
    if (!document) {
      response.status(404).json({ error: 'Document not found.' })
      return
    }
    await logAudit(workspaceId, userId(request), 'document.downloaded', 'document', documentId)
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.type(document.content_type)
    response.attachment(document.file_name)
    const stream = bucket.file(document.object_key).createReadStream()
    stream.on('error', (error) => {
      if (response.headersSent) response.destroy(error)
      else next(error)
    })
    stream.pipe(response)
  } catch (error) { next(error) }
})

app.post('/api/documents', requireUser, express.raw({ type: ['application/pdf', 'application/xml', 'text/xml'], limit: '20mb' }), async (request, response, next) => {
  const workspaceId = String(request.query.workspaceId ?? '')
  const membership = await requireWorkspace(request, response, workspaceId)
  if (!membership) return
  if (!['owner', 'admin', 'accountant'].includes(membership.role)) {
    response.status(403).json({ error: 'Your role cannot upload documents.' })
    return
  }

  const contentType = request.get('content-type')?.split(';')[0].trim().toLowerCase()
  const body = request.body
  if (!Buffer.isBuffer(body) || body.length === 0) {
    response.status(400).json({ error: 'Document body is empty.' })
    return
  }
  if (contentType === 'application/pdf' && (body.length > maximumPdfBytes || body.subarray(0, 5).toString() !== '%PDF-')) {
    response.status(400).json({ error: 'PDF is invalid or exceeds the 20 MB limit.' })
    return
  }
  if ((contentType === 'application/xml' || contentType === 'text/xml') && (body.length > maximumXmlBytes || body.toString('utf8').includes('<!DOCTYPE'))) {
    response.status(400).json({ error: 'XML is invalid, contains a DOCTYPE, or exceeds the 5 MB limit.' })
    return
  }
  if (!['application/pdf', 'application/xml', 'text/xml'].includes(contentType ?? '')) {
    response.status(415).json({ error: 'Only PDF and XML documents are supported.' })
    return
  }

  const originalName = String(request.get('x-file-name') ?? 'document')
  const safeName = Array.from(originalName, (character) => character === '/' || character === '\\' ? '_' : character)
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && !(code >= 127 && code <= 159)
    })
    .join('')
    .slice(0, 180)
  const documentId = randomUUID()
  const objectKey = `workspaces/${workspaceId}/documents/${documentId}`
  const client = await pool.connect()
  let reserved = false
  try {
    await client.query('BEGIN')
    const reservation = await client.query(
      `UPDATE workspaces SET storage_reserved_bytes = storage_reserved_bytes + $2
       WHERE id = $1 AND storage_used_bytes + storage_reserved_bytes + $2 <= storage_quota_bytes RETURNING id`,
      [workspaceId, body.length],
    )
    if (!reservation.rowCount) {
      await client.query('ROLLBACK')
      response.status(413).json({ error: 'Workspace storage quota exceeded.' })
      return
    }
    reserved = true
    await client.query(
      `INSERT INTO cloud_documents (id, workspace_id, uploaded_by, file_name, content_type, byte_size, object_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploading')`,
      [documentId, workspaceId, userId(request), safeName, contentType, body.length, objectKey],
    )
    await client.query('COMMIT')

    const storedType = contentType === 'text/xml' ? 'application/xml' : contentType
    await bucket.file(objectKey).save(body, {
      resumable: false,
      validation: 'crc32c',
      metadata: { contentType: storedType, metadata: { workspaceId, uploadedBy: userId(request) } },
      preconditionOpts: { ifGenerationMatch: 0 },
    })

    await client.query('BEGIN')
    await client.query(
      `UPDATE workspaces SET storage_reserved_bytes = storage_reserved_bytes - $2,
       storage_used_bytes = storage_used_bytes + $2 WHERE id = $1`,
      [workspaceId, body.length],
    )
    await client.query("UPDATE cloud_documents SET status = 'uploaded' WHERE id = $1", [documentId])
    await logAudit(workspaceId, userId(request), 'document.uploaded', 'document', documentId, client)
    await client.query('COMMIT')
    response.status(201).json({ id: documentId, fileName: safeName, byteSize: body.length, status: 'uploaded' })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (reserved) {
      await pool.query('UPDATE workspaces SET storage_reserved_bytes = GREATEST(0, storage_reserved_bytes - $2) WHERE id = $1', [workspaceId, body.length]).catch(() => undefined)
      await pool.query('DELETE FROM cloud_documents WHERE id = $1', [documentId]).catch(() => undefined)
    }
    await bucket.file(objectKey).delete({ ignoreNotFound: true }).catch(() => undefined)
    next(error)
  } finally { client.release() }
})

app.get('/api/invoices', requireUser, async (request, response, next) => {
  try {
    const workspaceId = String(request.query.workspaceId ?? '')
    if (!await requireWorkspace(request, response, workspaceId)) return
    const result = await pool.query(
            `SELECT i.id, i.document_id, d.file_name AS source_name, i.invoice_number, i.supplier, i.invoice_date,
              i.due_date, i.amount, i.vat_amount, i.currency, i.account_code, i.status, i.created_at
             FROM invoices i LEFT JOIN cloud_documents d ON d.id = i.document_id AND d.workspace_id = i.workspace_id
             WHERE i.workspace_id = $1 ORDER BY i.created_at DESC LIMIT 500`,
      [workspaceId],
    )
    response.json({ invoices: result.rows })
  } catch (error) { next(error) }
})

app.post('/api/invoices', requireUser, async (request, response, next) => {
  const { workspaceId, documentId, invoiceNumber, supplier, invoiceDate, dueDate, amount, vatAmount, currency } = request.body ?? {}
  const membership = await requireWorkspace(request, response, String(workspaceId ?? ''))
  if (!membership) return
  if (!['owner', 'admin', 'accountant'].includes(membership.role)) {
    response.status(403).json({ error: 'Your role cannot add invoices.' })
    return
  }
  const numericAmount = Number(amount)
  const numericVat = vatAmount === '' || vatAmount === null || vatAmount === undefined ? null : Number(vatAmount)
  if (typeof invoiceNumber !== 'string' || !invoiceNumber.trim() || invoiceNumber.length > 120 ||
      typeof supplier !== 'string' || !supplier.trim() || supplier.length > 240 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) ||
      (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) ||
      !Number.isFinite(numericAmount) || Math.abs(numericAmount) > 1_000_000_000_000 ||
      (numericVat !== null && (!Number.isFinite(numericVat) || Math.abs(numericVat) > 1_000_000_000_000)) ||
      !allowedCurrencies.has(currency)) {
    response.status(400).json({ error: 'Invoice fields are invalid.' })
    return
  }

  const client = await pool.connect()
  const invoiceId = randomUUID()
  try {
    await client.query('BEGIN')
    if (documentId) {
      const document = await client.query(
        "SELECT id FROM cloud_documents WHERE id = $1 AND workspace_id = $2 AND status = 'uploaded'",
        [documentId, workspaceId],
      )
      if (!document.rowCount) {
        await client.query('ROLLBACK')
        response.status(400).json({ error: 'Document does not belong to this workspace.' })
        return
      }
    }
    await client.query(
      `INSERT INTO invoices (id, workspace_id, document_id, invoice_number, supplier, invoice_date, due_date, amount, vat_amount, currency, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [invoiceId, workspaceId, documentId || null, invoiceNumber.trim(), supplier.trim(), invoiceDate, dueDate || null, numericAmount, numericVat, currency, userId(request)],
    )
    await logAudit(workspaceId, userId(request), 'invoice.created', 'invoice', invoiceId, client)
    await client.query('COMMIT')
    response.status(201).json({ id: invoiceId, status: 'needs_review' })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally { client.release() }
})

app.patch('/api/invoices/:invoiceId/review', requireUser, async (request, response, next) => {
  const workspaceId = String(request.body?.workspaceId ?? '')
  const invoiceId = String(request.params.invoiceId)
  const status = request.body?.status
  const membership = await requireWorkspace(request, response, workspaceId)
  if (!membership) return
  if (!['owner', 'admin', 'accountant'].includes(membership.role)) {
    response.status(403).json({ error: 'Your role cannot review invoices.' })
    return
  }
  if (!['approved', 'rejected'].includes(status)) {
    response.status(400).json({ error: 'Status must be approved or rejected.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `UPDATE invoices SET status = $3, reviewed_by = $4, reviewed_at = NOW()
       WHERE id = $1 AND workspace_id = $2 AND status = 'needs_review' RETURNING id`,
      [invoiceId, workspaceId, status, userId(request)],
    )
    if (!result.rowCount) {
      await client.query('ROLLBACK')
      response.status(404).json({ error: 'Invoice not found or already reviewed.' })
      return
    }
    await logAudit(workspaceId, userId(request), `invoice.${status}`, 'invoice', invoiceId, client)
    await client.query('COMMIT')
    response.json({ id: invoiceId, status })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally { client.release() }
})

app.get('/api/audit', requireUser, async (request, response, next) => {
  try {
    const workspaceId = String(request.query.workspaceId ?? '')
    if (!await requireWorkspace(request, response, workspaceId)) return
    const result = await pool.query(
      `SELECT id, user_uid, action, entity_type, entity_id, created_at
       FROM audit_events WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [workspaceId],
    )
    response.json({ events: result.rows })
  } catch (error) { next(error) }
})

app.use('/api', (_request, response) => response.status(404).json({ error: 'API route not found.' }))

if (process.env.NODE_ENV === 'production') {
  const webRoot = resolve(process.cwd(), 'dist')
  app.use(express.static(webRoot, { index: false, maxAge: '1h', etag: true }))
  app.get('*splat', (_request, response) => response.sendFile(join(webRoot, 'index.html')))
}

app.use((error: Error & { status?: number }, _request: Request, response: Response, _next: NextFunction) => {
  if (response.headersSent) return
  if (error.status === 413) {
    response.status(413).json({ error: 'Document exceeds the upload limit.' })
    return
  }
  console.error('Request failed:', error.message)
  response.status(500).json({ error: 'The request could not be completed.' })
})

const port = Number(process.env.PORT || 8080)
app.listen(port, '0.0.0.0', () => console.info(`AICOM API listening on ${port}`))