terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # Descomente para usar backend remoto no GCS
  # backend "gcs" {
  #   bucket = "seu-bucket-terraform-state"
  #   prefix = "wzap/terraform.tfstate"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ─────────────────────────────────────────
# APIs necessárias
# ─────────────────────────────────────────

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "vpcaccess.googleapis.com",
    "compute.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

# ─────────────────────────────────────────
# Rede VPC
# ─────────────────────────────────────────

resource "google_compute_network" "vpc" {
  name                    = "${var.app_name}-vpc"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "subnet" {
  name          = "${var.app_name}-subnet"
  ip_cidr_range = var.vpc_subnet_cidr
  region        = var.region
  network       = google_compute_network.vpc.id

  private_ip_google_access = true
}

# ─────────────────────────────────────────
# Cloud Router + NAT com IP estático
# (WhatsApp sempre verá o mesmo IP de saída)
# ─────────────────────────────────────────

resource "google_compute_router" "router" {
  name    = "${var.app_name}-router"
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_address" "nat_ip" {
  name   = "${var.app_name}-nat-ip"
  region = var.region
}

resource "google_compute_router_nat" "nat" {
  name                               = "${var.app_name}-nat"
  router                             = google_compute_router.router.name
  region                             = var.region
  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = [google_compute_address.nat_ip.self_link]
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = false
    filter = "ERRORS_ONLY"
  }
}

# ─────────────────────────────────────────
# VPC Access Connector (Cloud Run → VPC)
# ─────────────────────────────────────────

resource "google_vpc_access_connector" "connector" {
  name          = "${var.app_name}-connector"
  region        = var.region
  ip_cidr_range = var.vpc_connector_cidr
  network       = google_compute_network.vpc.name
  min_instances = 2
  max_instances = 3

  depends_on = [google_project_service.apis]
}

# ─────────────────────────────────────────
# Artifact Registry (imagens Docker)
# ─────────────────────────────────────────

resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = var.app_name
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}

# ─────────────────────────────────────────
# Cloud Run Service
# ─────────────────────────────────────────

resource "google_cloud_run_v2_service" "app" {
  name     = var.app_name
  location = var.region

  template {
    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "ALL_TRAFFIC" # todo tráfego sai pelo NAT (IP fixo)
    }

    scaling {
      min_instance_count = var.cloud_run_min_instances
      max_instance_count = var.cloud_run_max_instances
    }

    # WhatsApp requer 1 instância por sessão
    max_instance_request_concurrency = 80

    timeout = "3600s" # 1 hora (sessões longas do WhatsApp)

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.app_name}/${var.app_name}:${var.image_tag}"

      ports {
        container_port = 8080
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      resources {
        limits = {
          cpu    = var.cloud_run_cpu
          memory = var.cloud_run_memory
        }
        cpu_idle          = false # mantém CPU sempre ativa (evita coldstart)
        startup_cpu_boost = true
      }

      startup_probe {
        http_get {
          path = "/health"
          port = 8080
        }
        initial_delay_seconds = 30
        timeout_seconds       = 10
        period_seconds        = 10
        failure_threshold     = 6
      }

      liveness_probe {
        http_get {
          path = "/health"
          port = 8080
        }
        initial_delay_seconds = 60
        timeout_seconds       = 5
        period_seconds        = 30
        failure_threshold     = 3
      }
    }

    service_account = google_service_account.cloud_run_sa.email
  }

  depends_on = [
    google_vpc_access_connector.connector,
    google_artifact_registry_repository.repo,
    google_project_service.apis,
  ]
}

# Acesso público ao Cloud Run (dashboard web)
# Se restrict_dashboard_to_vpn = true, remova este recurso e acesse só pela VPN
resource "google_cloud_run_v2_service_iam_member" "public_access" {
  count    = var.restrict_dashboard_to_vpn ? 0 : 1
  project  = google_cloud_run_v2_service.app.project
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─────────────────────────────────────────
# Service Account do Cloud Run
# ─────────────────────────────────────────

resource "google_service_account" "cloud_run_sa" {
  account_id   = "${var.app_name}-run-sa"
  display_name = "WZAP Cloud Run Service Account"
}

resource "google_project_iam_member" "cloud_run_sa_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

resource "google_project_iam_member" "cloud_run_sa_metric_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

resource "google_artifact_registry_repository_iam_member" "cloud_run_sa_ar_reader" {
  location   = google_artifact_registry_repository.repo.location
  repository = google_artifact_registry_repository.repo.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# ─────────────────────────────────────────
# Servidor VPN WireGuard (VM pequena)
# ─────────────────────────────────────────

resource "google_compute_address" "vpn_ip" {
  name   = "${var.app_name}-vpn-ip"
  region = var.region
}

resource "google_compute_instance" "vpn_server" {
  name         = "${var.app_name}-vpn"
  machine_type = var.vpn_machine_type
  zone         = "${var.region}-a"

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 10
      type  = "pd-standard"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.subnet.id
    access_config {
      nat_ip = google_compute_address.vpn_ip.address
    }
  }

  metadata = {
    startup-script = templatefile("${path.module}/wireguard-startup.sh.tpl", {
      vpn_server_ip  = google_compute_address.vpn_ip.address
      vpn_cidr       = var.vpn_tunnel_cidr
      vpc_cidr       = var.vpc_subnet_cidr
    })
  }

  tags = ["vpn-server", "wzap"]

  service_account {
    scopes = ["logging-write", "monitoring"]
  }

  depends_on = [google_compute_subnetwork.subnet]
}

# ─────────────────────────────────────────
# Firewall Rules
# ─────────────────────────────────────────

# WireGuard VPN (UDP 51820)
resource "google_compute_firewall" "allow_wireguard" {
  name    = "${var.app_name}-allow-wireguard"
  network = google_compute_network.vpc.name

  allow {
    protocol = "udp"
    ports    = ["51820"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["vpn-server"]
}

# SSH para o servidor VPN (restrinja ao seu IP em produção!)
resource "google_compute_firewall" "allow_ssh_vpn" {
  name    = "${var.app_name}-allow-ssh-vpn"
  network = google_compute_network.vpc.name

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = var.allowed_ssh_cidrs
  target_tags   = ["vpn-server"]
}

# Tráfego interno da VPC
resource "google_compute_firewall" "allow_internal" {
  name    = "${var.app_name}-allow-internal"
  network = google_compute_network.vpc.name

  allow {
    protocol = "tcp"
  }
  allow {
    protocol = "udp"
  }
  allow {
    protocol = "icmp"
  }

  source_ranges = [var.vpc_subnet_cidr, var.vpn_tunnel_cidr]
}

# Health checks do Google (necessário para Cloud Run + Load Balancer)
resource "google_compute_firewall" "allow_health_checks" {
  name    = "${var.app_name}-allow-health-checks"
  network = google_compute_network.vpc.name

  allow {
    protocol = "tcp"
  }

  source_ranges = ["130.211.0.0/22", "35.191.0.0/16"]
}
