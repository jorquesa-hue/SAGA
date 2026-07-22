# JK Platform infrastructure module (JK-PLT-EES-001 §75, Appendix H.4).
#
# PROVIDER-NEUTRAL BY DESIGN: the cloud provider and primary region are an
# open decision (ADR-001). This module therefore contains no provider blocks
# and no provider resources. It defines the validated input contract
# (variables.tf), a deterministic environment plan computed with pure
# Terraform functions (locals below), and the outputs that GitOps/deployment
# consume (outputs.tf). When ADR-001 closes, provider bindings are added as
# submodules that consume these locals — the external contract of this
# module does not change. See README.md in this directory.

terraform {
  required_version = ">= 1.7.0"
}

locals {
  # ---------------------------------------------------------------- naming
  name_prefix = "jk-${var.environment}"

  is_production = var.environment == "production"

  # ---------------------------------------------------------------- tagging
  # Standard governance tags (Appendix H.4). Standard keys override caller
  # extras so product/data-classification tagging stays authoritative.
  standard_tags = {
    product     = "jk-platform"
    environment = var.environment
    data_class  = "confidential"
    managed_by  = "terraform"
    cost_center = var.cost_center
  }

  tags = merge(var.tags, local.standard_tags)

  # ---------------------------------------------------------------- network
  # Deterministic six-subnet plan carved from service_cidr with cidrsubnet
  # (pure function, provider-neutral): three application subnets and three
  # data subnets across three availability zones.
  network_plan = {
    vpc_cidr = var.service_cidr
    app_subnets = [
      for i in range(3) : {
        name = "${local.name_prefix}-app-${i}"
        cidr = cidrsubnet(var.service_cidr, 4, i)
        tier = "application"
      }
    ]
    data_subnets = [
      for i in range(3) : {
        name = "${local.name_prefix}-data-${i}"
        cidr = cidrsubnet(var.service_cidr, 4, i + 8)
        tier = "data"
      }
    ]
  }

  # --------------------------------------------------------------- database
  # Managed PostgreSQL plan (§75, §78). PITR is forced on in production
  # regardless of the flag — §78 makes it non-optional there.
  database_plan = {
    engine                = "postgresql"
    engine_major_version  = 16
    extensions            = ["postgis", "pgvector"]
    instance_class        = var.database_class
    storage_gb            = var.database_storage_gb
    backup_retention_days = var.backup_retention_days
    pitr_enabled          = local.is_production ? true : var.enable_pitr
    encrypted_at_rest     = true
    multi_az              = local.is_production
    deletion_protection   = local.is_production
  }

  # ----------------------------------------------------------- edge/ingress
  security_plan = {
    waf_enabled        = local.is_production ? true : var.enable_waf
    audit_logs_enabled = local.is_production ? true : var.enable_audit_logs
    tls_minimum        = "1.2"
    public_ingress     = ["https"]
  }

  # ------------------------------------------------------------ platform set
  # The managed services §75 requires; each entry becomes a provider binding
  # under ADR-001. Documented here as the machine-readable inventory that
  # environment stacks and GitOps consume — not as placeholder resources.
  managed_services = {
    kubernetes      = { required = true, note = "cluster or approved managed container platform (ADR-003)" }
    postgresql      = { required = true, note = "managed, backups + PITR (§78)" }
    redis           = { required = true, note = "ephemeral coordination only" }
    event_broker    = { required = true, note = "durable broker — NATS JetStream hosting model (ADR-004)" }
    object_storage  = { required = true, note = "S3-compatible, versioning + lifecycle protection (§78)" }
    secret_manager  = { required = true, note = "secret and key management (§75)" }
    registry        = { required = true, note = "container registry, immutable digests (Appendix I)" }
    observability   = { required = true, note = "logging, metrics, tracing, alerting, dashboards (§77)" }
    backup_vault    = { required = true, note = "isolated recovery account/location (§78)" }
    identity_fed    = { required = true, note = "identity federation for CI and operators (§75)" }
    budget_alerts   = { required = true, note = "budget/cost alerts + resource tagging (§75)" }
    dns_ingress_tls = { required = true, note = "ingress/LB, DNS, certificates, WAF/rate limiting (§75)" }
  }
}
