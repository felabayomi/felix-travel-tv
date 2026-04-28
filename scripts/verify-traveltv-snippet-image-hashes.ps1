param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,

    [Parameter(Mandatory = $true)]
    [int]$ArticleId,

    [switch]$ForceRegenerate
)

$ErrorActionPreference = 'Stop'

function Get-Sha256Hex {
    param(
        [byte[]]$Bytes
    )

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Resolve-AbsoluteUrl {
    param(
        [string]$Base,
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }

    if ($Path -match '^https?://') {
        return $Path
    }

    $baseUri = [System.Uri]::new($Base)
    $relativeUri = [System.Uri]::new($Path, [System.UriKind]::RelativeOrAbsolute)
    return ([System.Uri]::new($baseUri, $relativeUri)).AbsoluteUri
}

$normalizedBase = $BaseUrl.TrimEnd('/')

if ($ForceRegenerate) {
    Write-Host "Triggering force image regeneration for article $ArticleId..." -ForegroundColor Cyan
    $regen = Invoke-RestMethod -Uri "$normalizedBase/api/articles/$ArticleId/regenerate-images?force=true" -Method Post
    $regen | ConvertTo-Json -Depth 5
}

Write-Host "Loading snippets for article $ArticleId from $normalizedBase..." -ForegroundColor Cyan
$snippets = Invoke-RestMethod -Uri "$normalizedBase/api/articles/$ArticleId/snippets" -Method Get

if (-not $snippets) {
    throw "No snippets returned for article $ArticleId."
}

$results = foreach ($snippet in $snippets) {
    $absoluteUrl = Resolve-AbsoluteUrl -Base $normalizedBase -Path $snippet.imageUrl

    if (-not $absoluteUrl) {
        [pscustomobject]@{
            Id          = $snippet.id
            Headline    = $snippet.headline
            ImageUrl    = $null
            Status      = 'missing-image-url'
            ContentType = $null
            Hash        = $null
        }
        continue
    }

    try {
        $response = Invoke-WebRequest -Uri $absoluteUrl -Method Get
        $bytes = $response.Content
        if ($bytes -is [string]) {
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($bytes)
        }

        [pscustomobject]@{
            Id          = $snippet.id
            Headline    = $snippet.headline
            ImageUrl    = $absoluteUrl
            Status      = 'ok'
            ContentType = $response.Headers['Content-Type']
            Hash        = Get-Sha256Hex -Bytes $bytes
        }
    }
    catch {
        [pscustomobject]@{
            Id          = $snippet.id
            Headline    = $snippet.headline
            ImageUrl    = $absoluteUrl
            Status      = 'fetch-failed'
            ContentType = $null
            Hash        = $null
        }
    }
}

Write-Host ''
Write-Host 'Snippet image hashes:' -ForegroundColor Green
$results |
Select-Object Id, Headline, Status, ContentType, Hash |
Format-Table -AutoSize |
Out-String |
Write-Host

$duplicateGroups = $results |
Where-Object { $_.Hash } |
Group-Object Hash |
Where-Object { $_.Count -gt 1 }

if (-not $duplicateGroups) {
    Write-Host 'No duplicate image hashes detected.' -ForegroundColor Green
    exit 0
}

Write-Host 'Duplicate image hashes detected:' -ForegroundColor Yellow
foreach ($group in $duplicateGroups) {
    $ids = ($group.Group | ForEach-Object { $_.Id }) -join ', '
    $titles = ($group.Group | ForEach-Object { $_.Headline }) -join ' | '
    Write-Host "HASH=$($group.Name) IDS=$ids" -ForegroundColor Yellow
    Write-Host "TITLES=$titles" -ForegroundColor DarkYellow
}

exit 1