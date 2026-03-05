param(
  [string]$HostName = "sepal.stdusr.yale.internal",
  [int]$Port = 2202,
  [string]$User = "calicritters",
  [string]$RepoDir = "",
  [string]$ApiBaseUrl = "",
  [string]$DashBaseUrl = ""
)

$scriptPath = "scripts/yale/deploy_and_verify.sh"
if (-not (Test-Path $scriptPath)) {
  Write-Error "Missing script at $scriptPath"
  exit 1
}

$escapedPath = $scriptPath.Replace("/", "\")

$envParts = @()
if ($RepoDir) { $envParts += "REPO_DIR='$RepoDir'" }
if ($ApiBaseUrl) { $envParts += "API_BASE_URL='$ApiBaseUrl'" }
if ($DashBaseUrl) { $envParts += "DASH_BASE_URL='$DashBaseUrl'" }

$remoteCommand = "bash -s"
if ($envParts.Count -gt 0) {
  $remoteCommand = "$($envParts -join ' ') bash -s"
}

$cmd = "type `"$escapedPath`" | ssh -p $Port $User@$HostName `"$remoteCommand`""
cmd /c $cmd
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
