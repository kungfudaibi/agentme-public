param(
    [Parameter(Mandatory = $true)][string]$Token,
    [string]$BaseUrl = "http://127.0.0.1:3210"
)

$headers = @{ Authorization = "Bearer $Token"; "Content-Type" = "application/json" }
$created = Invoke-RestMethod -Method Post -Uri "$BaseUrl/tasks" -Headers $headers -Body '{"instruction":"PowerShell smoke task"}'

$completed = $false
for ($attempt = 0; $attempt -lt 100; $attempt += 1) {
    $task = Invoke-RestMethod -Method Get -Uri "$BaseUrl/tasks/$($created.taskId)" -Headers $headers
    if ($task.state -eq "completed") {
        Write-Output "Completed task $($created.taskId)"
		$completed = $true
		break
    }
    Start-Sleep -Milliseconds 50
}

if (-not $completed) { throw "Task did not complete" }

$toCancel = Invoke-RestMethod -Method Post -Uri "$BaseUrl/tasks" -Headers $headers -Body '{"instruction":"PowerShell cancellation task"}'
Invoke-RestMethod -Method Post -Uri "$BaseUrl/tasks/$($toCancel.taskId)/cancel" -Headers $headers | Out-Null
$cancelled = Invoke-RestMethod -Method Get -Uri "$BaseUrl/tasks/$($toCancel.taskId)" -Headers $headers
if ($cancelled.state -ne "cancelled") { throw "Task did not cancel" }
Write-Output "Cancelled task $($toCancel.taskId)"
