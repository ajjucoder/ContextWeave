# Review Context

Model: GPT-5.4 (high)
Date: 2026-03-18
Branch audited: `feat/healthcare-sector` (`0bc7cf9`)
Base: `main` (`8e3a506`)

## Verification

- `npm run test:unit` in isolated worktree: 703/703 passed
- `./node_modules/.bin/next build --webpack` in isolated worktree: passed
- `npm run lint` in isolated worktree: 0 errors, 55 warnings
- `npm audit --omit=dev --audit-level=moderate`: failed with 20 known vulnerabilities (19 high, 1 moderate)

## Findings

1. Important: the new medical staff fields are editable in the dashboard, but they are not rendered on the public site.
   - The editor captures `specialty`, `qualifications`, and `consultationHours` in `src/features/site-edit/TeamPage.tsx`.
   - Public team rendering in `src/components/public/AboutPage.tsx` still shows role/name/bio only.
   - A repo-wide search under `src/components/public` and `src/features/site-preview` found no public rendering of `specialty`, `qualifications`, or `consultationHours`.
   - Impact: the branch stores healthcare-specific doctor metadata, but visitors cannot see it on live templates.

2. Important: this branch cannot be signed off as "no security vulnerabilities whatsoever" because the repo still has active dependency advisories.
   - `package.json` still ships `next@16.1.6` and `@aws-sdk/client-s3`.
   - `npm audit --omit=dev --audit-level=moderate` reports 20 vulnerabilities, including Next.js moderate advisories and a high-severity `fast-xml-parser` issue through the AWS SDK chain.
   - This is a repo-level security issue, not clearly introduced by this branch, but it blocks a clean security approval.

3. Medium: feature availability messaging is inconsistent.
   - Healthcare is enabled in both create flows (`src/features/create-site/CreateSiteWizard.tsx`, `src/features/create-site/VariationCreateSitePage.tsx`).
   - The landing pages still label Healthcare as `Soon` (`src/app/(landing)/v1/page.tsx`, `src/app/(landing)/v2/page.tsx`, `src/app/LandingPage.tsx`).
   - Impact: users can create healthcare sites while the marketing surface still says the sector is not live.

4. Medium: the new healthcare and price-list behavior has little to no direct automated coverage.
   - `src/lib/siteCompleteness.test.ts` covers construction, education, and portfolio only.
   - A repo-wide test search found no tests targeting `PriceListPage`, `price-list` routes/components, `Healthcare`, `specialty`, `qualifications`, or `consultationHours`.
   - Impact: the 703 passing tests do not meaningfully prove the new branch functionality.

## Residual Risks

- Migration `055_healthcare_sector.sql` was reviewed statically, but not executed against a live Supabase instance during this audit because Supabase environment variables were unavailable.
- No branch-specific auth/RLS/API regression was found in the changed database/query code during static review.
