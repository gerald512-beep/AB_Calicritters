param(
  [switch]$ForceStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-Command {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' is not available in PATH."
  }
}

Require-Command docker
Require-Command kubectl
Require-Command minikube

$statusText = ""
try {
  $statusText = (minikube status | Out-String)
} catch {
  $statusText = ""
}

if ($ForceStart -or ($statusText -notmatch "host:\s+Running")) {
  Write-Host "Starting minikube with Docker driver..."
  minikube start --driver=docker
} else {
  Write-Host "Minikube already running."
}

Write-Host "Enabling ingress addon..."
minikube addons enable ingress | Out-Host

Write-Host "Waiting for ingress controller rollout..."
kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx --timeout=300s

$ip = minikube ip
Write-Host "Minikube is ready. IP: $ip"
kubectl get nodes -o wide
