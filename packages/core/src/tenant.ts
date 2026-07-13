import { z } from 'zod'

/**
 * The unit of isolation. Every table carries a tenant_id and row-level security
 * is keyed on it, so one client can never see another's audit (STORY-003).
 */
export const tenantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().datetime(),
})

export type Tenant = z.infer<typeof tenantSchema>
