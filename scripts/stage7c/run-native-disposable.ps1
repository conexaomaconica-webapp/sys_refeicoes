[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PostgresBin,

    [ValidateRange(1024, 65535)]
    [int]$Port = 55437,

    [string]$EvidenceDirectory = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$runner = Join-Path $root 'scripts\homologate-stage7c-local.cjs'
$node = Get-Command node -ErrorAction Stop

function Get-NormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

function Test-SafeInstancePath {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$TempBase,
        [Parameter(Mandatory = $true)][string]$RunId
    )

    $normalizedCandidate = Get-NormalizedPath $Candidate
    $normalizedBase = Get-NormalizedPath $TempBase
    $expectedPrefix = $normalizedBase + [System.IO.Path]::DirectorySeparatorChar
    $leaf = Split-Path -Leaf $normalizedCandidate

    return $normalizedCandidate.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase) `
        -and $leaf -eq $RunId `
        -and $leaf.StartsWith('ma-stage7c-', [System.StringComparison]::Ordinal)
}

$resolvedBin = Resolve-Path -LiteralPath $PostgresBin -ErrorAction Stop
if (-not (Test-Path -LiteralPath $resolvedBin -PathType Container)) {
    throw 'PostgresBin deve apontar para um diretorio existente.'
}

$requiredExecutables = @('postgres.exe', 'initdb.exe', 'pg_ctl.exe', 'pg_isready.exe', 'createdb.exe', 'psql.exe')
$tools = @{}
foreach ($executable in $requiredExecutables) {
    $candidate = Join-Path $resolvedBin $executable
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Binario PostgreSQL obrigatorio ausente: $executable"
    }
    $tools[$executable] = $candidate
}

$versionOutput = & $tools['postgres.exe'] --version 2>&1
if ($LASTEXITCODE -ne 0 -or "$versionOutput" -notmatch 'PostgreSQL\) 17\.') {
    throw "Versao PostgreSQL recusada: $versionOutput"
}

$existingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existingListener) {
    throw "Porta local $Port ja esta em uso. Nenhum servidor foi iniciado."
}

$runId = 'ma-stage7c-' + [Guid]::NewGuid().ToString('N')
$databaseName = 'stage7c_' + [Guid]::NewGuid().ToString('N')
$tempBase = Get-NormalizedPath ([System.IO.Path]::GetTempPath())
$instanceRoot = Join-Path $tempBase $runId
$dataDirectory = Join-Path $instanceRoot 'data'
$markerPath = Join-Path $instanceRoot '.stage7c-disposable'
$passwordFile = Join-Path $instanceRoot 'pwfile'
$serverLog = Join-Path $instanceRoot 'postgres.log'
$serverStarted = $false
$cleanupAllowed = $true

if (-not (Test-SafeInstancePath -Candidate $instanceRoot -TempBase $tempBase -RunId $runId)) {
    throw "Diretorio temporario recusado: $instanceRoot"
}

if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) {
    $EvidenceDirectory = Join-Path $root 'docs\evidence\stage7c'
}
$evidenceRoot = Get-NormalizedPath $EvidenceDirectory
$evidenceFile = Join-Path $evidenceRoot ("stage7c-native-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

$randomBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($randomBytes)
$rng.Dispose()
$password = ([System.BitConverter]::ToString($randomBytes)).Replace('-', '').ToLowerInvariant()

try {
    New-Item -ItemType Directory -Path $instanceRoot -ErrorAction Stop | Out-Null
    Set-Content -LiteralPath $markerPath -Value $runId -Encoding ASCII -NoNewline
    Set-Content -LiteralPath $passwordFile -Value $password -Encoding ASCII -NoNewline

    & $tools['initdb.exe'] -D $dataDirectory -U stage7c_owner -A scram-sha-256 "--pwfile=$passwordFile" --encoding=UTF8 --no-locale
    if ($LASTEXITCODE -ne 0) {
        throw "initdb falhou com codigo $LASTEXITCODE."
    }

    Add-Content -LiteralPath (Join-Path $dataDirectory 'postgresql.conf') -Encoding ASCII -Value @(
        "listen_addresses = '127.0.0.1'",
        "port = $Port",
        "ssl = off",
        "max_connections = 20"
    )
    Set-Content -LiteralPath (Join-Path $dataDirectory 'pg_hba.conf') -Encoding ASCII -Value @(
        'host all all 127.0.0.1/32 scram-sha-256',
        'host all all 0.0.0.0/0 reject',
        'host all all ::0/0 reject'
    )

    & $tools['pg_ctl.exe'] -D $dataDirectory -l $serverLog -o "-p $Port -h 127.0.0.1" -w -t 30 start
    if ($LASTEXITCODE -ne 0) {
        throw "pg_ctl start falhou com codigo $LASTEXITCODE."
    }
    $serverStarted = $true

    $env:PGPASSWORD = $password
    & $tools['createdb.exe'] -h 127.0.0.1 -p $Port -U stage7c_owner $databaseName
    if ($LASTEXITCODE -ne 0) {
        throw "createdb falhou com codigo $LASTEXITCODE."
    }

    $env:STAGE7C_DB_URL = "postgresql://stage7c_owner:$password@127.0.0.1:$Port/$databaseName"
    $env:STAGE7C_EXPECTED_DATA_DIR = $dataDirectory
    $env:STAGE7C_EXPECTED_PORT = "$Port"

    New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
    $runnerOutput = & $node.Source $runner 2>&1
    $runnerExitCode = $LASTEXITCODE
    $sanitizedOutput = ($runnerOutput | Out-String).Replace($password, '[REDACTED]')
    $sanitizedOutput | Set-Content -LiteralPath $evidenceFile -Encoding UTF8
    $sanitizedOutput | Write-Output

    if ($runnerExitCode -ne 0) {
        throw "Runner Stage 7C falhou com codigo $runnerExitCode."
    }
}
finally {
    Remove-Item Env:STAGE7C_DB_URL -ErrorAction SilentlyContinue
    Remove-Item Env:STAGE7C_EXPECTED_DATA_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:STAGE7C_EXPECTED_PORT -ErrorAction SilentlyContinue
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    $password = $null

    if (Test-Path -LiteralPath $dataDirectory) {
        & $tools['pg_ctl.exe'] -D $dataDirectory status *> $null
        if ($LASTEXITCODE -eq 0) {
            & $tools['pg_ctl.exe'] -D $dataDirectory -m immediate -w -t 30 stop
            if ($LASTEXITCODE -ne 0) {
                $cleanupAllowed = $false
                Write-Error 'PostgreSQL nao encerrou; o diretorio temporario foi preservado para evitar corrupcao.'
            }
        }
    }
    $serverStarted = $false

    for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
        if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        $cleanupAllowed = $false
        Write-Error "A porta $Port continua ocupada; a limpeza foi bloqueada."
    }

    $markerMatches = (Test-Path -LiteralPath $markerPath -PathType Leaf) `
        -and ((Get-Content -LiteralPath $markerPath -Raw) -eq $runId)
    $safePath = Test-SafeInstancePath -Candidate $instanceRoot -TempBase $tempBase -RunId $runId

    if ($cleanupAllowed -and $safePath -and $markerMatches) {
        Remove-Item -LiteralPath $instanceRoot -Recurse -Force
    }
    elseif (Test-Path -LiteralPath $instanceRoot) {
        Write-Error "Limpeza recusada. Diretorio preservado: $instanceRoot"
    }
}
