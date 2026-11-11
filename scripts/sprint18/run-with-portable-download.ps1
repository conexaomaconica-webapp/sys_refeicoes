[CmdletBinding()]
param(
    [int]$Port = 55442
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.IO.Compression.FileSystem

$expectedUrl = 'https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64-binaries.zip'
$expectedSize = 381531864L
$expectedSha256 = '80379B2C04D51C30225532E0AE04509899141E9957ED096FE749D7FD9DF8F82F'

$drive = Get-PSDrive C
$freeBytes = [int64]$drive.Free
$freeGb = [math]::Round($freeBytes / 1GB, 2)
Write-Output ("Disk C free before start: {0} GB ({1} bytes)" -f $freeGb, $freeBytes)

# Requer margem mínima segura de 1.6 GB para download (~364 MB) + extração seletiva (~280 MB) + cluster (~80 MB)
if ($freeBytes -lt 1717986918L) {
    throw "Espaco insuficiente em C: ($freeGb GB). Minimo seguro exigido: 1.60 GB."
}

$guid = [Guid]::NewGuid().ToString('N')
$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
$zipPath = Join-Path $tempBase ("ma-sprint18-pg1711-$guid.zip")
$extractRoot = Join-Path $tempBase ("ma-sprint18-tools-$guid")
$runScript = Join-Path $PSScriptRoot 'run-native-performance.ps1'

$sw = [System.Diagnostics.Stopwatch]::StartNew()

try {
    Write-Output "Downloading PostgreSQL 17.11-5 binaries from official EDB endpoint..."
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $expectedUrl -OutFile $zipPath -UseBasicParsing

    $actualSize = (Get-Item -LiteralPath $zipPath).Length
    if ($actualSize -ne $expectedSize) {
        throw "Tamanho divergente do ZIP: esperado $expectedSize, obtido $actualSize."
    }

    $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actualHash -ne $expectedSha256) {
        throw "SHA-256 divergente! Esperado $expectedSha256, obtido $actualHash."
    }
    Write-Output ("ZIP verified: size={0} bytes, sha256={1}" -f $actualSize, $actualHash)

    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
    $extractPrefix = ([System.IO.Path]::GetFullPath($extractRoot).TrimEnd('\', '/')) + [System.IO.Path]::DirectorySeparatorChar

    Write-Output "Extracting pgsql/bin, pgsql/lib and pgsql/share selectively to $extractRoot..."
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        foreach ($entry in $archive.Entries) {
            if ([string]::IsNullOrEmpty($entry.Name)) { continue }
            $normEntry = $entry.FullName.Replace('\', '/')
            if (-not ($normEntry.StartsWith('pgsql/bin/') -or $normEntry.StartsWith('pgsql/lib/') -or $normEntry.StartsWith('pgsql/share/'))) {
                continue
            }
            $destPath = [System.IO.Path]::GetFullPath((Join-Path $extractRoot $entry.FullName))
            if (-not $destPath.StartsWith($extractPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Zip Slip bloqueado: $($entry.FullName)"
            }
            $destDir = Split-Path -Parent $destPath
            if (-not (Test-Path -LiteralPath $destDir)) {
                New-Item -ItemType Directory -Path $destDir -Force | Out-Null
            }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destPath, $true)
        }
    }
    finally {
        $archive.Dispose()
    }

    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    $freeBytesBeforeInit = [int64]((Get-PSDrive C).Free)
    $freeAfterExtract = [math]::Round($freeBytesBeforeInit / 1GB, 2)
    Write-Output ("ZIP removed after extraction. Disk C free before cluster init: {0} GB ({1} bytes)" -f $freeAfterExtract, $freeBytesBeforeInit)
    if ($freeBytesBeforeInit -lt 1073741824L) {
        throw "Espaco insuficiente antes do initdb: $freeAfterExtract GB. Minimo seguro exigido: 1.00 GB."
    }

    & $runScript -PostgresBin (Join-Path $extractRoot 'pgsql\bin') -Port $Port
    if ($LASTEXITCODE -ne 0) {
        throw "Execucao Sprint 18 retornou codigo $LASTEXITCODE."
    }
}
finally {
    $sw.Stop()
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $extractRoot) {
        $leaf = Split-Path -Leaf $extractRoot
        if ($leaf.StartsWith('ma-sprint18-tools-', [System.StringComparison]::Ordinal)) {
            Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    $pgProcs = @(Get-Process -Name 'postgres', 'pg_ctl', 'initdb' -ErrorAction SilentlyContinue).Count
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count
    $leftover = @(Get-ChildItem $tempBase -Filter 'ma-sprint18-*' -ErrorAction SilentlyContinue).Count
    $freeFinalGb = [math]::Round(([int64]((Get-PSDrive C).Free)) / 1GB, 2)

    Write-Output ("CLEANUP CHECK | duration_sec={0} | pg_procs={1} | port_{2}_listeners={3} | residual_temp={4} | disk_c_free_gb={5}" -f `
        [math]::Round($sw.Elapsed.TotalSeconds, 2), $pgProcs, $Port, $listeners, $leftover, $freeFinalGb)
}

