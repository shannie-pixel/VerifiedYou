# VerifiedYou

## Pages and how they link
- `index.html`: landing page. Links to `login.html`.
- `login.html`: sign up or log in. Sends each role to its page:
  - Student: `dashboard.html`
  - Lecturer / Institution: `institution.html`
  - Employer: `employer.html`
- Student pages (shared sidebar from `app.js`): `dashboard.html`, `profile.html`, `achievements.html`, `add-achievement.html`, `documents.html`, `requests.html`, `settings.html`
- `institution.html` (+ `institution.css`, `institution.js`): institution review page. Shows the achievements students submit. Approve or reject here and the student sees the result.
- `employer.html`: employers search verified candidates.
- `verifier.html`: older review page. Nothing links to it any more; you can delete it.

## Shared files
- `app.css` and `app.js` style and power every page except the landing and login pages. `institution.html` also loads `app.js` to read and save the same data.

## Run it in VS Code
Open the folder, right-click `index.html` and choose **Open with Live Server**. Keep all files in the same folder.

## Connecting a backend later
- Data is saved in the browser (localStorage) for now. Replace `all()` / `save()` in `app.js` with calls to your database.
- Only let institution accounts reach `institution.html`. That check must happen on your backend.
