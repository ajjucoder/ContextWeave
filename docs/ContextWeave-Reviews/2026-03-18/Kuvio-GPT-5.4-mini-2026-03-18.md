# Review Context

Model: GPT-5.4-mini (xhigh)
Date: 2026-03-18
Branch audited: `feat/healthcare-sector`
Base: `main`

## Verification

- `npm run lint` in the isolated worktree: 0 errors, 55 warnings.
- `npm run test:unit` in the isolated worktree: 703/703 passed.
- `npm run build` in the branch checkout: passed.
- `npm run test:e2e`: 23 passed, 9 failed. The failures were in create-site flow, dashboard route navigation, public URL preview, and template/project preview links.
- `npm audit --omit=dev --audit-level=moderate`: reported 20 known vulnerabilities (19 high, 1 moderate). This is not clearly introduced by this branch, but it does block a blanket security sign-off.

## Findings

1. Important: healthcare team metadata is captured in the editor but not rendered on the public site.
   - `kuvio/src/features/site-edit/TeamPage.tsx:63-70,133-155,194-203`
   - `kuvio/src/components/public/AboutPage.tsx:811-923`
   - The dashboard stores `specialty`, `qualifications`, and `consultationHours`, but the public team card only renders photo, role, and name.
   - Impact: medical site owners can enter clinician-specific details that visitors never see, so the branch’s healthcare-specific team fields do not reach the live site.

2. Important: the public price-list layouts generate invalid CSS when `mutedColor` is an `rgba(...)` string.
   - `kuvio/src/components/public/price-list/PriceListAccordion.tsx:32-34`
   - `kuvio/src/components/public/price-list/PriceListTable.tsx:79`
   - `kuvio/src/components/public/price-list/PriceListCardGrid.tsx:77-78`
   - Several themed layouts pass `mutedColor="rgba(...)"` into these components, so concatenating `18`, `33`, or `12` onto the string produces invalid color tokens and silently drops borders/shadows in those layouts.
   - Example call sites: `kuvio/src/features/site-preview/layouts/MonolithLayout.tsx:560,573,1005,1017`, `PrismLayout.tsx:991,1009,1028,1511,1524,1537,1743`, `ModularLayout.tsx:1171,1184,1437`, `AtelierLayout.tsx:982,995,1018`.

3. Medium: healthcare is exposed in the create flow, but the service presets and copy still default to construction-oriented content.
   - `kuvio/src/features/create-site/VariationCreateSitePage.tsx:77-81,589-616`
   - Healthcare is available in the sector selector, but `Step2Services` still uses `CONSTRUCTION_SERVICES` for every non-portfolio sector.
   - Impact: a clinic user is prompted with building/contracting starters like "Earthquake-Resistant Building" and "Landscape & Outdoor", which makes the new sector feel unfinished and semantically wrong.

4. Medium: `priceCategories` is persisted and reloaded without shape validation.
   - `kuvio/src/lib/types.ts:90-94,215`
   - `kuvio/src/lib/supabase/queries.ts:358-359,636-640`
   - The read path casts any array from `price_categories` to `Site['priceCategories']`, the write path stores `partial.priceCategories` raw, and the public renderers assume `cat.items` is always an array.
   - Impact: malformed JSON in Supabase can crash the new public price-list sections or surface broken pricing pages with no guardrail.

## Residual Risk

- I did not verify live Supabase migration execution or a production deploy.
