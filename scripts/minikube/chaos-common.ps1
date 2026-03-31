Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ensure-ChaosCurlPod {
  param(
    [string]$Namespace = "ab-calicritters",
    [string]$CurlPodName = "ab-chaos-curl"
  )

  $podCheck = kubectl get pod $CurlPodName -n $Namespace --ignore-not-found -o jsonpath="{.metadata.name}" 2>$null
  if ([string]::IsNullOrWhiteSpace($podCheck)) {
    kubectl run $CurlPodName `
      -n $Namespace `
      --image=curlimages/curl:8.7.1 `
      --restart=Never `
      --command -- sleep 3600 | Out-Null
  }

  kubectl wait --for=condition=Ready "pod/$CurlPodName" -n $Namespace --timeout=90s | Out-Null
}

function Get-PercentileValue {
  param(
    [double[]]$Values,
    [double]$Percentile
  )

  if (-not $Values -or $Values.Count -eq 0) {
    return $null
  }

  $sorted = $Values | Sort-Object
  $index = [Math]::Ceiling(($Percentile / 100) * $sorted.Count) - 1
  if ($index -lt 0) { $index = 0 }
  if ($index -ge $sorted.Count) { $index = $sorted.Count - 1 }
  return [Math]::Round([double]$sorted[$index], 4)
}

function Invoke-ChaosProbe {
  param(
    [ValidateSet("assignment", "events")]
    [string]$Mode,
    [string]$Namespace = "ab-calicritters",
    [string]$HostName = "ab-calicritters.local",
    [int]$Requests = 40,
    [string]$OutputDir = "artifacts/milestone4",
    [string]$CurlPodName = "ab-chaos-curl",
    [string]$Label = "probe"
  )

  if ($Requests -le 0) {
    throw "Requests must be > 0."
  }

  Ensure-ChaosCurlPod -Namespace $Namespace -CurlPodName $CurlPodName
  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $jsonPath = Join-Path $OutputDir "$Label-$Mode-$timestamp.json"
  $logPath = Join-Path $OutputDir "$Label-$Mode-$timestamp.log"
  $ingressUrl = "http://ingress-nginx-controller.ingress-nginx.svc.cluster.local"

  $scriptTemplate = @"
#!/bin/sh
set +e

REQUESTS=__REQUESTS__
MODE='__MODE__'
for i in `$(seq 1 `$REQUESTS); do
  NOW_ISO=`$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if [ "`$MODE" = "assignment" ]; then
    PAYLOAD=`$(printf '{"anonymous_user_id":"chaos-assignment-%s-%s","platform":"ios","app_version":"0.1.0","session_id":"chaos-session-%s"}' '__STAMP__' "`$i" '__STAMP__')
    META=`$(printf '%s' "`$PAYLOAD" | curl -sS -o /tmp/chaos-body.out -D /tmp/chaos-headers.out -w "%{http_code},%{time_total}" -H "Host: __HOST__" -H "Content-Type: application/json" --data-binary @- __INGRESS__/v1/assignment 2>/tmp/chaos.err)
    EXIT_CODE=`$?
    if [ `$EXIT_CODE -ne 0 ]; then
      echo "RESULT:-1,request_error,0"
      continue
    fi
    STATUS=`$(printf '%s' "`$META" | cut -d, -f1)
    DURATION=`$(printf '%s' "`$META" | cut -d, -f2)
    echo "RESULT:`$STATUS,assignment,`$DURATION"
  else
    PAYLOAD=`$(printf '{"anonymous_user_id":"chaos-events-%s-%s","platform":"ios","app_version":"0.1.0","session_id":"chaos-session-%s","events":[{"event_name":"app_opened","occurred_at":"%s","properties":{"source":"milestone4_chaos","request_index":%s}}]}' '__STAMP__' "`$i" '__STAMP__' "`$NOW_ISO" "`$i")
    META=`$(printf '%s' "`$PAYLOAD" | curl -sS -o /tmp/chaos-body.out -D /tmp/chaos-headers.out -w "%{http_code},%{time_total}" -H "Host: __HOST__" -H "Content-Type: application/json" --data-binary @- __INGRESS__/v1/events 2>/tmp/chaos.err)
    EXIT_CODE=`$?
    if [ `$EXIT_CODE -ne 0 ]; then
      echo "RESULT:-1,request_error,0"
      continue
    fi
    STATUS=`$(printf '%s' "`$META" | cut -d, -f1)
    DURATION=`$(printf '%s' "`$META" | cut -d, -f2)
    VARIANT=`$(grep -i '^x-events-service-variant:' /tmp/chaos-headers.out | tail -n 1 | awk '{print `$2}' | tr -d '\r')
    if [ -z "`$VARIANT" ]; then
      VARIANT=unknown
    fi
    echo "RESULT:`$STATUS,`$VARIANT,`$DURATION"
  fi
done
"@

  $script = $scriptTemplate
  $script = $script.Replace("__REQUESTS__", [string]$Requests)
  $script = $script.Replace("__MODE__", $Mode)
  $script = $script.Replace("__STAMP__", $timestamp)
  $script = $script.Replace("__HOST__", $HostName)
  $script = $script.Replace("__INGRESS__", $ingressUrl)

  $scriptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
  $rawOutput = kubectl exec -n $Namespace $CurlPodName -- sh -lc "echo $scriptBase64 | base64 -d > /tmp/chaos-probe.sh && sh /tmp/chaos-probe.sh"

  $statusCounts = @{}
  $variantCounts = @{}
  $durations = New-Object System.Collections.Generic.List[Double]
  foreach ($line in $rawOutput) {
    if ($line -notlike "RESULT:*") {
      continue
    }

    $payload = $line.Split(":", 2)[1]
    $parts = $payload.Split(",", 3)
    if ($parts.Length -ne 3) {
      continue
    }

    $status = $parts[0].Trim()
    $variant = $parts[1].Trim()
    $duration = 0.0
    [void][double]::TryParse($parts[2].Trim(), [ref]$duration)

    if (-not $statusCounts.ContainsKey($status)) { $statusCounts[$status] = 0 }
    if (-not $variantCounts.ContainsKey($variant)) { $variantCounts[$variant] = 0 }

    $statusCounts[$status] += 1
    $variantCounts[$variant] += 1
    if ($duration -gt 0) {
      $durations.Add($duration)
    }
  }

  $result = [ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    mode = $Mode
    namespace = $Namespace
    host = $HostName
    requests = $Requests
    status_counts = $statusCounts
    variant_counts = $variantCounts
    latency_seconds = [ordered]@{
      avg = if ($durations.Count -gt 0) { [Math]::Round((($durations | Measure-Object -Average).Average), 4) } else { $null }
      p50 = Get-PercentileValue -Values $durations.ToArray() -Percentile 50
      p95 = Get-PercentileValue -Values $durations.ToArray() -Percentile 95
      max = if ($durations.Count -gt 0) { [Math]::Round((($durations | Measure-Object -Maximum).Maximum), 4) } else { $null }
    }
  }

  $result | ConvertTo-Json -Depth 10 | Set-Content $jsonPath

  @(
    "Probe timestamp: $timestamp"
    "Mode: $Mode"
    "Namespace: $Namespace"
    "Host: $HostName"
    "Requests: $Requests"
    ""
    "Status counts:"
    ($statusCounts.GetEnumerator() | Sort-Object Name | ForEach-Object { "  $($_.Name): $($_.Value)" })
    ""
    "Variant counts:"
    ($variantCounts.GetEnumerator() | Sort-Object Name | ForEach-Object { "  $($_.Name): $($_.Value)" })
    ""
    "Latency (seconds):"
    "  avg: $($result.latency_seconds.avg)"
    "  p50: $($result.latency_seconds.p50)"
    "  p95: $($result.latency_seconds.p95)"
    "  max: $($result.latency_seconds.max)"
  ) | Set-Content $logPath

  [pscustomobject]@{
    Timestamp = $timestamp
    JsonPath = $jsonPath
    LogPath = $logPath
    Result = $result
  }
}
