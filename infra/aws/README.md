# Arik on AWS

**Status:** plan. Nothing here is created yet. No real patient data until every item in the readiness checklist is checked.

## Why this shape

- One small server running everything in Docker keeps cost near $60 to $150/month at pilot scale.
- AWS signs a Business Associate Addendum (BAA) through AWS Artifact at no extra cost, which covers HIPAA-eligible services (EC2, EBS, S3, Bedrock, SSM, CloudWatch, among others; confirm the current eligible list before use).
- Self-hosting Supabase avoids the hosted plan's BAA price while keeping the same schema, RLS, auth and storage the app already uses.

## Target architecture (Stage 2 hosting)

```
Internet ── 443 ──> EC2 (Ubuntu LTS, encrypted EBS)
                     ├─ Caddy (TLS, reverse proxy)
                     ├─ arik-app (this repo's Dockerfile, port 3000, internal)
                     └─ Supabase self-hosted (Postgres, Auth, REST, Storage, Studio)
                          Postgres + Studio bound to localhost only
                     │
                     ├─> S3 (nightly encrypted backups, uploads archive if needed)
                     ├─> SSM Parameter Store (all secrets)
                     ├─> CloudWatch (logs, health alarms)
                     └─> Amazon Bedrock (Claude, under the AWS BAA)
                          or Anthropic API under its own BAA
```

- Admin access through AWS Systems Manager Session Manager. No public SSH.
- Security group: inbound 80/443 only.
- Instance size: start around 4 GB RAM (Supabase's container set needs headroom); resize later.

## Environments

| Env | Database | AI provider | Real patient data |
| --- | --- | --- | --- |
| Local | `supabase start` | OpenRouter | Never |
| Staging (optional) | Self-hosted on a small EC2 | OpenRouter or Bedrock | Never |
| Production | Self-hosted on EC2 under the BAA | Bedrock or Anthropic with BAA | Only after the checklist |

## Runbook (first deploy)

1. Accept the AWS BAA in AWS Artifact. Turn on MFA for the root user; create an admin IAM user or SSO.
2. Create the EC2 instance with encrypted EBS, an IAM role allowing SSM, S3 (backup bucket only) and Bedrock invoke.
3. Create the S3 backup bucket: block public access, default encryption, versioning, lifecycle rule.
4. Put every secret from `lib/env.ts` in SSM Parameter Store as SecureString.
5. On the instance: install Docker, clone the repo, run `infra/aws/scripts/load_secrets.sh`.
6. Build the app image with the `NEXT_PUBLIC_*` build args, or pull the CI image.
7. `docker compose -f infra/aws/docker-compose.prod.yml up -d`.
8. Apply the database: schema, migrations, seeds (the `db:reset` flow from Appendix B1, pointed at the server).
9. Point DNS at the instance; Caddy issues the certificate.
10. `curl https://<domain>/api/health?db=1` returns 200.
11. Install the backup cron; run one backup and one restore into a scratch database.
12. CloudWatch alarm on the health check and on instance status.

## Readiness checklist (all must be true before real patient data)

- [ ] AWS BAA accepted
- [ ] AI provider for patient data is covered by a BAA (Bedrock under AWS, or Anthropic direct); OpenRouter disabled in production
- [ ] Every API route session-guarded with ownership tests (spec M01)
- [ ] Postgres and Studio not reachable from the internet
- [ ] Secrets only in SSM; none in the image, repo or logs
- [ ] Encrypted EBS and encrypted S3 backups; restore tested
- [ ] Upload malware scanner configured (uploads fail closed without it)
- [ ] Raw upload purge job scheduled and verified
- [ ] Logs proven free of PHI, prices and secrets
- [ ] Privacy policy, terms, Washington health data consent and the not-legal-advice notice live and recorded
- [ ] Breach response plan written
- [ ] Mail/fax vendor (if used) under a BAA

## Cost notes (estimates, verify before buying)

- EC2 instance plus EBS: the largest line item.
- S3 backups: small at pilot scale.
- Bedrock: pay per token, similar to direct API pricing; confirm current Claude model availability in the chosen region.
- AWS Activate credits can offset early months; decision pending.
