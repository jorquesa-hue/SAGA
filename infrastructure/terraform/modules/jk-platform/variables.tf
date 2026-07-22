# JK Platform Terraform module contract (JK-PLT-EES-001 §75, Appendix H.4).
# Inputs are validated here so every future provider binding (ADR-001)
# inherits the same secure, validated interface.

variable "environment" {
  type        = string
  description = "Deployment environment. Drives naming, tagging, and safety defaults."

  validation {
    condition     = contains(["local", "dev", "staging", "production"], var.environment)
    error_message = "environment must be one of: local, dev, staging, production."
  }
}

variable "region" {
  type        = string
  description = "Target region identifier (provider-neutral until ADR-001; Brazil or nearby compliant region per §75, e.g. \"sa-east-1\" or \"southamerica-east1\")."

  validation {
    condition     = length(var.region) >= 2 && can(regex("^[a-z][a-z0-9-]+$", var.region))
    error_message = "region must be a lowercase, dash-separated region identifier."
  }
}

variable "service_cidr" {
  type        = string
  description = "IPv4 CIDR block for the platform VPC/network. Subnet plan is derived deterministically (see outputs.network_plan)."

  validation {
    condition     = can(cidrhost(var.service_cidr, 0)) && can(regex("/", var.service_cidr))
    error_message = "service_cidr must be a valid IPv4 CIDR block (e.g. 10.42.0.0/16)."
  }

  validation {
    condition     = tonumber(split("/", var.service_cidr)[1]) <= 20
    error_message = "service_cidr must be /20 or larger to hold the six-subnet plan (three app + three data subnets)."
  }
}

variable "database_class" {
  type        = string
  description = "Managed PostgreSQL instance class (provider-neutral size label until ADR-001 maps it to a concrete SKU)."

  validation {
    condition     = length(var.database_class) > 0
    error_message = "database_class must not be empty."
  }
}

variable "database_storage_gb" {
  type        = number
  description = "Allocated storage for the managed PostgreSQL instance, in GiB."

  validation {
    condition     = var.database_storage_gb >= 20 && var.database_storage_gb <= 65536
    error_message = "database_storage_gb must be between 20 and 65536."
  }
}

variable "backup_retention_days" {
  type        = number
  description = "Automated backup retention window in days (§78: encrypted, isolated recovery location)."

  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 365
    error_message = "backup_retention_days must be between 1 and 365."
  }
}

variable "enable_pitr" {
  type        = bool
  description = "Enable PostgreSQL point-in-time recovery (§78: MUST be true in production)."
}

variable "enable_waf" {
  type        = bool
  description = "Enable WAF / rate limiting in front of the ingress (§75)."
}

variable "enable_audit_logs" {
  type        = bool
  description = "Enable provider-side audit logging for control-plane and data-plane operations (§75, §79)."
}

variable "cost_center" {
  type        = string
  description = "Cost-center identifier used for budget alerts and resource tagging (§75)."

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,62}$", var.cost_center))
    error_message = "cost_center must be 2-63 chars of lowercase letters, digits, and dashes."
  }
}

variable "tags" {
  type        = map(string)
  description = "Additional tags merged over the standard tag set (standard keys win to keep governance tags authoritative)."
  default     = {}
}
