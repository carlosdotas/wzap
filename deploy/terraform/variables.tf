variable "project_id" {
  description = "ID do projeto no Google Cloud"
  type        = string
}

variable "region" {
  description = "Região do Google Cloud (ex: southamerica-east1 para São Paulo)"
  type        = string
  default     = "southamerica-east1"
}

variable "app_name" {
  description = "Nome da aplicação (usado para nomear recursos)"
  type        = string
  default     = "wzap"
}

variable "image_tag" {
  description = "Tag da imagem Docker"
  type        = string
  default     = "latest"
}

variable "cloud_run_min_instances" {
  description = "Número mínimo de instâncias do Cloud Run (1 = sempre ligado)"
  type        = number
  default     = 1
}

variable "cloud_run_max_instances" {
  description = "Número máximo de instâncias do Cloud Run"
  type        = number
  default     = 1
}

variable "cloud_run_memory" {
  description = "Memória para o Cloud Run (Chrome precisa de bastante)"
  type        = string
  default     = "2Gi"
}

variable "cloud_run_cpu" {
  description = "CPUs para o Cloud Run"
  type        = string
  default     = "2"
}

variable "vpn_machine_type" {
  description = "Tipo de máquina para o servidor WireGuard VPN"
  type        = string
  default     = "e2-micro"
}

variable "vpc_subnet_cidr" {
  description = "CIDR da subnet principal da VPC"
  type        = string
  default     = "10.0.0.0/24"
}

variable "vpn_tunnel_cidr" {
  description = "CIDR da rede WireGuard (clientes VPN)"
  type        = string
  default     = "10.10.0.0/24"
}

variable "vpc_connector_cidr" {
  description = "CIDR do VPC Connector (não deve sobrepor outras redes)"
  type        = string
  default     = "10.8.0.0/28"
}

variable "allowed_ssh_cidrs" {
  description = "CIDRs com acesso SSH ao servidor VPN (restrinja ao seu IP!)"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "restrict_dashboard_to_vpn" {
  description = "Se true, o dashboard só fica acessível pela VPN"
  type        = bool
  default     = false
}
