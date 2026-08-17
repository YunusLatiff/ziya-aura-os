$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
$envPath=Join-Path $PSScriptRoot '.env'
if(-not(Test-Path -LiteralPath $envPath)){New-Item -ItemType File -Path $envPath -Force | Out-Null}

function Set-EnvValue([string]$Name,[string]$Value){
    $lines=@(Get-Content -LiteralPath $envPath -ErrorAction SilentlyContinue)
    $escapedName=[regex]::Escape($Name)
    $replacement="$Name=`"$Value`""
    $found=$false
    $out=@()
    foreach($line in $lines){
        if($line -match "^\s*$escapedName\s*="){$out+=$replacement;$found=$true}else{$out+=$line}
    }
    if(-not $found){$out+=$replacement}
    Set-Content -LiteralPath $envPath -Value $out -Encoding UTF8
}

Set-EnvValue 'AURA_PORT' '4310'
Set-EnvValue 'CRM_PORT' '4311'
Set-EnvValue 'LEADS_MONTHLY_APPROVED_CAP' '180'
Set-EnvValue 'VISION_MONTHLY_APPROVED_CAP' '60'
Set-EnvValue 'PETER_MONTHLY_APPROVED_CAP' '60'
Set-EnvValue 'MJ_MONTHLY_APPROVED_CAP' '60'
Set-EnvValue 'LEAD_QUOTA_TIMEZONE' 'Africa/Johannesburg'
Set-EnvValue 'TAVILY_MONTHLY_CREDIT_CAP' '900'
Set-EnvValue 'TAVILY_USAGE_STOP_PERCENT' '90'
Set-EnvValue 'TAVILY_CREDIT_RESERVE' '25'

Write-Host ''
Write-Host 'Aura OS v0.8.6 configuration saved.' -ForegroundColor Green
Write-Host 'Aura Operations Dashboard : http://localhost:4310' -ForegroundColor Cyan
Write-Host 'Ziya CRM                  : http://localhost:4311' -ForegroundColor Cyan
Write-Host 'Approved lead cap         : 180/month (60 Vision, 60 Peter, 60 MJ)' -ForegroundColor Cyan
Write-Host 'Tavily hard stop          : 900 credits/month' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Run .\configure-tavily-key.ps1 to store the new Tavily API key locally.' -ForegroundColor Yellow
