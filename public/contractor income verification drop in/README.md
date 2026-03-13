# Contractor Income Verification Drop-In Pack

This pack fills the obvious gap between your existing Contractor Network / AE Flow / Skye Platinum surfaces and the new offer you want to push:

- contractor-specific income ledger
- contractor-specific expense ledger
- verification / attestation layer
- CSV exports
- printable branded proof packet HTML that can be saved as PDF

This pack is built to be dropped into your existing SuperIDE / skAIxuIDE Pro codebase and wired manually.
It is intentionally additive.
It does **not** try to replace your current Contractor Network or CRM surfaces.

## What this pack contains

- `sql/contractor-income-verification-extension.sql`
  - Neon schema extension for contractor financial records and proof packets
- `netlify/functions/_lib/contractor-income.mjs`
  - shared helpers / query normalization / report shaping
- `netlify/functions/contractor-income-records.mjs`
  - list records for a contractor within a date window
- `netlify/functions/contractor-income-record.mjs`
  - create a single income or expense record
- `netlify/functions/contractor-income-verify.mjs`
  - create or update a verification / attestation packet
- `netlify/functions/contractor-income-export.mjs`
  - CSV export for income + expenses + packet metadata
- `netlify/functions/contractor-income-report.mjs`
  - branded printable HTML report for the selected contractor and period
- `public/ContractorIncomeVerification/index.html`
  - standalone admin/operator UI to test the lane before you splice pieces into your real surfaces

## Assumed existing files already in your repo

This pack assumes you already have the same helper files used by Contractor Network:

- `netlify/functions/_lib/neon.mjs`
- `netlify/functions/_lib/auth.mjs`
- `netlify/functions/_lib/resp.mjs`

If your repo paths differ, update the imports inside these new functions.

## Core integration idea

Use `contractor_submissions.id` as the source contractor identity.
That means this new pack attaches financial records to the contractor records you already have.

Main join:

- `contractor_submissions.id`
- `contractor_income_entries.contractor_submission_id`
- `contractor_expense_entries.contractor_submission_id`
- `contractor_verification_packets.contractor_submission_id`

## Fast integration steps

### 1) Run the schema extension

Run:

- `sql/contractor-income-verification-extension.sql`

in Neon after your current `public/ContractorNetwork/neon-schema.sql` has already been applied.

### 2) Copy the functions into your repo

Copy these files into your main Netlify functions folder:

- `netlify/functions/_lib/contractor-income.mjs`
- `netlify/functions/contractor-income-records.mjs`
- `netlify/functions/contractor-income-record.mjs`
- `netlify/functions/contractor-income-verify.mjs`
- `netlify/functions/contractor-income-export.mjs`
- `netlify/functions/contractor-income-report.mjs`

### 3) Confirm helper imports

Inside each function, the imports assume:

- `./_lib/neon.mjs`
- `./_lib/auth.mjs`
- `./_lib/resp.mjs`

If your real repo has these in a different folder, change the import paths once and you are done.

### 4) Add menu entry / route

Add a visible link into your existing left nav / app grid / internal command hub pointing to:

- `/ContractorIncomeVerification/`

If you do not want a new page, pull the forms / JS logic from `public/ContractorIncomeVerification/index.html` and embed them into your existing Contractor Network admin surface.

### 5) Wire the contractor detail view

The best splice point is your existing Contractor Network admin detail panel.

When an admin opens a contractor submission, surface these actions:

- open income ledger
- open expense ledger
- export CSV
- open printable proof packet
- issue/update verification packet

Pass the contractor id into the new lane using:

- query string `?contractor_id=<uuid>`

Example:

- `/ContractorIncomeVerification/?contractor_id=<uuid>`

### 6) Existing surfaces to connect

#### Contractor Network

Use this as the identity + intake + admin-review base.

Add buttons in your contractor row/detail actions for:

- `Open Financials`
- `Export Income Packet`
- `Issue Verification`

#### AE Flow

Optional splice.
Use it only if you want AE/operators to hand off contractor records into this verification lane.

#### Skye Platinum

Optional splice.
Use it only if you want to mirror aggregate totals, executive summaries, or higher-level ledger analytics.

## Endpoint overview

### POST `/.netlify/functions/contractor-income-record`

Create one income or expense record.

Body:

```json
{
  "contractor_submission_id": "uuid",
  "kind": "income",
  "entry_date": "2026-03-13",
  "source_name": "Uber",
  "source_type": "gig_platform",
  "reference_code": "UBER-WEEK-19",
  "gross_amount": 850.25,
  "fee_amount": 120.10,
  "net_amount": 730.15,
  "category": "rideshare",
  "notes": "Weekly payout",
  "proof_url": "https://..."
}
```

Expense example:

```json
{
  "contractor_submission_id": "uuid",
  "kind": "expense",
  "entry_date": "2026-03-13",
  "vendor_name": "Shell",
  "category": "fuel",
  "amount": 74.33,
  "deductible_percent": 100,
  "notes": "Fuel for route work",
  "proof_url": "https://..."
}
```

### GET `/.netlify/functions/contractor-income-records?contractor_submission_id=<uuid>&start=2026-01-01&end=2026-12-31`

Returns contractor details + income rows + expense rows + totals.

### POST `/.netlify/functions/contractor-income-verify`

Creates or updates a verification packet for a period.

### GET `/.netlify/functions/contractor-income-export?contractor_submission_id=<uuid>&start=2026-01-01&end=2026-12-31`

Returns CSV.

### GET `/.netlify/functions/contractor-income-report?contractor_submission_id=<uuid>&start=2026-01-01&end=2026-12-31`

Returns branded printable HTML. Use browser print → Save as PDF.

## Environment / identity notes

This pack uses `requireAdmin(context, req)` in the same style as your existing Contractor Network admin functions.
So it is meant to sit behind your admin lane, not in public open access.

## What this pack does NOT do

- no Plaid / Stripe direct account linking
- no automatic bank ingestion
- no direct PDF binary generation
- no attachment upload endpoint beyond linking to an existing proof URL
- no contractor self-serve auth lane

That is intentional. This is the shortest useful gap-closure pack.

## Recommended next upgrade after this drop-in works

After you get this wired, the next obvious phase is:

- import bank CSV
- import payout CSV from gig platforms
- attach receipt files directly to income/expense entries
- packet signature hash / immutable issue log
- packet QR validation page

That would turn this from strong to predatory. In a good way.
