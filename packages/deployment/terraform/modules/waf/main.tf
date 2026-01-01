# AWS WAF Module for RPC DDoS Protection
# Provides rate limiting and common attack protection at the edge

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "enabled" {
  description = "Enable WAF (recommended for production)"
  type        = bool
  default     = true
}

variable "rate_limit" {
  description = "Rate limit per 5 minutes per IP"
  type        = number
  default     = 10000
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

locals {
  name_prefix = "jeju-${var.environment}-rpc"
}

# WAF Web ACL
resource "aws_wafv2_web_acl" "rpc" {
  count = var.enabled ? 1 : 0

  name  = "${local.name_prefix}-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  # Rule 0: Allow DWS API endpoints without strict inspection
  # These endpoints handle worker deployment and require large JSON bodies
  rule {
    name     = "AllowDWSEndpoints"
    priority = 0

    action {
      allow {}
    }

    statement {
      or_statement {
        statement {
          byte_match_statement {
            search_string = "/workerd"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
            positional_constraint = "STARTS_WITH"
          }
        }
        statement {
          byte_match_statement {
            search_string = "/compute"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
            positional_constraint = "STARTS_WITH"
          }
        }
        statement {
          byte_match_statement {
            search_string = "/storage"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
            positional_constraint = "STARTS_WITH"
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-dws-allow"
      sampled_requests_enabled   = true
    }
  }

  # Rule 1: Rate limiting per IP
  rule {
    name     = "RateLimitPerIP"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  # Rule 2: AWS Managed Rules - Core Rule Set
  # Exclude DWS endpoints from body size and SQL injection checks (they have large JSON payloads)
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"

        # Exclude rules that block large request bodies and encoded payloads
        rule_action_override {
          action_to_use {
            count {}
          }
          name = "SizeRestrictions_BODY"
        }
        rule_action_override {
          action_to_use {
            count {}
          }
          name = "CrossSiteScripting_BODY"
        }
        rule_action_override {
          action_to_use {
            count {}
          }
          name = "GenericLFI_BODY"
        }
        rule_action_override {
          action_to_use {
            count {}
          }
          name = "RestrictedExtensions_BODY"
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-common-rules"
      sampled_requests_enabled   = true
    }
  }

  # Rule 3: AWS Managed Rules - Known Bad Inputs
  # Exclude rules that may block base64-encoded code in worker payloads
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"

        # Override to count-only for rules that may trigger on worker code
        rule_action_override {
          action_to_use {
            count {}
          }
          name = "Log4JRCE_BODY"
        }
        rule_action_override {
          action_to_use {
            count {}
          }
          name = "JavaDeserializationRCE_BODY"
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  # Rule 4: AWS Managed Rules - Anonymous IP List
  rule {
    name     = "AWSManagedRulesAnonymousIpList"
    priority = 4

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAnonymousIpList"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-anonymous-ip"
      sampled_requests_enabled   = true
    }
  }

  # Rule 5: Block IPs with high request rates to specific RPC methods
  rule {
    name     = "BlockHighRateRPCMethods"
    priority = 5

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 2000 # Lower limit for heavy methods
        aggregate_key_type = "IP"

        scope_down_statement {
          byte_match_statement {
            search_string = "eth_getLogs"
            field_to_match {
              body {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
            positional_constraint = "CONTAINS"
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-heavy-methods"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name_prefix}-waf"
    sampled_requests_enabled   = true
  }

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-waf"
    Environment = var.environment
  })
}

# CloudWatch Log Group for WAF logs
# WAF requires log group names to start with "aws-waf-logs-"
resource "aws_cloudwatch_log_group" "waf" {
  count = var.enabled ? 1 : 0

  name              = "aws-waf-logs-${local.name_prefix}"
  retention_in_days = 30

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-waf-logs"
    Environment = var.environment
  })
}

# WAF Logging Configuration
resource "aws_wafv2_web_acl_logging_configuration" "rpc" {
  count = var.enabled ? 1 : 0

  resource_arn            = aws_wafv2_web_acl.rpc[0].arn
  log_destination_configs = [aws_cloudwatch_log_group.waf[0].arn]

  redacted_fields {
    single_header {
      name = "authorization"
    }
  }

  depends_on = [aws_cloudwatch_log_group.waf]
}

# Outputs
output "web_acl_arn" {
  description = "WAF Web ACL ARN"
  value       = var.enabled ? aws_wafv2_web_acl.rpc[0].arn : ""
}

output "web_acl_id" {
  description = "WAF Web ACL ID"
  value       = var.enabled ? aws_wafv2_web_acl.rpc[0].id : ""
}


