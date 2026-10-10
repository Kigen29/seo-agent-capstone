import {
  asOwner,
  audits,
  createDb,
  sites,
  tenants,
  visibilityPrompts,
  withTenant,
  type Database,
} from '@seo/db'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readSchedule, saveAuditCadence } from '../src/schedule.js'
import { enqueueDueAudits } from '../src/scheduled-audits.js'

const url = process.env.DATABASE_URL
const shouldRun = Boolean(url) || Boolean(process.env.CI)

const DAY = 86_400_000

/**
 * The calendar and the scheduled-audit sweep against a real Postgres.
 *
 * What only rows can show: that the day the calendar names is the day the sweep acts on, that a
 * sweep run twice starts one audit, and that one tenant's calendar is not another's to read.
 * Time is driven by passing `now`, so the weeks run in order with no clock involved.
 */
describe.skipIf(!shouldRun)('schedule', () => {
  let db: Database
  let closeDb: () => Promise<void>
  let tenantId: string
  let otherTenantId: string
  let siteId: string

  const monday = new Date('2026-10-05T08:00:00.000Z')

  const auditsOf = () =>
    withTenant(db, tenantId, (tx) =>
      tx
        .select({ id: audits.id, status: audits.status })
        .from(audits)
        .where(eq(audits.siteId, siteId)),
    )

  /** Stand in for the worker finishing an audit, at a chosen moment. */
  const finish = (auditId: string, startedAt: Date) =>
    withTenant(db, tenantId, (tx) =>
      tx
        .update(audits)
        .set({ status: 'complete', startedAt, completedAt: startedAt, pagesCrawled: 12 })
        .where(eq(audits.id, auditId)),
    )

  beforeAll(async () => {
    const created = createDb(url)
    db = created.db
    closeDb = () => created.pool.end()
    ;[tenantId, otherTenantId] = await asOwner(db, async (tx) => {
      const rows = await tx
        .insert(tenants)
        .values([{ name: `schedule-${Date.now()}` }, { name: `schedule-other-${Date.now()}` }])
        .returning()
      return [rows[0]!.id, rows[1]!.id]
    })
    siteId = await withTenant(db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(sites)
        .values({ tenantId, url: 'https://schedule-test.example.com' })
        .returning()
      return row!.id
    })
  })

  afterAll(async () => {
    if (!db) return
    await asOwner(db, async (tx) => {
      await tx.delete(tenants).where(eq(tenants.id, tenantId))
      await tx.delete(tenants).where(eq(tenants.id, otherTenantId))
    })
    await closeDb()
  })

  it('schedules nothing for a new site: audits are off until somebody turns them on', async () => {
    const schedule = await readSchedule(db, tenantId, siteId, '2026-10', monday)
    expect(schedule).toMatchObject({ auditCadence: 'off', today: '2026-10-05', events: [] })
    expect(await enqueueDueAudits(db, { now: monday, siteId })).toBe(0)
    expect(await auditsOf()).toEqual([])
  })

  it('refuses a cadence that is not one of the three', async () => {
    await expect(
      asOwner(db, (tx) =>
        tx.execute(sql`update sites set audit_cadence = 'hourly' where id = ${siteId}`),
      ),
    ).rejects.toThrow()
  })

  it('shows the first scheduled audit as due today, and the sweep starts exactly that one', async () => {
    expect(await saveAuditCadence(db, tenantId, siteId, 'weekly')).toBe('weekly')

    const before = await readSchedule(db, tenantId, siteId, '2026-10', monday)
    expect(before!.events[0]).toMatchObject({ kind: 'audit', day: '2026-10-05', state: 'due' })

    expect(await enqueueDueAudits(db, { now: monday, siteId })).toBe(1)
    const [audit] = await auditsOf()
    expect(audit!.status).toBe('queued')

    // It is in the outbox, which is what puts it on the queue.
    const outbox = await asOwner(db, (tx) =>
      tx.execute<{ kind: string }>(
        sql`select kind from job_outbox where event_key = ${`audit:${audit!.id}`}`,
      ),
    )
    expect(outbox.rows).toEqual([{ kind: 'audit' }])
  })

  it('starts no second audit while the first is still running, however often it wakes', async () => {
    expect(await enqueueDueAudits(db, { now: monday, siteId })).toBe(0)
    expect(await enqueueDueAudits(db, { now: new Date(monday.getTime() + DAY), siteId })).toBe(0)
    expect(await auditsOf()).toHaveLength(1)

    // And the calendar shows it running, with no other audit promised until it ends.
    const schedule = await readSchedule(db, tenantId, siteId, '2026-10', monday)
    const auditEvents = schedule!.events.filter((event) => event.kind === 'audit')
    expect(auditEvents.map((event) => event.state)).toEqual(['running'])
  })

  it('waits the full week after an audit, then starts the next on the day the calendar named', async () => {
    const [first] = await auditsOf()
    await finish(first!.id, monday)

    const midweek = new Date(monday.getTime() + 3 * DAY)
    expect(await enqueueDueAudits(db, { now: midweek, siteId })).toBe(0)

    const schedule = await readSchedule(db, tenantId, siteId, '2026-10', midweek)
    const next = schedule!.events.find((event) => event.id.startsWith('audit:next'))
    expect(next).toMatchObject({ day: '2026-10-12', state: 'scheduled' })

    const dayBefore = new Date('2026-10-11T23:50:00.000Z')
    expect(await enqueueDueAudits(db, { now: dayBefore, siteId })).toBe(0)

    const theDay = new Date('2026-10-12T00:10:00.000Z')
    expect(await enqueueDueAudits(db, { now: theDay, siteId })).toBe(1)
    expect(await auditsOf()).toHaveLength(2)
  })

  it('stops when it is switched off', async () => {
    const all = await auditsOf()
    for (const audit of all.filter((entry) => entry.status === 'queued')) {
      await finish(audit.id, new Date('2026-10-12T00:10:00.000Z'))
    }
    await saveAuditCadence(db, tenantId, siteId, 'off')

    const muchLater = new Date('2026-12-01T00:00:00.000Z')
    expect(await enqueueDueAudits(db, { now: muchLater, siteId })).toBe(0)
    expect(await auditsOf()).toHaveLength(2)
  })

  it('polls daily once there is a question to ask, and shows past audits where they fell', async () => {
    await withTenant(db, tenantId, (tx) =>
      tx.insert(visibilityPrompts).values({ tenantId, siteId, prompt: 'Who runs walking tours?' }),
    )
    const schedule = await readSchedule(db, tenantId, siteId, '2026-10', monday)
    const polls = schedule!.events.filter((event) => event.kind === 'visibility_poll')
    expect(polls[0]).toMatchObject({ day: '2026-10-05', state: 'due' })
    expect(polls.at(-1)!.day).toBe(schedule!.to)

    const done = schedule!.events.filter(
      (event) => event.kind === 'audit' && event.state === 'done',
    )
    expect(done.map((event) => event.day)).toEqual(['2026-10-05', '2026-10-12'])
  })

  it('does not show another tenant the calendar, or let it change the cadence', async () => {
    expect(await readSchedule(db, otherTenantId, siteId, '2026-10', monday)).toBeNull()
    expect(await saveAuditCadence(db, otherTenantId, siteId, 'weekly')).toBeNull()
    const mine = await readSchedule(db, tenantId, siteId, '2026-10', monday)
    expect(mine!.auditCadence).toBe('off')
  })
})
