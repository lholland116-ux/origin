# LVTChat M9-CS4A Image-Editing Qualification Harness

This directory contains the contract, fixed matrix, result schema, and dry-run
orchestrator for supplier/model qualification. It is intentionally separate
from the application runtime.

## Controlled candidates

The manifest contains exactly these declared qualification references, in this
order:

1. Runware — FLUX.2 [klein] 4B — `runware:400@4`
2. Runware — Qwen-Image-Edit-2511 — `alibaba:qwen-image-edit@2511`
3. fal — FLUX.2 Flash Edit — `fal-ai/flux-2/flash/edit`
4. Replicate — FLUX.1 Kontext Dev — `black-forest-labs/flux-kontext-dev`

These are qualification references only. They are not trusted executable API
identifiers. Each supplier's current API documentation and model identifier
must be re-verified before any real provider-call adapter is implemented.

## Matrix accounting

The fixed matrix has five source-image slots and six logical task categories:

1. object removal
2. localized object addition/replacement
3. color/material change
4. background/environment edit
5. identity-preserving subject/clothing edit
6. sequential multi-edit stability

This produces 120 logical scenarios:

```text
5 sources × 6 tasks × 4 candidates = 120 scenarios
```

The sequential task is a true three-step chain. Step 1 consumes the original
fixture; step 2 consumes step 1 output; step 3 consumes step 2 output. It is
not reset to the original. Therefore eventual live execution contains:

```text
5 single-step tasks + 3 sequential steps = 8 invocations per source/candidate pair
```

For each candidate/source pair, tasks 01–05 contribute five invocations and
task 06 contributes three invocations: 40 invocations per candidate and 160
eventual provider invocations overall.

## Dry-run only

The current runner uses only the Node.js standard library. It has no
application imports, provider SDK imports, HTTP client, `fetch`, Supabase
access, Storage access, quota access, chat access, or production configuration
access. It makes no provider calls.

Run it with either command:

```text
node scripts/qualification/image-editing/run.mjs
node scripts/qualification/image-editing/run.mjs --dry-run --run-id local-check
```

The default and explicit modes are dry-run. Any unsupported option, including
live execution, provider selection, endpoint selection, or arbitrary candidate
selection, fails closed with a non-zero exit status.

The result is written only below:

```text
.local/qualification/image-editing/<run-id>/result.json
.local/qualification/image-editing/<run-id>/raw/
```

Dry-run invocations are marked `not_run`. Latency, provider request IDs,
provider cost, hashes, output artifacts, and raw output references remain
`null`; the harness does not invent execution evidence. Raw outputs and result
metadata have separate paths for the future live phase.

## Evaluation and later live phase

The result schema uses an explicit 1–5 integer scale for instruction adherence,
untouched-content preservation, visual quality, identity preservation, and
sequential-edit stability. A result may remain unevaluated until a manual
reviewer scores the artifacts and records notes.

The later live phase requires separately approved, dedicated qualification
credentials. It must re-verify supplier documentation, add isolated provider
adapters, and retain the same fixed candidate/matrix ordering. It must never
use application production credentials, create chat messages, reserve user
quota, write image-edit lineage, access production Storage, or call a
production API route.

Actual source fixtures, raw outputs, and result files must not be committed
unless they have been explicitly reviewed and approved as qualification
evidence.
