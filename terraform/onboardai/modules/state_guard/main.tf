# Fails the plan when the selected Terraform workspace, which decides the state
# object a plan reads and writes, does not belong to the environment the inputs
# describe. production lives in the default workspace, so its state stays at
# onboardai/default.tfstate; any other environment lives in the workspace of
# its own name (onboardai/<name>.tfstate). It manages no resource, so it adds
# nothing to either state. Tested in tests/state_guard.tftest.hcl.

variable "environment" {
  description = "var.environment of the root module."
  type        = string
}

variable "workspace" {
  description = "terraform.workspace of the root module."
  type        = string
}

locals {
  expected_workspace = var.environment == "production" ? "default" : var.environment
}

output "workspace" {
  description = "The selected workspace, once it is known to belong to the environment."
  value       = var.workspace

  precondition {
    condition     = var.workspace == local.expected_workspace
    error_message = "environment = \"${var.environment}\" belongs to workspace \"${local.expected_workspace}\", but workspace \"${var.workspace}\" is selected. Select the right one (terraform workspace select ${local.expected_workspace}) or pass the other environment's tfvars; see terraform/onboardai/README.md, Staging."
  }
}
