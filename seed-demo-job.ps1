<#
  Create a training job and assign it to the site engineer, so the mobile app
  has something to show. The backend keeps data in memory, so re-run this
  after every server restart.
#>
$ErrorActionPreference = "Stop"
$base = "http://localhost:3000"

function SignIn($id, $pw) {
  return Invoke-RestMethod -Uri "$base/api/sign-in" -Method Post -ContentType "application/json" `
    -Body (@{ identifier = $id; credential = $pw } | ConvertTo-Json)
}
function AuthHeader($s) { return @{ Authorization = "Bearer " + $s.token } }

# 1. Sales creates the job
$sales = SignIn "sales1" "pw"
$job = Invoke-RestMethod -Uri "$base/api/training" -Method Post -Headers (AuthHeader $sales) `
  -ContentType "application/json" -Body (@{
    serviceType   = "Training"
    location      = "On-site"
    course        = "Working at Height"
    typeOfTraining= "Safety Training"
    customerName  = "BCC Building Contracting L.L.C"
    trnNo         = "100123456700003"
    address       = "Jebel Ali Industrial Area 1, Dubai"
    contactNameNumber = "Mr Ramesh 971501234567"
    trainingDate  = "2026-09-10"
    mode          = "Onsite"
    salesPerson   = "Sales Person"
    jobOrderNo    = "TR 4500"
    workStatus    = "On site"
    workCodeTraining = $true
    lineItems     = @(
      @{ sn = 1; description = "Scaffolder"; qty = "4"; remarks = "" },
      @{ sn = 2; description = "Welder";     qty = "2"; remarks = "night shift" }
    )
  } | ConvertTo-Json -Depth 5)
Write-Output ("Created job: {0}" -f $job.jobNo)

# 2. Admin assigns it to the site engineer
$admin = SignIn "admin" "admin"
$users = Invoke-RestMethod -Uri "$base/api/users" -Headers (AuthHeader $admin)
$eng = $users | Where-Object { $_.identifier -eq "engineer1" } | Select-Object -First 1
if (-not $eng) { throw "engineer1 not found" }

$assigned = Invoke-RestMethod -Uri "$base/api/training/$($job.id)/assign" -Method Post `
  -Headers (AuthHeader $admin) -ContentType "application/json" `
  -Body (@{ assigneeId = $eng.id } | ConvertTo-Json)
Write-Output ("Assigned to {0} ({1}), status now {2}" -f $assigned.assigneeName, $assigned.assigneeRole, $assigned.status)

# 3. Confirm the engineer sees exactly this job
$engSession = SignIn "engineer1" "pw"
$mine = Invoke-RestMethod -Uri "$base/api/training" -Headers (AuthHeader $engSession)
Write-Output ("engineer1 sees {0} job(s): {1}" -f $mine.Count, (($mine | ForEach-Object { $_.jobNo }) -join ", "))
$alerts = Invoke-RestMethod -Uri "$base/api/notifications" -Headers (AuthHeader $engSession)
Write-Output ("engineer1 alerts: {0}" -f $alerts.Count)
