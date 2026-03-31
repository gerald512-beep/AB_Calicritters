param(
  [string]$Namespace = "ab-calicritters",
  [string]$ChaosNamespace = "chaos-mesh",
  [switch]$UninstallFramework
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

$manifestPaths = @(
  (Join-Path $PSScriptRoot "..\..\infra\k8s\chaos\events-api-pod-kill.yaml"),
  (Join-Path $PSScriptRoot "..\..\infra\k8s\chaos\assignment-api-pod-kill.yaml"),
  (Join-Path $PSScriptRoot "..\..\infra\k8s\chaos\api-network-latency.yaml")
)

foreach ($manifestPath in $manifestPaths) {
  kubectl delete -f $manifestPath --ignore-not-found | Out-Host
}

kubectl delete pod ab-chaos-curl ab-smoke-curl -n $Namespace --ignore-not-found --wait=true | Out-Host
kubectl get podchaos,networkchaos -n $Namespace --ignore-not-found 2>$null | Out-Host

if ($UninstallFramework) {
  Ensure-HelmInPath
  helm uninstall chaos-mesh -n $ChaosNamespace | Out-Host
  kubectl delete namespace $ChaosNamespace --ignore-not-found | Out-Host
}

