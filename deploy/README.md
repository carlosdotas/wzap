# WZAP - Deploy no Google Cloud com VPN

Arquitetura do deploy:

```
Você (PC/Celular)
      │
      │ WireGuard VPN
      ▼
┌─────────────────────────────────────┐
│         Google Cloud VPC            │
│                                     │
│  ┌─────────────┐   ┌─────────────┐ │
│  │ WireGuard   │   │  Cloud Run  │ │
│  │ VM (e2-micro│   │  (WZAP App) │ │
│  │ IP fixo)    │   │             │ │
│  └─────────────┘   └──────┬──────┘ │
│                            │        │
│                     VPC Connector   │
│                            │        │
│                    ┌───────▼──────┐ │
│                    │  Cloud NAT   │ │
│                    │ (IP fixo de  │ │
│                    │   saída)     │ │
│                    └──────────────┘ │
└─────────────────────────────────────┘
                        │
                        │ IP fixo → WhatsApp
                        ▼
                    Internet
```

**Componentes:**
- **WireGuard VPN**: VM pequena (e2-micro, ~free tier) com IP fixo. Você se conecta a ela para acessar a rede interna.
- **Cloud Run**: Roda o bot do WhatsApp. Com `min-instances=1`, a sessão fica sempre ativa.
- **Cloud NAT + IP Estático**: Todo tráfego de saída usa um IP fixo. O WhatsApp sempre verá o mesmo IP.
- **VPC Connector**: Conecta o Cloud Run à rede VPC privada.

---

## Pré-requisitos

- [Google Cloud CLI (gcloud)](https://cloud.google.com/sdk/docs/install)
- [Terraform >= 1.5](https://developer.hashicorp.com/terraform/downloads)
- [Docker](https://docs.docker.com/get-docker/)
- Projeto no Google Cloud com faturamento ativado

---

## 1. Provisionar a Infraestrutura (Terraform)

```bash
cd deploy/terraform

# Copie e edite as variáveis
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars  # preencha o project_id

# Inicializa e aplica
terraform init
terraform plan
terraform apply
```

O Terraform vai criar todos os recursos e no final mostrar os **outputs** com os IPs e a URL do serviço.

---

## 2. Conectar à VPN (WireGuard)

Após o `terraform apply`, o servidor VPN é configurado automaticamente.

```bash
# 1. Acesse o servidor VPN via SSH
gcloud compute ssh wzap-vpn --zone=southamerica-east1-a

# 2. Pegue a configuração do cliente
sudo cat /etc/wireguard/client1.conf

# 3. No seu PC/Mac: instale WireGuard e importe o client1.conf
# No celular: escaneie o QR code exibido na inicialização da VM
#   sudo cat /etc/wireguard/client1.conf | qrencode -t ansiutf8
```

**Clientes WireGuard:**
- **Windows/Mac/Linux**: [wireguard.com/install](https://www.wireguard.com/install/)
- **Android/iOS**: WireGuard na app store

---

## 3. Deploy da Aplicação

```bash
# Volte à raiz do projeto
cd ../..

# Deploy (build + push + deploy no Cloud Run)
./deploy/deploy.sh SEU_PROJECT_ID
```

Ou com todos os parâmetros:
```bash
./deploy/deploy.sh <project-id> <region> <app-name> <image-tag>
```

---

## 4. Acessar o Dashboard

Após o deploy, você terá dois modos de acesso:

| Modo | Como | Quando usar |
|------|------|-------------|
| **Público** | URL do Cloud Run direto | Desenvolvimento, sem dados sensíveis |
| **Via VPN** | Conecte ao WireGuard → acesse o IP interno da VM | Produção, acesso seguro |

A URL do Cloud Run fica disponível no output do Terraform e no final do `deploy.sh`.

---

## Manutenção

### Ver logs em tempo real
```bash
gcloud run services logs tail wzap --region=southamerica-east1
```

### Reiniciar o serviço
```bash
gcloud run services update wzap --region=southamerica-east1 --no-traffic
gcloud run services update wzap --region=southamerica-east1 --traffic=100
```

### Adicionar cliente VPN
```bash
# No servidor VPN:
cd /etc/wireguard
sudo wg genkey | tee client2_private.key | wg pubkey > client2_public.key
# Adicione ao wg0.conf e reconfigure (ver README.txt no servidor)
```

### Destruir a infraestrutura
```bash
cd deploy/terraform
terraform destroy
```

---

## Estimativa de Custos (São Paulo - southamerica-east1)

| Recurso | Tipo | Custo aprox./mês |
|---------|------|-----------------|
| Cloud Run | 1 instância sempre ativa, 2vCPU/2GB | ~$30-50 |
| VM WireGuard | e2-micro | ~$6 (ou grátis no free tier) |
| IP Estático (NAT) | 1 IP | ~$3 |
| IP Estático (VPN VM) | 1 IP | ~$3 |
| Artifact Registry | < 1GB | ~$0.10 |
| Tráfego | Depende do uso | Variável |
| **Total estimado** | | **~$42-62/mês** |

> Reduza custos usando `min-instances=0` (mas a sessão WhatsApp vai cair quando não há tráfego).

---

## CI/CD com Cloud Build (opcional)

Para deploy automático a cada push:

```bash
# Cria trigger para o repositório GitHub
gcloud builds triggers create github \
  --name=wzap-deploy \
  --repo-name=wzap \
  --repo-owner=SEU_USUARIO_GITHUB \
  --branch-pattern='^main$' \
  --build-config=deploy/cloudbuild.yaml
```
