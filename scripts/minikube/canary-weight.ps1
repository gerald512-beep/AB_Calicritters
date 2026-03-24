param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(0, 100)]
  [int]$Weight,
  [string]$Namespace = "ab-calicritters"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

kubectl annotate ingress ab-calicritters-ingress-canary `
  -n $Namespace `
  nginx.ingress.kubernetes.io/canary-weight="$Weight" `
  --overwrite

$current = kubectl get ingress ab-calicritters-ingress-canary `
  -n $Namespace `
  -o jsonpath="{.metadata.annotations.nginx\.ingress\.kubernetes\.io/canary-weight}"

Write-Host "Canary weight updated to: $current%"
