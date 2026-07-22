# Outputs consumed by GitOps/deployment (JK-PLT-EES-001 Appendix H.4).
# No secrets are ever emitted here — secret material lives exclusively in
# the secret manager once ADR-001 provider bindings exist.

output "name_prefix" {
  description = "Canonical resource name prefix for this environment."
  value       = local.name_prefix
}

output "environment" {
  description = "Validated environment identifier."
  value       = var.environment
}

output "region" {
  description = "Validated target region identifier."
  value       = var.region
}

output "tags" {
  description = "Merged governance tag set applied to every resource."
  value       = local.tags
}

output "network_plan" {
  description = "Deterministic VPC/subnet plan derived from service_cidr (three app + three data subnets)."
  value       = local.network_plan
}

output "database_plan" {
  description = "Managed PostgreSQL plan (engine, class, storage, backups, PITR — PITR forced on in production per §78)."
  value       = local.database_plan
}

output "security_plan" {
  description = "Edge/ingress security posture (WAF, audit logs, TLS floor — forced on in production)."
  value       = local.security_plan
}

output "managed_services" {
  description = "Inventory of §75-required managed services awaiting provider bindings under ADR-001."
  value       = local.managed_services
}
