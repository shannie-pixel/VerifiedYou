# VerifiedYou

VerifiedYou is a static HTML, CSS, and JavaScript application backed by Supabase Authentication, PostgreSQL, and Storage.

## Run locally

The browser app is static; Supabase provides authentication, the database, and storage. There is no separate application API server.

1. Make sure `supabase-config.js` contains your Supabase project URL and **publishable** key.
2. In Supabase **Authentication → URL Configuration**, set the Site URL to the exact local origin you use and allow that origin, for example `http://127.0.0.1:5501/**` (also add `http://localhost:5501/**` if you use `localhost`).
3. From the project directory, start the static web server:

   ```powershell
   py -m http.server 5501 --bind 127.0.0.1
   ```

4. Open `http://127.0.0.1:5501`.

The signup confirmation link returns to `login.html?confirmed=1`. Keep the hostname consistent between the browser, Supabase Site URL, and allowed redirect URLs.

### Test email verification locally

The default hosted Supabase email sender is rate-limited and may reject requests with HTTP 429. Configure custom SMTP in the Supabase dashboard for hosted-project email delivery; never put SMTP credentials in this frontend.

For isolated development without a hosted email provider, this repository includes a local Supabase configuration with email confirmation enabled and Inbucket as the email catcher. Install Docker Desktop and the Supabase CLI, then run:

```powershell
npx supabase start
npx supabase status
```

In `supabase-config.js`, temporarily use the local API URL and publishable/anon key printed by `supabase status`. Start the static server as above, register a test account, and open the captured confirmation email at `http://127.0.0.1:54324`. Local Supabase applies the migrations in `supabase/migrations` at startup. Restore your hosted project URL/key when returning to the hosted backend.

For detailed setup, email delivery limits, and authorization notes, see [SUPABASE_SETUP.md](./SUPABASE_SETUP.md).

## Application pages

- `index.html`: landing page
- `login.html`: registration, sign-in, and password recovery
- Student: `dashboard.html`, `profile.html`, `achievements.html`, `add-achievement.html`, `requests.html`, and `settings.html`
- Institution: `institution.html`
- Employer: `employer.html` and `employer-settings.html`

The shared Supabase client and authenticated data operations are in `app.js`; employer-specific behavior is in `employer.js`. Never put a Supabase service-role key in browser code.
