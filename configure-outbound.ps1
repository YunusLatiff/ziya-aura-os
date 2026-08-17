$ErrorActionPreference = "Stop"
Write-Host "============================================" -ForegroundColor DarkYellow
Write-Host " AURA OS v0.4.0 - CONTROLLED OUTBOUND" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor DarkYellow
Write-Host "This configures Aura only. Tony is not read or modified." -ForegroundColor DarkGray

$hostName = Read-Host "SMTP host [smtpout.secureserver.net]"
if ([string]::IsNullOrWhiteSpace($hostName)) { $hostName = "smtpout.secureserver.net" }
$port = Read-Host "SMTP TLS port [465]"
if ([string]::IsNullOrWhiteSpace($port)) { $port = "465" }
$user = Read-Host "SMTP username / Ziya mailbox email"
$from = Read-Host "From email [$user]"
if ([string]::IsNullOrWhiteSpace($from)) { $from = $user }
$fromName = Read-Host "Sender display name [Ziya Energy]"
if ([string]::IsNullOrWhiteSpace($fromName)) { $fromName = "Ziya Energy" }
$replyTo = Read-Host "Reply-to email [$from]"
if ([string]::IsNullOrWhiteSpace($replyTo)) { $replyTo = $from }
$secure = Read-Host "SMTP password" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
$daily = Read-Host "Maximum emails per day [20]"
if ([string]::IsNullOrWhiteSpace($daily)) { $daily = "20" }
$spacing = Read-Host "Minimum seconds between emails [90]"
if ([string]::IsNullOrWhiteSpace($spacing)) { $spacing = "90" }

$envPath = Join-Path (Get-Location) ".env"
$map = @{}
if (Test-Path $envPath) {
  foreach ($line in Get-Content $envPath) {
    if ($line -match '^\s*([^#=][^=]*)=(.*)$') { $map[$matches[1].Trim()] = $matches[2] }
  }
}
$map['OUTBOUND_ENABLED'] = 'false'
$map['OUTBOUND_SMTP_HOST'] = $hostName
$map['OUTBOUND_SMTP_PORT'] = $port
$map['OUTBOUND_SMTP_USER'] = $user
$map['OUTBOUND_SMTP_PASSWORD'] = '"' + ($password -replace '"','\"') + '"'
$map['OUTBOUND_FROM_EMAIL'] = $from
$map['OUTBOUND_FROM_NAME'] = '"' + ($fromName -replace '"','\"') + '"'
$map['OUTBOUND_REPLY_TO'] = $replyTo
$map['OUTBOUND_DAILY_LIMIT'] = $daily
$map['OUTBOUND_MIN_SECONDS_BETWEEN'] = $spacing
$map['OUTBOUND_BATCH_LIMIT'] = '5'
$map['OUTBOUND_TICK_SECONDS'] = '30'

$ordered = @('AURA_PORT','TAVILY_API_KEY','GEOAPIFY_API_KEY','RESEARCH_REGIONS','RESEARCH_TICK_SECONDS','TAVILY_BUDGET_RESERVE','TAVILY_MAX_ENRICH_PER_LEAD','OUTBOUND_ENABLED','OUTBOUND_SMTP_HOST','OUTBOUND_SMTP_PORT','OUTBOUND_SMTP_USER','OUTBOUND_SMTP_PASSWORD','OUTBOUND_FROM_EMAIL','OUTBOUND_FROM_NAME','OUTBOUND_REPLY_TO','OUTBOUND_DAILY_LIMIT','OUTBOUND_MIN_SECONDS_BETWEEN','OUTBOUND_BATCH_LIMIT','OUTBOUND_TICK_SECONDS')
$lines = New-Object System.Collections.Generic.List[string]
foreach ($k in $ordered) { if ($map.ContainsKey($k)) { $lines.Add("$k=$($map[$k])"); $map.Remove($k) } }
foreach ($k in ($map.Keys | Sort-Object)) { $lines.Add("$k=$($map[$k])") }
$lines | Set-Content -Path $envPath -Encoding UTF8
Write-Host "Outbound SMTP configuration saved to Aura .env." -ForegroundColor Green
Write-Host "OUTBOUND_ENABLED remains false for safety." -ForegroundColor Yellow
Write-Host "After a successful one-message test, change OUTBOUND_ENABLED=true to unlock sending." -ForegroundColor Yellow
