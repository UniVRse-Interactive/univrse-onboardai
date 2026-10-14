# Images: <region>-docker.pkg.dev/<project>/onboardai/<web|api|tts>:<git-sha>
resource "google_artifact_registry_repository" "onboardai" {
  location      = var.region
  repository_id = local.repository_id
  format        = "DOCKER"
  description   = "OnboardAi Cloud Run images (web, api, tts), tagged with the git commit SHA."
  labels        = merge(local.labels, { component = "images" })

  # Tags stay mutable so a re-run of the deploy workflow for the same commit can
  # push the same SHA tag again.
  docker_config {
    immutable_tags = false
  }

  # Caps storage: the newest var.images_to_keep versions of each image are kept
  # (rollback targets); every other version is deleted once it is a day old. KEEP
  # wins over DELETE. Cleanup runs in the background about once a day.
  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-newest-versions"
    action = "KEEP"

    most_recent_versions {
      keep_count = var.images_to_keep
    }
  }

  cleanup_policies {
    id     = "delete-older-versions"
    action = "DELETE"

    condition {
      tag_state  = "ANY"
      older_than = "86400s"
    }
  }

  depends_on = [google_project_service.required]
}
