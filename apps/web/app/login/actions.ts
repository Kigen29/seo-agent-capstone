'use server'

import { createApiClient, ApiRequestError } from '@seo/api-client'
import { redirect } from 'next/navigation'
import { apiUrl, clearToken, setToken } from '@/lib/session'

export interface LoginState {
  error?: string
}

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const token = String(form.get('token') ?? '').trim()

  if (!token) return { error: 'Paste your API token.' }

  /**
   * Verify the token against the API before storing it, so a typo fails here with a clear
   * message rather than becoming a mysterious 401 on every page afterwards.
   */
  try {
    await createApiClient({ baseUrl: apiUrl(), token }).listSites()
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      return { error: 'That token is not valid.' }
    }

    /**
     * The API is on Render's free tier and sleeps after about fifteen minutes idle, taking
     * up to a minute to wake. Saying so is the difference between a user waiting and a user
     * concluding the product is broken. A generic "something went wrong" here would be a
     * small lie by omission, and it is the exact moment a first-time user decides whether to
     * trust us.
     */
    return {
      error:
        'Could not reach the API. It sleeps when idle on the free tier and can take up to a minute to wake. Try again shortly.',
    }
  }

  await setToken(token)
  redirect('/dashboard')
}

export async function signOut(): Promise<void> {
  await clearToken()
  redirect('/login')
}
