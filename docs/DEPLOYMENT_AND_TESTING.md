# Deployment and testing handoff

## What is in the code package

The packaged folder contains the complete application source, API routes, shared factory logic, database schema, automated tests, CI workflow, documentation, and dependency lockfile. Generated folders (`node_modules`, `dist`, and coverage output), Git history, local environment files, and secrets are deliberately excluded.

## Local verification

Use Node.js 20 or newer.

```bash
npm ci
npm run check
npm run dev
```

`npm run check` is the release gate. It runs the core regression suite with coverage thresholds, the UI/API suite in JSDOM with separate coverage thresholds, and the production build. A failed check should block deployment.

For individual suites:

```bash
npm run test:core
npm run test:ui-api
npm run test:coverage
```

## Required environment variables

Configure these in the local `.env` file and in Vercel project settings; do not commit the values.

- `DATABASE_URL`: PostgreSQL/Neon connection string.
- `ANTHROPIC_API_KEY`: required for photographed-order extraction and Copilot.
- `AI_MODEL`: optional model override.
- `PGSSL`: optional PostgreSQL SSL override where required by the host.

## Database

The authoritative schema is `db/schema.sql`. This release adds order archiving/version fields,
the PI-number sequence, immutable PI revisions and a restrictive dispatch foreign key. Apply the
numbered migration to an existing Neon database before deploying the code:

```bash
psql "$DATABASE_URL" -f db/migrations/001_integrity_and_pi_history.sql
```

For a brand-new database, use `npm run db:setup`. Take a database backup first. No new Vercel
environment variable is required; the existing pooled `DATABASE_URL` is still the database input.

Use a separate test database for API integration tests. The current automated API tests mock PostgreSQL so that they are safe and repeatable, but they do not prove production credentials, network access, or live migration compatibility.

## Vercel deployment

1. Push the reviewed branch to GitHub.
2. Confirm the GitHub Actions `npm run check` job passes.
3. Apply/verify `db/schema.sql` against a backed-up staging database.
4. Configure the environment variables in Vercel Preview and Production.
5. Deploy to Preview first.
6. Run the manual release checks from `docs/TEST_MATRIX.md`, including photo extraction, XLSM upload, PI print/PDF, PI-to-schedule linking, dispatch, and reload persistence.
7. Promote to Production only after the Preview checks pass.

## Known release blockers and risks

- The supplied order book currently contains many article names and size combinations absent from the reference master. The importer now blocks these rows instead of silently creating incorrect orders. Complete and approve those reference rules before importing the full workbook.
- The `xlsx` dependency has a published high-severity advisory with no fixed npm release. Uploads are now capped at 10 MB, 20 sheets and 25,000 rows, but the dependency should still be replaced before accepting files from untrusted users.
- Authentication and role-based permissions are not implemented. Do not expose the production app publicly until access control is added.
- AI extraction, live Neon persistence, and browser print/PDF require staging tests because they depend on external services or browser behaviour.
