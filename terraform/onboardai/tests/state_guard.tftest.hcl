# The workspace guard (modules/state_guard), tested directly so the result does
# not depend on the workspace `terraform test` happens to run in. Production's
# state stays in the default workspace (onboardai/default.tfstate); staging's is
# in workspace staging (onboardai/staging.tfstate). Any other pairing must fail
# the plan. tests/onboardai.tftest.hcl checks the root module passes it
# var.environment and terraform.workspace.

run "production_in_default_workspace_plans" {
  command = plan

  module {
    source = "./modules/state_guard"
  }

  variables {
    environment = "production"
    workspace   = "default"
  }

  assert {
    condition     = output.workspace == "default"
    error_message = "Production belongs to the default workspace."
  }
}

run "staging_in_staging_workspace_plans" {
  command = plan

  module {
    source = "./modules/state_guard"
  }

  variables {
    environment = "staging"
    workspace   = "staging"
  }

  assert {
    condition     = output.workspace == "staging"
    error_message = "Staging belongs to the staging workspace."
  }
}

run "staging_inputs_against_production_state_fail" {
  command = plan

  module {
    source = "./modules/state_guard"
  }

  variables {
    environment = "staging"
    workspace   = "default"
  }

  expect_failures = [output.workspace]
}

run "production_inputs_against_staging_state_fail" {
  command = plan

  module {
    source = "./modules/state_guard"
  }

  variables {
    environment = "production"
    workspace   = "staging"
  }

  expect_failures = [output.workspace]
}

run "production_inputs_in_a_workspace_named_production_fail" {
  command = plan

  module {
    source = "./modules/state_guard"
  }

  variables {
    environment = "production"
    workspace   = "production"
  }

  expect_failures = [output.workspace]
}

run "staging_inputs_in_another_workspace_fail" {
  command = plan

  module {
    source = "./modules/state_guard"
  }

  variables {
    environment = "staging"
    workspace   = "dev"
  }

  expect_failures = [output.workspace]
}
