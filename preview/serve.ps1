# Synthetic CRM preview without Node (PowerShell 5.1). Same idea as preview/serve.cjs:
# serves the CURRENT repo files on 127.0.0.1 only, swaps the Supabase SDK for the in-browser
# synthetic data in preview/fixture-sdk.js, refuses every write. No real data, no login.
#   powershell -ExecutionPolicy Bypass -File preview/serve.ps1
#   http://127.0.0.1:4173/after/owner/   (owner)    http://127.0.0.1:4173/after/muscat/  (staff)
param([int]$Port = 4173)
$root = Split-Path -Parent $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Synthetic CRM preview: http://127.0.0.1:$Port/after/owner/"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$roles = @('owner','muscat','barka','manager','viewer')
$csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'self'; object-src 'none';"
while ($listener.IsListening) {
  $ctx = $listener.GetContext(); $req = $ctx.Request; $res = $ctx.Response
  try {
    $res.Headers['Content-Security-Policy'] = $csp; $res.Headers['Cache-Control'] = 'no-store'
    if ($req.HttpMethod -ne 'GET' -and $req.HttpMethod -ne 'HEAD') { $res.StatusCode = 405; continue }
    $path = $req.Url.AbsolutePath
    if ($path -eq '/') { $res.Redirect('/after/owner/'); continue }
    $body = $null; $type = 'text/javascript; charset=utf-8'
    if ($path -eq '/preview/fixture-sdk.js') {
      $body = [IO.File]::ReadAllText("$root\preview\fixture-sdk.js", $utf8) + "`n" + [IO.File]::ReadAllText("$root\preview\instagram-fixture.js", $utf8)
    } else {
      $parts = $path.Trim('/').Split('/')
      if ($parts.Length -lt 2 -or $parts[0] -ne 'after' -or $roles -notcontains $parts[1]) { $res.StatusCode = 404; continue }
      $file = ($parts | Select-Object -Skip 2) -join '/'
      if (-not $file) { $file = 'index.html' }
      if ($file -match '\.\.' -or $file -notmatch '^[\w\-./]+\.(html|js|css|mjs)$') { $res.StatusCode = 404; continue }
      $full = Join-Path $root $file
      if (-not (Test-Path $full -PathType Leaf)) { $res.StatusCode = 404; continue }
      $body = [IO.File]::ReadAllText($full, $utf8)
      if ($file -eq 'app-base-v15.html') {
        $body = [regex]::Replace($body, '<script[^>]+src="https://[^"]+"[^>]*></script>', '<script src="/preview/fixture-sdk.js"></script>')
        $body = [regex]::Replace($body, '<link[^>]+href="https://[^"]+"[^>]*>', '')
      }
      if ($file.EndsWith('.html')) { $type = 'text/html; charset=utf-8' } elseif ($file.EndsWith('.css')) { $type = 'text/css; charset=utf-8' }
    }
    $bytes = $utf8.GetBytes($body); $res.ContentType = $type; $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch { $res.StatusCode = 500 } finally { $res.Close() }
}
