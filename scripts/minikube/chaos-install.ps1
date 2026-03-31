param(
  [string]$ChaosNamespace = "chaos-mesh"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-Command {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' is not available in PATH."
  }
}

function Ensure-HelmInPath {
  if (Get-Command helm -ErrorAction SilentlyContinue) {
    return
  }

  $helmPath = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter helm.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $helmPath) {
    throw "Helm was not found in PATH or under the WinGet package directory."
  }

  $env:PATH = "$(Split-Path $helmPath);$env:PATH"
}

Require-Command kubectl
Require-Command minikube
Ensure-HelmInPath
Require-Command helm

$runtimeVersion = kubectl get node -o jsonpath="{.items[0].status.nodeInfo.containerRuntimeVersion}"
$runtime = "containerd"
$socketPath = "/run/containerd/containerd.sock"
if ($runtimeVersion -match "^docker://") {
  $runtime = "docker"
  $socketPath = "/var/run/docker.sock"
}

Write-Host "Detected runtime: $runtimeVersion"
Write-Host "Installing Chaos Mesh with runtime=$runtime socket=$socketPath"

helm repo add chaos-mesh https://charts.chaos-mesh.org 2>$null | Out-Null
helm repo update | Out-Host
helm upgrade --install chaos-mesh chaos-mesh/chaos-mesh `
  --namespace $ChaosNamespace `
  --create-namespace `
  --set dashboard.create=false `
  --set controllerManager.replicaCount=1 `
  --set chaosDaemon.runtime=$runtime `
  --set chaosDaemon.socketPath=$socketPath `
  --wait --timeout 10m | Out-Host

kubectl get pods -n $ChaosNamespace -o wide
