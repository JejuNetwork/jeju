# Terraform backend configuration
# Initialize with: terraform init -backend-config=environments/<env>/backend.tfvars

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.24"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
    vault = {
      source  = "hashicorp/vault"
      version = "~> 3.25"
    }
  }

  backend "s3" {
    # Configuration provided via backend.tfvars:
    # bucket         = "jeju-terraform-state-<env>"
    # key            = "terraform.tfstate"
    # region         = "us-east-1"
    # encrypt        = true
    # dynamodb_table = "jeju-terraform-locks-<env>"
  }
}


