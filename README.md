# VerifiedYou

VerifiedYou is a static HTML, CSS, and JavaScript application backed by Supabase Authentication, PostgreSQL, and Storage.

## Run locally

1. Configure the Supabase project URL and publishable key in `supabase-config.js`.
2. Apply `supabase/migrations/20261110000000_initial_schema.sql` in the Supabase SQL Editor.
3. Configure the Supabase Auth Site URL and Redirect URLs for the local address you use.
4. Serve the project over HTTP, for example:

   ```powershell
   python -m http.server 5500
   ```

5. Open `http://localhost:5500`.

For detailed setup, email delivery limits, and authorization notes, see [SUPABASE_SETUP.md](./SUPABASE_SETUP.md).

## Application pages

- `index.html`: landing page
- `login.html`: registration, sign-in, and password recovery
- Student: `dashboard.html`, `profile.html`, `achievements.html`, `add-achievement.html`, `requests.html`, and `settings.html`
- Institution: `institution.html`
- Employer: `employer.html` and `employer-settings.html`

The shared Supabase client and authenticated data operations are in `app.js`; employer-specific behavior is in `employer.js`. Never put a Supabase service-role key in browser code.
