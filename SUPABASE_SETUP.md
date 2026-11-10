# Supabase setup

VerifiedYou is a static HTML, CSS, and JavaScript application. It uses the Supabase JavaScript v2 browser client and does not require a build step.

## 1. Connect the Supabase project

`supabase-config.js` is configured with the project URL and publishable anon key. These values are intended to be public; never put a service-role key in the browser.

## 2. Create the database and storage policies

The migration `supabase/migrations/20261110000000_initial_schema.sql` has been applied to the configured project. It creates the profile, achievement, institution-verifier, employer shortlist, and private-note tables; Row Level Security policies; the private proof and avatar buckets; and the profile-sharing RPC. To recreate the schema in another project, open its Supabase SQL Editor and run that migration.

The application never grants institution review permissions based on the signup role alone. To authorize a lecturer, first have that person register, then add their account from the SQL Editor or another trusted administrator context:

```sql
insert into public.institution_verifiers (user_id, institution)
select id, 'Africa University'
from auth.users
where email = 'lecturer@example.edu';
```

Only active verifiers assigned to an achievement's institution can review it. Do not expose administrator or service-role credentials in the application.

## 3. Configure Auth

In **Authentication → URL Configuration**, set the local development URL (for example `http://localhost:5500`) as the Site URL and add it to the Redirect URLs. Enable email/password sign-in. If email confirmation is enabled, new users need to confirm their address before they can sign in.

### Email sending limits

The project's built-in email sender is currently limited to 2 emails per hour. This limit is enforced by Supabase, not by the application, and the dashboard disables editing it until custom SMTP is configured. To increase delivery capacity, configure a trusted SMTP provider in the Supabase dashboard, then update **Authentication → Rate Limits → Rate limit for sending emails** to a value allowed by that provider. Do not disable rate limits or repeatedly retry email requests; wait for the limit to reset. The app displays an actionable message when Supabase returns an email rate-limit error.

## 4. Run locally

From the project directory, serve the files over HTTP (not `file://`), for example:

```powershell
python -m http.server 5500
```

Then open `http://localhost:5500`. The Supabase JavaScript library is loaded from jsDelivr, so the browser needs network access.

## Data access notes

- Each profile and achievement is keyed to the authenticated user; users can manage their own profile and unverified achievements.
- Only institution verifiers explicitly listed in `institution_verifiers` can approve or reject matching requests.
- Employers can browse public student profiles and verified public achievements; their shortlists and notes are private to their own account.
- Proof documents and profile photos are stored in private Storage buckets. Proof files are visible only to their owner and an assigned institution verifier.
- A share URL uses a random token kept in a private owner-only table and exposes a limited profile plus verified achievements marked public or link-only. Rotate/revoke a share token only through a trusted administrative process in this initial version.

The Supabase Auth and PostgREST endpoints have been verified against the configured project. End-to-end registration, authenticated persistence, file uploads, and cross-account RLS behavior still require testing with real user accounts.
