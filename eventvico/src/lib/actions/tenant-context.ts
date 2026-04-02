import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ActionResult } from '@/types/app'

export type TenantContextResult = ActionResult<{ tenantId: string; userId: string }>

/**
 * Resolves the authenticated user's tenant context for use in server actions.
 *
 * Uses the session-aware client for auth.getUser() (validates the JWT against Supabase Auth),
 * then uses the admin client for the profiles lookup to avoid an RLS issue where
 * auth.uid() returns null in the PostgREST context when called from server actions.
 */
export async function getTenantContext(): Promise<TenantContextResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) {
    return { success: false, error: { code: 'AUTH_REQUIRED', message: 'Please sign in again.' } }
  }

  const { data: profile } = await createAdminClient()
    .from('profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.tenant_id) {
    return { success: false, error: { code: 'TENANT_NOT_FOUND', message: 'Could not find your studio account.' } }
  }

  return { success: true, data: { tenantId: profile.tenant_id, userId: user.id } }
}
