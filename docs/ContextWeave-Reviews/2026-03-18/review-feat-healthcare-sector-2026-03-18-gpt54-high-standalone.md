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

1. Important: healthcare staff metadata is captured in the editor but never rendered on the public site.
   - The new fields are collected and shown in the dashboard editor/card in `src/features/site-edit/TeamPage.tsx`.
   - Public team rendering in `src/components/public/AboutPage.tsx` still only shows role/name/bio.
   - A repo-wide search under `src/components/public` and `src/features/site-preview` found no public rendering path for `specialty`, `qualifications`, or `consultationHours`.
   - Impact: doctor-specific information is persisted but invisible to visitors.

2. Important: the new price-list components generate invalid CSS when a layout passes `mutedColor` as `rgba(...)`.
   - `PriceListAccordion` appends `18` and `33` to `mutedColor` in `src/components/public/price-list/PriceListAccordion.tsx`.
   - `PriceListTable` appends `18` in `src/components/public/price-list/PriceListTable.tsx`.
   - `PriceListCardGrid` appends `18` and `12` in `src/components/public/price-list/PriceListCardGrid.tsx`.
   - Several live layouts pass `rgba(...)` strings, for example `src/features/site-preview/layouts/PrismLayout.tsx` and `src/features/site-preview/layouts/MonolithLayout.tsx`.
   - Impact: borders, dotted leaders, and shadows silently break on affected templates.

3. Important: this branch cannot be signed off as having no security vulnerabilities.
   - `package.json` still ships `next@16.1.6` and `@aws-sdk/client-s3`.
   - `npm audit --omit=dev --audit-level=moderate` reports 20 vulnerabilities, including Next.js moderate advisories and a high-severity `fast-xml-parser` issue through the AWS SDK chain.
   - This is repo-level rather than clearly branch-introduced, but it blocks a clean security approval.

4. Medium: the healthcare create flow still falls back to construction service presets.
   - `Step2Services` uses `PORTFOLIO_SERVICES` only for portfolio and otherwise defaults to `CONSTRUCTION_SERVICES` in `src/features/create-site/VariationCreateSitePage.tsx`.
   - Healthcare is enabled in the same file, so clinic users are shown construction-oriented starter services.
   - Impact: the new sector feels unfinished and semantically wrong during onboarding.

5. Medium: the new healthcare and price-list surface has little to no direct automated coverage.
   - `src/lib/siteCompleteness.test.ts` only covers construction, education, and portfolio.
   - A repo-wide test search found no direct tests for `PriceListPage`, `price-list` routes/components, `Healthcare`, `specialty`, `qualifications`, or `consultationHours`.
   - Impact: the 703 passing tests do not materially prove the new feature works end-to-end.

6. Medium: feature availability messaging is inconsistent.
   - Healthcare is enabled in `src/features/create-site/CreateSiteWizard.tsx` and `src/features/create-site/VariationCreateSitePage.tsx`.
   - The landing pages still label Healthcare as `Soon` in `src/app/(landing)/v1/page.tsx`, `src/app/(landing)/v2/page.tsx`, and `src/app/LandingPage.tsx`.
   - Impact: users can create healthcare sites while the marketing surface still says the sector is not live.

## Residual Risks

- Migration `055_healthcare_sector.sql` was reviewed statically, but not executed against a live Supabase instance during this audit because Supabase environment variables were unavailable.
- `priceCategories` is read and written without structural validation in `src/lib/supabase/queries.ts`, so malformed JSON in Supabase could still break the new public price-list renderers.
- No branch-specific auth/RLS/API regression was found in the changed database/query code during static review.
