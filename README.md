# YOURZ website

Responsive public-facing company website for YOURZ / 热众.

## Included
- Chinese-first landing page with product categories, company introduction, cooperation process, and contact link.
- CSS-generated product illustrations, no third-party runtime dependencies.
- Mobile navigation and an internal-management visual prototype.

## Security
The internal-management panel is only a visual prototype. It is **not** an authenticated admin system and is not connected to a database. Do not enter real credentials or sensitive business data. Before internal use, implement Supabase Auth, protected routes, database tables, and row-level security.

## Deploy a test site with GitHub Pages
1. Open repository **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch `main` and folder `/(root)`, then save.
4. Wait for GitHub Pages to publish the generated `github.io` URL and verify the page there.
5. Only after the test URL works, configure the custom domain `yourz.top` and DNS records shown in GitHub Pages. Do not change DNS before then.

## Before public launch
- Replace `hello@yourz.top` with a monitored company contact address if needed.
- Confirm the legal company name, logo, product photos, language requirements, and business contact details.
- Do not add customer or supplier data to this public repository.
