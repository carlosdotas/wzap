output "cloud_run_url" {
  description = "URL do serviço Cloud Run (dashboard do WZAP)"
  value       = google_cloud_run_v2_service.app.uri
}

output "nat_ip" {
  description = "IP fixo de saída do NAT (este IP aparece para o WhatsApp)"
  value       = google_compute_address.nat_ip.address
}

output "vpn_server_ip" {
  description = "IP público do servidor WireGuard VPN"
  value       = google_compute_address.vpn_ip.address
}

output "artifact_registry_repo" {
  description = "URL do repositório de imagens Docker"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${var.app_name}"
}

output "docker_image_url" {
  description = "URL completa da imagem Docker"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${var.app_name}/${var.app_name}:latest"
}

output "cloud_run_sa_email" {
  description = "Email da Service Account do Cloud Run"
  value       = google_service_account.cloud_run_sa.email
}

output "vpn_server_name" {
  description = "Nome da VM do servidor VPN (para SSH via gcloud)"
  value       = google_compute_instance.vpn_server.name
}

output "next_steps" {
  description = "Próximos passos após o terraform apply"
  value       = <<-EOT
    ✅ Infraestrutura criada com sucesso!

    📋 Próximos passos:

    1. Configure o cliente WireGuard:
       ssh ${google_compute_address.vpn_ip.address} (ou: gcloud compute ssh ${var.app_name}-vpn --zone=${var.region}-a)
       cat /etc/wireguard/client.conf  # Copie e use no seu cliente WireGuard

    2. Build e deploy da imagem Docker:
       cd ../..
       ./deploy/deploy.sh ${var.project_id} ${var.region} ${var.app_name}

    3. Acesse o dashboard:
       ${google_cloud_run_v2_service.app.uri}
       (ou via VPN: conecte ao WireGuard e acesse pelo IP interno)

    4. IP fixo para o WhatsApp (configure whitelist se necessário):
       ${google_compute_address.nat_ip.address}
  EOT
}
