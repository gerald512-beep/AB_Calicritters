param(
  [ValidateSet("events-api", "assignment-api")]
  [string]$Target,
  [string]$Namespace = "ab-calicritters",
  [string]$HostName = "ab-calicritters.local",
  [int]$Requests = 40,
  [int]$FaultSettleSeconds = 10,
  [string]$OutputDir = "artifacts/milestone4"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. "$PSScriptRoot/chaos-common.ps1"

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $OutputDir "$Target-pod-kill-$timestamp"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$manifestPath = if ($Target -eq "events-api") {
  Join-Path $PSScriptRoot "..\..\infra\k8s\chaos\events-api-pod-kill.yaml"
} else {
  Join-Path $PSScriptRoot "..\..\infra\k8s\chaos\assignment-api-pod-kill.yaml"
}
$probeMode = if ($Target -eq "events-api") { "events" } else { "assignment" }

kubectl get pods -n $Namespace -o wide | Set-Content (Join-Path $runDir "pods-before.txt")
$baseline = Invoke-ChaosProbe -Mode $probeMode -Namespace $Namespace -HostName $HostName -Requests $Requests -OutputDir $runDir -Label "baseline"

(kubectl apply -f $manifestPath 2>&1 | Out-String) | Set-Content (Join-Path $runDir "apply.txt")
Start-Sleep -Seconds $FaultSettleSeconds
kubectl get pods -n $Namespace -o wide | Set-Content (Join-Path $runDir "pods-during.txt")
kubectl get podchaos -n $Namespace -o wide | Set-Content (Join-Path $runDir "podchaos.txt")
$during = Invoke-ChaosProbe -Mode $probeMode -Namespace $Namespace -HostName $HostName -Requests $Requests -OutputDir $runDir -Label "during"

(kubectl delete -f $manifestPath --ignore-not-found 2>&1 | Out-String) | Set-Content (Join-Path $runDir "cleanup.txt")
Start-Sleep -Seconds 15
kubectl get pods -n $Namespace -o wide | Set-Content (Join-Path $runDir "pods-after.txt")
$after = Invoke-ChaosProbe -Mode $probeMode -Namespace $Namespace -HostName $HostName -Requests $Requests -OutputDir $runDir -Label "after"

$summary = [ordered]@{
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  experiment = "pod-kill"
  target = $Target
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
Write-Host "Pod kill test complete. Artifacts: $runDir"
