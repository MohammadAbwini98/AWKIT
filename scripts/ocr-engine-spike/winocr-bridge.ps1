# N7.6 (awkit-vra.9.7) DIAGNOSTIC-ONLY bridge to the Windows built-in OCR engine (Windows.Media.Ocr), used only by
# scripts/benchmark-ocr-engine-spike.mts and scripts/verify-ocr-engine-spike.mts, passed as -EncodedCommand (no script
# file executes). Images arrive on stdin as JSON lines (BGRA8, base64) and words return on stdout as JSON lines.
# It writes no file and logs nothing. The engine is the operating system's local recognizer; nothing is downloaded.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Emit($value) {
  [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0].MakeGenericMethod([Windows.Media.Ocr.OcrResult])
  $languages = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag })
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US'))
} catch {
  Emit @{ type = 'ready'; available = $false; reason = 'winrt-unavailable' }
  exit 0
}
if ($null -eq $engine) {
  Emit @{ type = 'ready'; available = $false; reason = 'no-en-us-recognizer'; languages = $languages }
  exit 0
}
Emit @{ type = 'ready'; available = $true; languages = $languages; maxDimension = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $request = $line | ConvertFrom-Json
  if ($request.type -eq 'shutdown') { break }
  try {
    $bytes = [Convert]::FromBase64String($request.b64)
    $bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::new([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [int]$request.w, [int]$request.h, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)
    $bitmap.CopyFromBuffer([System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer($bytes))
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $task = $asTask.Invoke($null, @($engine.RecognizeAsync($bitmap)))
    $null = $task.Wait(-1)
    $result = $task.Result
    $watch.Stop()
    $words = New-Object System.Collections.ArrayList
    foreach ($ocrLine in $result.Lines) { foreach ($word in $ocrLine.Words) { $null = $words.Add($word.Text) } }
    $bitmap.Dispose()
    Emit @{ type = 'result'; id = $request.id; ok = $true; words = @($words); recognizeMs = $watch.Elapsed.TotalMilliseconds }
  } catch {
    Emit @{ type = 'result'; id = $request.id; ok = $false; reason = 'recognize-failed' }
  }
}
