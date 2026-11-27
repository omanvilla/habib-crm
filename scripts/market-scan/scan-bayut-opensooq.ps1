<#
Daily Barka market scan for Bayut and OpenSooq, run by the laptop scheduled task
"market-scan-daily". No browser: plain HTTP from the laptop (both sites refuse cloud IPs,
and the desktop app never auto-approves Chrome actions in unattended scheduled runs).

  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\market-scan\scan-bayut-opensooq.ps1
      -> fetches pages, prints JSON {date, counts, failed, lands:[[24 cols]], bld:[[25 cols]]}
         with only listings not yet in the local seen list, and saves them as pending.
  ... -Commit   -> after the rows were appended to the sheet: pending ids become seen.
  ... -Seed "O123 B456 ..." -> add ids to the seen list (O = OpenSooq, B = Bayut).

State lives in %LOCALAPPDATA%\habib-market-scan (seen.txt, pending.json).
Omanreal is scanned by the cloud routine, not here.
#>
param([switch]$Commit, [string]$Seed = '', [int]$Pages = 3, [int]$Max = 200)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$stateDir = Join-Path $env:LOCALAPPDATA 'habib-market-scan'
if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir | Out-Null }
$seenFile = Join-Path $stateDir 'seen.txt'
$pendFile = Join-Path $stateDir 'pending.json'
$seen = New-Object 'System.Collections.Generic.HashSet[string]'
if (Test-Path $seenFile) { foreach ($l in [IO.File]::ReadAllLines($seenFile)) { if ($l.Trim()) { [void]$seen.Add($l.Trim()) } } }

function Save-Seen { [IO.File]::WriteAllLines($seenFile, [string[]]@($seen | Sort-Object)) }

if ($Seed) {
  $n = 0; foreach ($s in ($Seed -split '[\s,]+')) { if ($s -match '^[OB]\d+$' -and $seen.Add($s)) { $n++ } }
  Save-Seen; "seeded $n, seen now $($seen.Count)"; exit 0
}
if ($Commit) {
  if (-not (Test-Path $pendFile)) { 'nothing pending'; exit 0 }
  $p = [IO.File]::ReadAllText($pendFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
  $n = 0; foreach ($k in $p.keys) { if ($seen.Add([string]$k)) { $n++ } }
  Save-Seen; Remove-Item $pendFile; "committed $n, seen now $($seen.Count)"; exit 0
}

$today = (Get-Date).ToString('yyyy-MM-dd')
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
$failed = New-Object System.Collections.ArrayList

function Get-Html([string]$url) {
  for ($i = 0; $i -lt 2; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $url -UserAgent $UA -UseBasicParsing -TimeoutSec 40 -Headers @{ 'Accept-Language' = 'ar,en;q=0.8' }
      $ms = New-Object IO.MemoryStream; $r.RawContentStream.Position = 0; $r.RawContentStream.CopyTo($ms)
      return [Text.Encoding]::UTF8.GetString($ms.ToArray())
    } catch { Start-Sleep -Seconds 3; $err = $_.Exception.Message }
  }
  [void]$failed.Add("$url : $err"); return $null
}

function Num([string]$s) {
  if (-not $s) { return $null }
  $a = '٠١٢٣٤٥٦٧٨٩'; for ($i = 0; $i -lt 10; $i++) { $s = $s.Replace($a[$i], [string]$i) }
  $m = [regex]::Match(($s -replace '[,٬]', ''), '[0-9]+(\.[0-9]+)?')
  if ($m.Success) { return [double]$m.Value } ; return $null
}
function Clean([string]$s) { if (-not $s) { return '' }; $s = [Net.WebUtility]::HtmlDecode($s); return (($s -replace '[\t\r\n"]', ' ') -replace '\s+', ' ').Trim() }

# Official Barka area names as used in the sheet (column H), plus spellings seen in ads.
$areas = @('الفليج','الرميس','أبو النخيل','الهرم','قري','حي عاصم','القريحة','الصومحان الجنوبية','الصومحان','سوادي الحكمان','العقير','العقدة','السلاحة','الشخاخيط','مزرع الحرادي','البدي','مزرع الحرث','البلة','العامرة','الحضيب','السقسوق','النعمان','الفاغرة','مركز المدينة','سيح المحامد','الحرادي','حفري الجنوبية','الجنينة','المريصي','الوهرة','الحسنات','الثرامد','الجحيلة','حفري السور','الخويرات','المريغات','الباسط','حي السلام','حفري الساحل','سوادي الساحل','الجاحس','العبر','سلوى','العذيبة','أبو محار','المراغ','حي العزة','المنومة','السوادي')
$alias = @{ 'صومحان جنوب' = 'الصومحان الجنوبية'; 'الصومحان جنوب' = 'الصومحان الجنوبية'; 'صومحان' = 'الصومحان'; 'مزارع الحرث' = 'مزرع الحرث'; 'مزارع الحرادي' = 'مزرع الحرادي'; 'سوادي' = 'السوادي'; 'العقده' = 'العقدة'; 'الحفري الساحل' = 'حفري الساحل'; 'السوادى الحكمان' = 'سوادي الحكمان'; 'السوادي الحكمان' = 'سوادي الحكمان'; 'السوادى الساحل' = 'سوادي الساحل'; 'السوادي الساحل' = 'سوادي الساحل' }
function NormW([string]$s) { return ($s -replace '[أإآ]', 'ا' -replace 'ة', 'ه' -replace 'ى', 'ي' -replace '[\-–ـ،,\(\)\*]', ' ') }
# Whole-word match (optional ب/و/ل/في prefix) so short names like «قري» don't hit «قريب».
$areaKeys = @()
foreach ($pair in (@($areas | ForEach-Object { ,@($_, $_) }) + @($alias.Keys | ForEach-Object { ,@($_, $alias[$_]) }))) {
  $w = (NormW $pair[0]).Trim() -replace '\s+', '\s*'
  $areaKeys += ,@($w.Length, ('(?<![\p{L}])(?:[وبل]|في\s*)?' + $w + '(?![\p{L}])'), $pair[1])
}
$areaKeys = $areaKeys | Sort-Object { - $_[0] }
function Find-Area([string]$text) {
  $n = NormW $text
  foreach ($k in $areaKeys) { if ($n -match $k[1]) { return $k[2] } }
  return 'بركاء، غير محدد'
}
function Posted([string]$age) {
  # "قبل 13 ساعة" / "قبل 3 أيام" / "قبل يوم" / "قبل 38 دقيقة"
  $d = Get-Date
  if ($age -match '^(\d{1,2})-(\d{1,2})-(\d{4})$') { return ('{0}-{1:00}-{2:00}' -f $Matches[3], [int]$Matches[2], [int]$Matches[1]) }
  if ($age -match '(\d+)\s*(يوم|أيام|ايام)') { return $d.AddDays(-[int]$Matches[1]).ToString('yyyy-MM-dd') }
  if ($age -match 'يومين') { return $d.AddDays(-2).ToString('yyyy-MM-dd') }
  if ($age -match 'قبل\s*يوم|أمس|امس') { return $d.AddDays(-1).ToString('yyyy-MM-dd') }
  if ($age -match '(\d+)\s*(ساعة|ساعات)') { return $d.AddHours(-[int]$Matches[1]).ToString('yyyy-MM-dd') }
  if ($age -match '(\d+)\s*(أسبوع|أسابيع|اسبوع)') { return $d.AddDays(-7 * [int]$Matches[1]).ToString('yyyy-MM-dd') }
  if ($age -match '(دقيقة|دقائق|ثانية)') { return $d.ToString('yyyy-MM-dd') }
  return ''
}
function PriceNote($price, $area) {
  if ($price -ne $null -and ($price -lt 1000 -or ($area -and $price / $area -lt 3))) { return 'سعر غير منطقي' } ; return ''
}

$lands = New-Object System.Collections.ArrayList
$bld = New-Object System.Collections.ArrayList
$keys = New-Object System.Collections.ArrayList
$batch = New-Object 'System.Collections.Generic.HashSet[string]'
$counts = [ordered]@{ os_land = 0; os_bld = 0; bayut_land = 0; bayut_bld = 0; listed = 0; already = 0 }

function Add-Row([string]$key, $row, [bool]$isLand, [string]$counter) {
  for ($i = 0; $i -lt $row.Count; $i++) { if ($null -eq $row[$i]) { $row[$i] = '' } }
  $counts.listed++
  if ($seen.Contains($key) -or -not $batch.Add($key)) { $counts.already++; return }
  if (($lands.Count + $bld.Count) -ge $Max) { return }
  if ($isLand) { [void]$lands.Add($row) } else { [void]$bld.Add($row) }
  [void]$keys.Add($key); $counts[$counter]++
}

# ---------- OpenSooq (card HTML: price, title, areas, rooms, use, age) ----------
$osBase = 'https://om.opensooq.com/ar/الباطنة/بركاء/عقارات/'
foreach ($cat in @(@('أراضي-للبيع', $true), @('فلل-وقصور-للبيع', $false))) {
  for ($p = 1; $p -le $Pages; $p++) {
    $url = $osBase + $cat[0] + $(if ($p -gt 1) { "?page=$p" } else { '' })
    $h = Get-Html $url; if (-not $h) { continue }
    $cards = [regex]::Matches($h, 'data-id1="(\d+)".*?(?=data-id1="|</main>)', 'Singleline')
    if ($cards.Count -eq 0) { [void]$failed.Add("$url : no listing cards"); continue }
    foreach ($c in $cards) {
      $id = $c.Groups[1].Value
      $parts = @(($c.Value -replace '<[^>]+>', '|') -split '\|' | ForEach-Object { Clean $_ } | Where-Object { $_ })
      $parts = $parts[1..($parts.Count - 1)]   # drop the attribute tail of the opening tag
      $age = ($parts | Where-Object { $_ -match '^(قبل |منذ |أمس|امس|\d{1,2}-\d{1,2}-\d{4}$)' } | Select-Object -First 1)
      $priceTxt = ($parts | Where-Object { $_ -match 'ريال' } | Select-Object -First 1)
      $pi = [array]::IndexOf($parts, $priceTxt)
      $title = if ($pi -ge 0 -and $pi + 1 -lt $parts.Count) { $parts[$pi + 1] } else { '' }
      $price = Num $priceTxt
      $land = Num (($parts | Where-Object { $_ -match '^مساحة الأرض' } | Select-Object -First 1) -replace '^[^:]*:', '')
      $built = Num (($parts | Where-Object { $_ -match '^المساحة:' } | Select-Object -First 1) -replace '^[^:]*:', '')
      $rooms = Num (($parts | Where-Object { $_ -match 'غرف? نوم|غرفة نوم' } | Select-Object -First 1))
      $bathTxt = ($parts | Where-Object { $_ -match 'حم.?ام' } | Select-Object -First 1)
      $baths = if ($bathTxt -match 'أكثر من (\d+)') { [int]$Matches[1] + 1 } else { Num $bathTxt }
      if ($title -match '^\W*مطلوب') { continue }   # "wanted" ads are not listings
      $area = Find-Area $title
      $link = "https://om.opensooq.com/ar/search/$id"
      if ($cat[1]) {
        $useTxt = [string]($parts | Where-Object { $_ -match '^(سكني|تجاري|زراعي|سياحي|صناعي)' -and $_.Length -lt 25 } | Select-Object -First 1)
        if ($title -match 'سكني\S*\s*[/و]?\s*تجاري|تجاري\S*\s*[/و]?\s*سكني') { $useTxt = 'سكني تجاري' }
        $use = ''
        if ($useTxt -match 'سكني.*تجاري') { $use = 'سكني تجاري' } elseif ($useTxt -match '^سكني') { $use = 'سكني' } elseif ($useTxt -match 'تجاري') { $use = 'تجاري' } elseif ($useTxt -match 'زراعي') { $use = 'زراعي' } elseif ($useTxt -match 'سياحي') { $use = 'سياحي' } elseif ($useTxt -match 'صناعي') { $use = 'صناعي' }
        $ppm = if ($price -and $land) { [math]::Round($price / $land, 1) } else { '' }
        $note = (@((PriceNote $price $land), $title) | Where-Object { $_ }) -join ' - '
        $row = @($today, $today, 'معروض', 'السوق المفتوح', $id, $link, 'بركاء', $area, '', $use, '', $land, $price, $ppm, '', '', '', '', '', (Posted $age), '', $note, '', '')
        Add-Row "O$id" $row $true 'os_land'
      } else {
        $type = if ($title -match 'توين|توأم') { 'توين فيلا' } elseif ($title -match 'شقة|شقه') { 'شقة' } elseif ($title -match 'عمار|بناية') { 'عمارة' } elseif ($title -match 'منزل|بيت') { 'بيت' } elseif ($title -match 'شاليه') { 'شاليه' } else { 'فيلا' }
        $ppm = if ($price -and $built) { [math]::Round($price / $built, 0) } else { '' }
        $note = (@((PriceNote $price $land), $title) | Where-Object { $_ }) -join ' - '
        $row = @($today, $today, 'معروض', 'السوق المفتوح', $id, $link, 'بركاء', $area, $type, $land, $built, $rooms, $baths, '', $price, $ppm, '', '', '', '', (Posted $age), '', '', '', $note)
        Add-Row "O$id" $row $false 'os_bld'
      }
    }
  }
}

# ---------- Bayut (ld+json ItemList) ----------
$byPages = @('https://www.bayut.om/اراضي-سكنية-للبيع-في-بركاء/الباطنة/', 'https://www.bayut.om/فلل-للبيع-في-بركاء/الباطنة/')
foreach ($base in $byPages) {
  for ($p = 1; $p -le $Pages; $p++) {
    $url = if ($p -gt 1) { $base + "page-$p/" } else { $base }
    $h = Get-Html $url; if (-not $h) { if ($p -gt 1) { $failed.RemoveAt($failed.Count - 1) }; break }
    $items = @()
    foreach ($m in [regex]::Matches($h, '<script[^>]*application/ld\+json[^>]*>(.*?)</script>', 'Singleline')) {
      if ($m.Groups[1].Value -notmatch 'RealEstateListing') { continue }
      $j = $m.Groups[1].Value | ConvertFrom-Json
      foreach ($g in @($j.'@graph')) { if ($g.mainEntity.itemListElement) { $items += @($g.mainEntity.itemListElement) } }
    }
    if ($items.Count -eq 0) { if ($p -eq 1) { [void]$failed.Add("$url : no listings") }; break }
    $new = 0
    foreach ($it in $items) {
      $u = [uri]::UnescapeDataString([string]$it.item.url)
      if ($u -notmatch 'تفاصيل-(\d+)') { continue }
      $id = $Matches[1]; $e = $it.item.mainEntity
      $cat = [string]$e.accommodationCategory
      $price = Num ([string]$e.price); $size = Num ([string]$e.floorSize.value)
      $geo = if ($e.geo) { "إحداثيات: $($e.geo.latitude),$($e.geo.longitude)" } else { '' }
      $seller = Clean ([string]$e.seller.name)
      $link = [string]$it.item.url
      if ($cat -match '^ارض|^أرض') {
        $use = if ($cat -match 'تجاري') { 'تجاري' } elseif ($cat -match 'زراع') { 'زراعي' } elseif ($cat -match 'صناع') { 'صناعي' } else { 'سكني' }
        $ppm = if ($price -and $size) { [math]::Round($price / $size, 1) } else { '' }
        $note = (@((PriceNote $price $size), $geo) | Where-Object { $_ }) -join ' - '
        $row = @($today, $today, 'معروض', 'بيوت', $id, $link, 'بركاء', 'بركاء، غير محدد', '', $use, '', $size, $price, $ppm, '', '', '', '', '', '', '', $note, $seller, '')
        $before = $counts.bayut_land; Add-Row "B$id" $row $true 'bayut_land'; if ($counts.bayut_land -gt $before) { $new++ }
      } else {
        $type = if ($cat -match 'شاليه') { 'شاليه' } elseif ($cat -match 'شقة') { 'شقة' } elseif ($cat -match 'تاون|توين') { 'توين فيلا' } else { 'فيلا' }
        $rooms = $e.numberOfBedrooms; $baths = $e.numberOfBathroomsTotal
        $ppm = if ($price -and $size) { [math]::Round($price / $size, 0) } else { '' }
        $note = (@((PriceNote $price $null), $geo) | Where-Object { $_ }) -join ' - '
        $row = @($today, $today, 'معروض', 'بيوت', $id, $link, 'بركاء', 'بركاء، غير محدد', $type, '', $size, $rooms, $baths, '', $price, $ppm, '', '', '', '', '', '', $seller, '', $note)
        $before = $counts.bayut_bld; Add-Row "B$id" $row $false 'bayut_bld'; if ($counts.bayut_bld -gt $before) { $new++ }
      }
    }
    if ($items.Count -lt 20) { break }   # last page
  }
}

# Pending = what this run printed; -Commit marks it seen once it is in the sheet.
$pend = @{ date = $today; keys = @($keys) }
[IO.File]::WriteAllText($pendFile, ($pend | ConvertTo-Json -Compress), [Text.Encoding]::UTF8)

$out = [ordered]@{ date = $today; seen = $seen.Count; counts = $counts; failed = @($failed); lands = @($lands); bld = @($bld) }
$out | ConvertTo-Json -Depth 5 -Compress
