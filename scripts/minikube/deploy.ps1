param(
  [string]$Namespace = "ab-calicritters",
  [string]$HostName = "ab-calicritters.local",
  [switch]$SkipImageBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-DatabaseUrlFromEnvFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path $Path)) {
    throw "Missing env file at '$Path'."
  }

  $line = Get-Content $Path | Where-Object { $_ -match "^DATABASE_URL=" } | Select-Object -First 1
  if (-not $line) {
    throw "DATABASE_URL not found in '$Path'."
  }

  $value = $line.Substring("DATABASE_URL=".Length).Trim()
  if (
    ($value.StartsWith('"') -and $value.EndsWith('"')) -or
    ($value.StartsWith("'") -and $value.EndsWith("'"))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  return $value
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location $repoRoot
try {
  if (-not $SkipImageBuild) {
    Write-Host "Building assignment-api image..."
    minikube image build -t ab-calicritters/assignment-api:local -f packages/api/Dockerfile.assignment .
    Write-Host "Building events-api stable image..."
    minikube image build -t ab-calicritters/events-api:stable -f packages/api/Dockerfile.events .
    Write-Host "Building events-api canary image..."
    minikube image build -t ab-calicritters/events-api:canary -f packages/api/Dockerfile.events .
  } else {
    Write-Host "Skipping image build."
  }

  kubectl apply -f infra/k8s/namespace.yaml

  $databaseUrl = Get-DatabaseUrlFromEnvFile ".env"
  kubectl create secret generic ab-calicritters-secrets `
    --namespace $Namespace `
    --from-literal=DATABASE_URL="$databaseUrl" `
    --dry-run=client -o yaml | kubectl apply -f -

  kubectl apply -f infra/k8s/assignment-api-deployment.yaml
  kubectl apply -f infra/k8s/assignment-api-service.yaml
  kubectl apply -f infra/k8s/events-api-deployment.yaml
  kubectl apply -f infra/k8s/events-api-service.yaml
  kubectl apply -f infra/k8s/events-api-canary-deployment.yaml
  kubectl apply -f infra/k8s/events-api-canary-service.yaml
  kubectl apply -f infra/k8s/ingress.yaml
  kubectl apply -f infra/k8s/ingress-canary.yaml

  kubectl rollout status deployment/assignment-api -n $Namespace --timeout=300s
  kubectl rollout status deployment/events-api -n $Namespace --timeout=300s
  kubectl rollout status deployment/events-api-canary -n $Namespace --timeout=300s

  kubectl get pods -n $Namespace -o wide
  kubectl get svc -n $Namespace
  kubectl get ingress -n $Namespace

  $ip = minikube ip
  Write-Host ""
  Write-Host "Deployment complete."
  Write-Host "Ingress host: $HostName"
  Write-Host "Minikube IP: $ip"
  Write-Host "Example check:"
  Write-Host "  curl --resolve $HostName`:80`:$ip http://$HostName/health"
} finally {
  Pop-Location
}
