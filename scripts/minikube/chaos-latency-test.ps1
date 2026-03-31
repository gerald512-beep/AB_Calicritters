param(
  [string]$Namespace = "ab-calicritters",
  [string]$HostName = "ab-calicritters.local",
  [int]$Requests = 60,
  [int]$FaultSettleSeconds = 10,
  [string]$OutputDir = "artifacts/milestone4"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. "$PSScriptRoot/chaos-common.ps1"

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $OutputDir "events-api-network-latency-$timestamp"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$manifestPath = Join-Path $PSScriptRoot "..\..\infra\k8s\chaos\api-network-latency.yaml"

kubectl get pods -n $Namespace -o wide | Set-Content (Join-Path $runDir "pods-before.txt")
$baseline = Invoke-ChaosProbe -Mode events -Namespace $Namespace -HostName $HostName -Requests $Requests -OutputDir $runDir -Label "baseline"

(kubectl apply -f $manifestPath 2>&1 | Out-String) | Set-Content (Join-Path $runDir "apply.txt")
Start-Sleep -Seconds $FaultSettleSeconds
kubectl get pods -n $Namespace -o wide | Set-Content (Join-Path $runDir "pods-during.txt")
kubectl get networkchaos -n $Namespace -o wide | Set-Content (Join-Path $runDir "networkchaos.txt")
$during = Invoke-ChaosProbe -Mode events -Namespace $Namespace -HostName $HostName -Requests $Requests -OutputDir $runDir -Label "during"

(kubectl delete -f $manifestPath --ignore-not-found 2>&1 | Out-String) | Set-Content (Join-Path $runDir "cleanup.txt")
Start-Sleep -Seconds 15
kubectl get pods -n $Namespace -o wide | Set-Content (Join-Path $runDir "pods-after.txt")
$after = Invoke-ChaosProbe -Mode events -Namespace $Namespace -HostName $HostName -Requests $Requests -OutputDir $runDir -Label "after"

$summary = [ordered]@{
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  experiment = "network-latency"
  target = "events-api"
  namespace = $Namespace
  manifest = (Resolve-Path $manifestPath).Path
  baseline_probe = $baseline.Result
  during_probe = $during.Result
  after_probe = $after.Result
  artifacts = @{
    baseline_json = $baseline.JsonPath
    during_json = $during.JsonPath
    after_json = $after.JsonPath
    run_dir = $runDir
  }
}

$summary | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $runDir "summary.json")
Write-Host "Network latency test complete. Artifacts: $runDir"
