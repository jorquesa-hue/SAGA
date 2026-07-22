# JK Platform — local environment stack (JK-PLT-EES-001 Appendix H.4).
#
# This stack exercises the jk-platform module contract without any cloud
# provider (ADR-001 is open; the actual local runtime is Docker Compose —
# see infrastructure/compose/docker-compose.yml). It validates inputs and
# renders the environment plan that dev/staging/production stacks will
# consume once provider bindings land.
#
#   terraform init && terraform plan
#
# Remote state, state encryption, and CI identity federation are configured
# per-environment when ADR-001 closes; local state is acceptable here only
# because this stack manages no real resources.

terraform {
  required_version = ">= 1.7.0"
}

variable "environment" {
  type        = string
  description = "Environment name for this stack."
  default     = "local"
}

variable "region" {
  type        = string
  description = "Provider-neutral region identifier (target: Brazil/nearby compliant region, ADR-001)."
  default     = "local-dev"
}

variable "service_cidr" {
  type        = string
  description = "Platform network CIDR."
  default     = "10.42.0.0/16"
}

variable "database_class" {
  type        = string
  description = "Provider-neutral database size label."
  default     = "dev-small"
}

variable "database_storage_gb" {
  type        = number
  description = "Database storage in GiB."
  default     = 20
}

variable "backup_retention_days" {
  type        = number
  description = "Backup retention in days."
  default     = 7
}

variable "cost_center" {
  type        = string
  description = "Cost-center tag for budget alerts."
  default     = "jk-platform-eng"
}

module "jk_platform" {
  source = "../../modules/jk-platform"

  environment           = var.environment
  region                = var.region
  service_cidr          = var.service_cidr
  database_class        = var.database_class
  database_storage_gb   = var.database_storage_gb
  backup_retention_days = var.backup_retention_days
  enable_pitr           = false # local only; §78 forces PITR on in production
  enable_waf            = false # no public ingress locally
  enable_audit_logs     = true

  cost_center = var.cost_center

  tags = {
    workspace = "local"
  }
}

output "environment_plan" {
  description = "Rendered environment plan for the local stack (naming, tags, network, database, security)."
  value = {
    name_prefix   = module.jk_platform.name_prefix
    tags          = module.jk_platform.tags
    network_plan  = module.jk_platform.network_plan
    database_plan = module.jk_platform.database_plan
    security_plan = module.jk_platform.security_plan
  }
}

output "managed_services" {
  description = "§75 managed-service inventory awaiting ADR-001 provider bindings."
  value       = module.jk_platform.managed_services
}
