# Cove Agent Guide

Before changing this repository, read [`docs/README.md`](docs/README.md) and follow its authority order.

## Required workflow

1. Read the product definition, architecture overview, relevant behavior docs, and current task Spec.
2. Distinguish current facts from planned behavior. Draft capabilities must not be described as implemented.
3. For behavior, API, data, security, deployment, or integration changes, create or update a Spec before implementation.
4. Do not implement a `Draft` Spec. Implementation starts only after the maintainer changes it to `Approved` or `In Progress`.
5. Work from the Spec's `tasks.md`, keep requirement IDs intact, and record verification evidence.
6. On completion, update long-term docs and mark the Spec `Completed`; do not leave stable behavior only in an old Spec.

Simple copy edits, local style fixes, and refactors with no behavior change do not require a new Spec, but still require proportionate verification.

Never commit secrets, `.env` files, credentials, private keys, database dumps, or raw external-provider responses.
