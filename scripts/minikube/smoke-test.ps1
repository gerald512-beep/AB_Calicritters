param(
  [string]$Namespace = "ab-calicritters",
  [string]$HostName = "ab-calicritters.local",
  [int]$Requests = 40,
  [string]$OutputDir = "artifacts/milestone3",
  [string]$CurlPodName = "ab-smoke-curl"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Requests -le 0) {
  throw "Requests must be > 0."
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$jsonPath = Join-Path $OutputDir "smoke-$timestamp.json"
$logPath = Join-Path $OutputDir "smoke-$timestamp.log"

$ingressUrl = "http://ingress-nginx-controller.ingress-nginx.svc.cluster.local"

Write-Host "Ensuring curl pod exists..."
$podExists = $false
try {
  kubectl get pod $CurlPodName -n $Namespace --ignore-not-found | Out-Null
  $podCheck = kubectl get pod $CurlPodName -n $Namespace -o jsonpath="{.metadata.name}" 2>$null
  $podExists = -not [string]::IsNullOrWhiteSpace($podCheck)
} catch {
  $podExists = $false
}

if (-not $podExists) {
  kubectl run $CurlPodName `
    -n $Namespace `
    --image=curlimages/curl:8.7.1 `
    --restart=Never `
    --command -- sleep 3600 | Out-Null
}

kubectl wait --for=condition=Ready "pod/$CurlPodName" -n $Namespace --timeout=90s | Out-Null

$assignmentPayload = @{
  anonymous_user_id = "smoke-assignment-$timestamp"
  platform = "ios"
  app_version = "0.1.0"
  session_id = "smoke-session-$timestamp"
  install_id = "smoke-install"
} | ConvertTo-Json -Compress

$scriptTemplate = @'
#!/bin/sh
set +e

ASSIGNMENT_PAYLOAD_B64='__ASSIGNMENT_PAYLOAD_B64__'
ASSIGNMENT_CODE=$(echo "$ASSIGNMENT_PAYLOAD_B64" | base64 -d | curl -sS -o /tmp/assignment-body.out -D /tmp/assignment-headers.out -w "%{http_code}" -H "Host: __HOST__" -H "Content-Type: application/json" --data-binary @- __INGRESS__/v1/assignment 2>/tmp/assignment.err)
ASSIGNMENT_EXIT=$?
if [ $ASSIGNMENT_EXIT -ne 0 ]; then
  ASSIGNMENT_CODE=-1
fi
echo "ASSIGNMENT_STATUS:$ASSIGNMENT_CODE"

REQUESTS=__REQUESTS__
for i in $(seq 1 $REQUESTS); do
  OCCURRED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  EVENT_PAYLOAD=$(printf '{"anonymous_user_id":"smoke-events-__STAMP__-%s","session_id":"smoke-session-__STAMP__","platform":"ios","app_version":"0.1.0","events":[{"event_name":"app_opened","occurred_at":"%s","properties":{"source":"milestone3_smoke","request_index":%s}}]}' "$i" "$OCCURRED_AT" "$i")
  EVENT_CODE=$(printf '%s' "$EVENT_PAYLOAD" | curl -sS -o /tmp/event-body.out -D /tmp/event-headers.out -w "%{http_code}" -H "Host: __HOST__" -H "Content-Type: application/json" --data-binary @- __INGRESS__/v1/events 2>/tmp/event.err)
  EVENT_EXIT=$?

  if [ $EVENT_EXIT -ne 0 ]; then
    echo "EVENT_RESULT:-1,request_error"
    continue
  fi

  VARIANT=$(grep -i '^x-events-service-variant:' /tmp/event-headers.out | tail -n 1 | awk '{print $2}' | tr -d '\r')
  if [ -z "$VARIANT" ]; then
    VARIANT=unknown
  fi

  echo "EVENT_RESULT:$EVENT_CODE,$VARIANT"
done
'@

$assignmentPayloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($assignmentPayload))
$script = $scriptTemplate
$script = $script.Replace("__ASSIGNMENT_PAYLOAD_B64__", $assignmentPayloadBase64)
$script = $script.Replace("__HOST__", $HostName)
$script = $script.Replace("__INGRESS__", $ingressUrl)
$script = $script.Replace("__REQUESTS__", [string]$Requests)
$script = $script.Replace("__STAMP__", $timestamp)

$scriptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
$rawOutput = kubectl exec -n $Namespace $CurlPodName -- sh -lc "echo $scriptBase64 | base64 -d > /tmp/smoke.sh && sh /tmp/smoke.sh"

$assignmentStatus = -1
$statusCounts = @{}
$variantCounts = @{}

foreach ($line in $rawOutput) {
  if ($line -like "ASSIGNMENT_STATUS:*") {
    $assignmentStatus = [int]($line.Split(":", 2)[1].Trim())
    continue
  }

  if ($line -like "EVENT_RESULT:*") {
    $payload = $line.Split(":", 2)[1]
    $parts = $payload.Split(",", 2)
    if ($parts.Length -ne 2) {
      continue
    }

    $status = $parts[0].Trim()
    $variant = $parts[1].Trim()

    if (-not $statusCounts.ContainsKey($status)) { $statusCounts[$status] = 0 }
    if (-not $variantCounts.ContainsKey($variant)) { $variantCounts[$variant] = 0 }

    $statusCounts[$status] += 1
    $variantCounts[$variant] += 1
  }
}

$canaryWeight = kubectl get ingress ab-calicritters-ingress-canary `
  -n $Namespace `
  -o jsonpath="{.metadata.annotations.nginx\.ingress\.kubernetes\.io/canary-weight}"

$podsText = kubectl get pods -n $Namespace -o wide | Out-String
$ingressText = kubectl get ingress -n $Namespace | Out-String

$result = [ordered]@{
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  namespace = $Namespace
  host = $HostName
  assignment_status = $assignmentStatus
  events_requests = $Requests
  canary_weight = [int]$canaryWeight
  status_counts = $statusCounts
  variant_counts = $variantCounts
  ingress = $ingressText.Trim()
}

$result | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonPath

@(
  "Smoke test timestamp: $timestamp"
  "Namespace: $Namespace"
  "Host: $HostName"
  "Assignment status: $assignmentStatus"
  "Event requests: $Requests"
  "Canary weight: $canaryWeight"
  ""
  "Status counts:"
  ($statusCounts.GetEnumerator() | Sort-Object Name | ForEach-Object { "  $($_.Name): $($_.Value)" })
  ""
  "Variant counts:"
  ($variantCounts.GetEnumerator() | Sort-Object Name | ForEach-Object { "  $($_.Name): $($_.Value)" })
  ""
  "Pods:"
  $podsText.TrimEnd()
  ""
  "Ingress:"
  $ingressText.TrimEnd()
) | Set-Content -Path $logPath

Write-Host "Smoke test complete."
Write-Host "JSON: $jsonPath"
Write-Host "LOG : $logPath"
