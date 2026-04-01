# Terraform configuration for GCE VM (W1)
# Provisions the VM, network, firewall, and static IP.

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP zone"
  type        = string
  default     = "us-central1-a"
}

variable "machine_type" {
  description = "VM machine type (minimum e2-standard-4 for 10+ containers)"
  type        = string
  default     = "e2-standard-4"
}

variable "domain_suffix" {
  description = "Domain suffix for app URLs"
  type        = string
  default     = "agent.example.com"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Static IP for the VM
resource "google_compute_address" "daemon" {
  name   = "gemini-daemon-ip"
  region = var.region
}

# VPC network
resource "google_compute_network" "daemon" {
  name                    = "gemini-daemon-network"
  auto_create_subnetworks = true
}

# Firewall: allow HTTPS (443) and SSH (22)
resource "google_compute_firewall" "allow_https" {
  name    = "gemini-allow-https"
  network = google_compute_network.daemon.name

  allow {
    protocol = "tcp"
    ports    = ["443", "80"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["gemini-daemon"]
}

resource "google_compute_firewall" "allow_ssh" {
  name    = "gemini-allow-ssh"
  network = google_compute_network.daemon.name

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["0.0.0.0/0"]  # Restrict in production
  target_tags   = ["gemini-daemon"]
}

# Service account for Cloud Logging and DNS
resource "google_service_account" "daemon" {
  account_id   = "gemini-daemon"
  display_name = "Gemini CLI Daemon"
}

resource "google_project_iam_member" "logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.daemon.email}"
}

resource "google_project_iam_member" "dns" {
  project = var.project_id
  role    = "roles/dns.admin"
  member  = "serviceAccount:${google_service_account.daemon.email}"
}

# Compute instance
resource "google_compute_instance" "daemon" {
  name         = "gemini-daemon"
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["gemini-daemon"]

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size  = 50  # GB
      type  = "pd-ssd"
    }
  }

  network_interface {
    network = google_compute_network.daemon.name
    access_config {
      nat_ip = google_compute_address.daemon.address
    }
  }

  service_account {
    email  = google_service_account.daemon.email
    scopes = ["cloud-platform"]
  }

  metadata_startup_script = file("${path.module}/../setup-vm.sh")

  metadata = {
    domain-suffix = var.domain_suffix
  }
}

output "vm_ip" {
  value       = google_compute_address.daemon.address
  description = "Static IP of the daemon VM"
}

output "vm_name" {
  value = google_compute_instance.daemon.name
}
