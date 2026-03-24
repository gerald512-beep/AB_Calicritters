param(
  [string]$Namespace = "ab-calicritters"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

kubectl annotate ingress ab-calicritters-ingress-canary `
  -n $Namespace `
  nginx.ingress.kubernetes.io/canary-weight="0" `
  --overwrite

kubectl scale deployment events-api-canary -n $Namespace --replicas=0
kubectl rollout status deployment/events-api-canary -n $Namespace --timeout=180s

$current = kubectl get ingress ab-calicritters-ingress-canary `
  -n $Namespace `
  -o jsonpath="{.metadata.annotations.nginx\.ingress\.kubernetes\.io/canary-weight}"

Write-Host "Rollback complete. Canary weight=$current%, canary replicas=0."
