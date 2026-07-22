# jk-platform Terraform module

Infrastructure contract for JK Platform environments per **JK-PLT-EES-001
§75 (Infrastructure Baseline)** and **Appendix H.4 (Terraform Module
Contract)**.

## Why there are no resources in this module (yet)

The cloud provider and primary region are an **open architecture decision —
ADR-001** ("Cloud provider and primary region: provider-neutral Terraform
interfaces; Brazil/nearby compliant region"). Per the engineering directive,
unresolved vendor/cloud decisions block provider-specific implementation, and
placeholder resources are forbidden.

This module therefore ships the part of the contract that is real today:

- **Validated inputs** (`variables.tf`) — every variable carries a type,
  description, and `validation` block, so environment stacks fail fast on
  bad configuration before any provider exists.
- **Deterministic environment plan** (`main.tf` locals) — naming prefix,
  governance tags (Appendix H.4 tag set), a six-subnet network plan computed
  with `cidrsubnet` from `service_cidr`, a managed-PostgreSQL plan (PITR is
  forced on in `production` per §78), and the edge security posture.
- **Outputs** (`outputs.tf`) — the machine-readable plan that GitOps and the
  future provider bindings consume. No secrets are ever output.

## What lands when ADR-001 closes

Provider bindings are added as submodules consuming the locals above,
covering the §75 minimum: network/VPC + routing + security groups,
Kubernetes (or approved managed container platform, ADR-003), managed
PostgreSQL with backups/PITR, Redis, durable event broker (ADR-004),
object storage, ingress/LB/DNS/certificates/WAF, secret and key management,
container registry, observability stack, backup vault, identity federation
for CI/operators, and budget/cost alerts. The external interface of this
module (variables and outputs) is designed not to change when that happens.

State encryption, remote backends, and CI identity federation are configured
in the environment stacks (`../../environments/`), not here.

## Usage

See `infrastructure/terraform/environments/local/main.tf` for the canonical
Appendix H.4 consumption pattern.

## Inputs

| Name                    | Type          | Description                                                    |
| ----------------------- | ------------- | -------------------------------------------------------------- |
| `environment`           | `string`      | One of `local`, `dev`, `staging`, `production`.                |
| `region`                | `string`      | Provider-neutral region identifier (compliant region per §75). |
| `service_cidr`          | `string`      | IPv4 CIDR (`/20` or larger) for the platform network.          |
| `database_class`        | `string`      | Provider-neutral PostgreSQL size label.                        |
| `database_storage_gb`   | `number`      | 20–65536 GiB.                                                  |
| `backup_retention_days` | `number`      | 1–365 days.                                                    |
| `enable_pitr`           | `bool`        | PITR flag (forced `true` in production, §78).                  |
| `enable_waf`            | `bool`        | WAF/rate-limiting flag (forced `true` in production).          |
| `enable_audit_logs`     | `bool`        | Audit logging flag (forced `true` in production).              |
| `cost_center`           | `string`      | Budget alerting / tagging identifier.                          |
| `tags`                  | `map(string)` | Extra tags; standard governance keys always win.               |

## Outputs

`name_prefix`, `environment`, `region`, `tags`, `network_plan`,
`database_plan`, `security_plan`, `managed_services`.
