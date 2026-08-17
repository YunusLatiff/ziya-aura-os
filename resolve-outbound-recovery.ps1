param(
    [string]$MessageId,
    [ValidateSet('MARK_SENT','RELEASE_FOR_RETRY')][string]$Resolution
)
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'production\ziya-production-lib.ps1')
$cfg=Get-DotEnvMap -EnvPath (Join-Path $PSScriptRoot '.env')
$port=Get-EnvIntValue -Map $cfg -Name 'AURA_PORT' -Default 4310 -Minimum 1
$base="http://127.0.0.1:$port"
if(-not(Test-AuraRunning -Port $port)){throw 'Aura must be running before resolving an interrupted outbound record.'}
$items=@(Invoke-RestMethod -Uri "$base/api/outbound/recovery" -Method Get)
if(-not $items.Count){Write-Host 'No DELIVERY_UNKNOWN outbound records exist.' -ForegroundColor Green;exit 0}
if([string]::IsNullOrWhiteSpace($MessageId)){
    Write-Host ''
    Write-Host 'DELIVERY_UNKNOWN records:' -ForegroundColor Yellow
    foreach($m in $items){Write-Host ("{0} | {1} | {2}" -f $m.id,$m.companyName,$m.recipientEmail) -ForegroundColor White}
    $MessageId=Read-Host 'Message ID to resolve'
}
$selected=$items|Where-Object{$_.id -eq $MessageId}|Select-Object -First 1
if(-not $selected){throw 'Message ID is not currently in DELIVERY_UNKNOWN.'}
if([string]::IsNullOrWhiteSpace($Resolution)){
    Write-Host ''
    Write-Host 'Only choose MARK_SENT after verifying the email exists in Sent Items.' -ForegroundColor Yellow
    Write-Host 'Only choose RELEASE_FOR_RETRY after verifying it was NOT sent.' -ForegroundColor Yellow
    $Resolution=Read-Host 'Resolution: MARK_SENT or RELEASE_FOR_RETRY'
    $Resolution=$Resolution.Trim().ToUpperInvariant()
    if($Resolution -notin @('MARK_SENT','RELEASE_FOR_RETRY')){throw 'Invalid resolution.'}
}
$confirm=Read-Host "Type YES to apply $Resolution to $MessageId"
if($confirm -cne 'YES'){Write-Host 'Cancelled.' -ForegroundColor Yellow;exit 0}
$body=@{messageId=$MessageId;resolution=$Resolution}|ConvertTo-Json
$result=Invoke-RestMethod -Uri "$base/api/outbound/recovery/resolve" -Method Post -ContentType 'application/json' -Body $body
Write-Host "Resolved: $($result.status)" -ForegroundColor Green
