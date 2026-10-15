# One root module, two environments (issue #20). Both live in the OnBoard AI
# project and keep their state in the same bucket, one Terraform workspace each:
#
#   environment  workspace  state object                 resource IDs
#   production   default    onboardai/default.tfstate    onboardai-web, onboardai-deployer, ...
#   staging      staging    onboardai/staging.tfstate    onboardai-web-staging, onboardai-deployer-staging, ...
#
# Production keeps the names, labels and addresses it was applied with. Staging
# appends local.name_suffix to every resource ID, adds the label
# environment = staging, and names its Firestore database onboardai-staging
# because a project has only one (default). Project-wide singletons (API
# enablement in main.tf, the Discovery Engine service agent in
# vertex_ai_search.tf) belong to production's state only; staging relies on
# them existing.

locals {
  is_production = var.environment == "production"

  # Appended to every resource ID of a non-production stack.
  name_suffix = local.is_production ? "" : "-${var.environment}"

  # Start of display names, descriptions and alert titles.
  display_name = local.is_production ? "OnboardAi" : "OnboardAi [${var.environment}]"
}

# Refuses any plan whose inputs and state disagree: the selected workspace picks
# the state object, var.environment picks the names, and they must belong
# together. Staging inputs are never planned against production's state, nor
# production inputs against staging's. A module so `terraform test` can check
# the rule for every combination; it creates nothing.
module "state_guard" {
  source = "./modules/state_guard"

  environment = var.environment
  workspace   = terraform.workspace
}
