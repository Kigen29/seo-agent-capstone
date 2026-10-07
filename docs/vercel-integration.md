# Setting up "Connect to Vercel"

This is done once per deployment, by the operator. Until it is done, the hosting page offers the access-token form instead, and everything else works.

It registers an integration with Vercel so that a customer can approve access on Vercel's own screen instead of creating and pasting a token. See ADR-0033 for why.

## 1. Create the integration

1. Open the Integrations Console: <https://vercel.com/dashboard/integrations/console>
2. Choose **Create**.
3. Fill in the profile. The fields that matter to the product:

   | Field | Value |
   |---|---|
   | Name | Rankwright (or the product's current name) |
   | URL Slug | a short slug, for example `rankwright`. You will need it below. |
   | Redirect URL | `https://<your API host>/connections/vercel/callback` |

   The Redirect URL must be the API's address, not the web app's. For the deployment in this repository's README that is the Render service.

4. Under **API Scopes**, set **Projects** to **Read** and **Deployments** to **Read**. Leave everything else at None. The product reads which project deploys a repository and what a project is currently serving; it writes nothing to Vercel.
5. Leave Webhook URL and Configuration URL empty.
6. Save. You do not need to submit the integration to the Marketplace: an unlisted integration can be installed by anyone with its link, which is what the button uses.

## 2. Copy the credentials

On the integration's page in the console, under **Credentials**, copy the **Client ID** and the **Client Secret**. Treat the secret like any other key: it goes into the API host's environment and nowhere else. This repository is public.

## 3. Set four environment variables on the API

On Render, in the API service's **Environment**:

| Variable | Value |
|---|---|
| `VERCEL_INTEGRATION_CLIENT_ID` | the Client ID |
| `VERCEL_INTEGRATION_CLIENT_SECRET` | the Client Secret |
| `VERCEL_INTEGRATION_SLUG` | the URL Slug from step 1 |
| `VERCEL_INTEGRATION_REDIRECT_URI` | exactly the Redirect URL from step 1 |

All four or none. With any one missing the button is not offered, because a half-configured integration would send people to a consent screen that cannot finish.

The worker needs none of these. It only reads the connection that the API stored.

## 4. Check it

1. Open **Settings, Connections, Hosting** for a site that has its repository connected.
2. **Connect to Vercel** should now be the first thing in the Vercel card.
3. Click it, choose the account or team that owns the site's project, and approve. When Vercel asks which projects to share, include the site's project.
4. You are returned to the hosting page with the result.

## What each result means

| Message | What to do |
|---|---|
| Connected | Nothing. Merged fixes for the site are now verified against its project. |
| No project that deploys this site's repository | The account or team you chose does not own the project, or the project was not included. Try again and pick the right one. |
| Nothing confirms it serves this site's address | The project is linked to the repository but the site's domain is not assigned to it, or no production deployment has completed. Fix that in Vercel and try again. |
| Could not be matched to a request from this account | The approval took more than ten minutes or the link was reused. Start again from the hosting page. |
| Vercel could not be reached | Usually a wrong Client Secret or a Redirect URL that does not match the one registered. Check step 3 against step 1 character for character. |
