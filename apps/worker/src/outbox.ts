import { publishJobs, type Database } from '@seo/db'
import {
  enqueueAudit,
  enqueueFix,
  type FixJob,
  enqueueVerifyFix,
  enqueueConfirmVerify,
  type Queue,
  type AuditJob,
  type VerifyFixJob,
  type ConfirmVerifyJob,
} from '@seo/queue'

export async function publishPendingJobs(db: Database, queue: Queue): Promise<void> {
  await publishJobs(db, async (kind, payload) => {
    switch (kind) {
      case 'fix':
        return enqueueFix(queue, payload as FixJob)
      case 'audit':
        return enqueueAudit(queue, payload as AuditJob)
      case 'verify-fix':
        return enqueueVerifyFix(queue, payload as VerifyFixJob)
      case 'confirm-verify':
        return enqueueConfirmVerify(queue, payload as ConfirmVerifyJob)
      default:
        throw new Error(`Unsupported outbox kind: ${kind}`)
    }
  })
}
