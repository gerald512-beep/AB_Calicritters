## Milestone 4 - Chaos Engineering

### Status

Milestone 4 was executed locally in the Milestone 3 Minikube environment using Chaos Mesh. Both
required experiment classes from the PDF were run:

1. pod kill testing
2. network latency testing

The experiments exposed one real resilience gap in `assignment-api` when it was deployed with a
single replica. That gap was mitigated by increasing the deployment to two replicas and rerunning
the pod kill test.

### Environment

- Primary chaos environment: local Minikube cluster from Milestone 3
- Live deployment environment: Yale server
- Source of truth: GitHub repo main branch

### Framework choice

The repo is using Minikube for Milestone 3, so the recommended Chaos Engineering tool for
Milestone 4 is Chaos Mesh.

Reasoning:

1. It integrates cleanly with Kubernetes and Minikube.
2. It supports the two experiments required by the PDF:
   - pod/service kill test
   - network latency test
3. It allows the team to store experiment manifests directly in the repo.

### Implemented Milestone 4 artifacts

Configuration:

- `infra/k8s/chaos/README.md`
- `infra/k8s/chaos/events-api-pod-kill.yaml`
- `infra/k8s/chaos/assignment-api-pod-kill.yaml`
- `infra/k8s/chaos/api-network-latency.yaml`

Scripts:

- `scripts/minikube/chaos-install.ps1`
- `scripts/minikube/chaos-common.ps1`
- `scripts/minikube/chaos-kill-test.ps1`
- `scripts/minikube/chaos-latency-test.ps1`
- `scripts/minikube/chaos-cleanup.ps1`

Evidence output target:

- `artifacts/milestone4/`

### Executed experiments

#### Experiment 1 - Pod kill test

Targets:

1. `events-api` stable pods
2. `assignment-api` before and after mitigation

Goal:

- Verify that Kubernetes recreates a killed pod automatically and that the service recovers.

Commands executed:

- `powershell -ExecutionPolicy Bypass -File scripts/minikube/chaos-install.ps1`
- `powershell -ExecutionPolicy Bypass -File scripts/minikube/chaos-kill-test.ps1 -Target events-api -Requests 60`
- `powershell -ExecutionPolicy Bypass -File scripts/minikube/chaos-kill-test.ps1 -Target assignment-api -Requests 60`

Observed results:

1. `events-api` kill test
   - baseline: `60/60` HTTP `200`
   - during pod kill: `60/60` HTTP `200`
   - after recovery: `60/60` HTTP `200`
   - interpretation: the stable `events-api` deployment stayed available through the failure because
     it already had multiple replicas behind ingress.

2. `assignment-api` kill test before mitigation
   - baseline: `60/60` HTTP `200`
   - during pod kill: `60/60` HTTP `503`
   - after recovery: `60/60` HTTP `200`
   - interpretation: the single-replica `assignment-api` deployment had a full outage window while
     Kubernetes was replacing the killed pod.

Mitigation applied:

- `infra/k8s/assignment-api-deployment.yaml` was updated from `replicas: 1` to `replicas: 2`.
- After the change, the deployment was reapplied and the canary was rolled back to keep the test on
  a stable topology.

Re-test after mitigation:

- `powershell -ExecutionPolicy Bypass -File scripts/minikube/chaos-kill-test.ps1 -Target assignment-api -Requests 60`

Observed results after mitigation:

- baseline: `60/60` HTTP `200`
- during pod kill: `60/60` HTTP `200`
- after recovery: `60/60` HTTP `200`
- interpretation: increasing `assignment-api` to two replicas removed the outage observed in the
  first run.

#### Experiment 2 - Network latency test

Target:

1. `events-api` stable pods

Goal:

- Verify how the service behaves when network delay is injected around the API pod.

Commands executed:

- initial run exposed a manifest issue and was corrected by changing
  `infra/k8s/chaos/api-network-latency.yaml` from `direction: both` to `direction: to`
- final execution:
  - `powershell -ExecutionPolicy Bypass -File scripts/minikube/chaos-latency-test.ps1 -Requests 80`

Observed results:

- baseline:
  - `80/80` HTTP `200`
  - average latency: `0.0872s`
  - `p50`: `0.0792s`
  - `p95`: `0.1275s`
  - max: `0.2051s`
- during injected latency:
  - `79/80` HTTP `200`
  - `1/80` HTTP `502`
  - average latency: `0.9902s`
  - `p50`: `0.1029s`
  - `p95`: `2.2529s`
  - max: `2.3910s`
- after cleanup:
  - `80/80` HTTP `200`
  - average latency: `0.0807s`
  - `p50`: `0.0716s`
  - `p95`: `0.1250s`
  - max: `0.3079s`

Interpretation:

- the `events-api` service remained mostly available during the latency injection
- the latency fault meaningfully degraded tail latency and surfaced one upstream failure (`502`)
- after the chaos resource was removed, latency returned to approximately baseline levels

### Command set to execute

Install Chaos Mesh:

- `powershell -ExecutionPolicy Bypass -File scripts/minikube/chaos-install.ps1`

Run pod kill tests:

- `powershell -ExecutionPolicy Bypass -File scripts/minikube/chaos-kill-test.ps1 -Target events-api`
- `powershell -ExecutionPolicy Bypass -File scripts/minikube/chaos-kill-test.ps1 -Target assignment-api`

Run latency test:

- `powershell -ExecutionPolicy Bypass -File scripts/minikube/chaos-latency-test.ps1`

Cleanup:

- `powershell -ExecutionPolicy Bypass -File scripts/minikube/chaos-cleanup.ps1`

### Evidence to capture after execution

For each experiment, record:

1. Commands executed
2. Chaos manifest applied
3. Baseline probe output
4. During-fault probe output
5. After-recovery probe output
6. Pod state snapshots
7. Any mitigation applied and the re-test result

### Findings

Primary findings:

1. `events-api` already had enough replica redundancy to absorb a single pod kill without visible
   client impact in this test run.
2. `assignment-api` was not resilient to pod kill while configured as a single-replica deployment.
3. Changing `assignment-api` to two replicas was a meaningful mitigation and removed the observed
   outage in the follow-up test.
4. Network latency faults did not fully take down `events-api`, but they did sharply increase tail
   latency and produced a small amount of request failure, which is the exact kind of degradation
   the experiment was intended to expose.

Evidence files:

- `artifacts/milestone4/events-api-pod-kill-20260331-123155/summary.json`
- `artifacts/milestone4/assignment-api-pod-kill-20260331-123309/summary.json`
- `artifacts/milestone4/assignment-api-pod-kill-20260331-123506/summary.json`
- `artifacts/milestone4/events-api-network-latency-20260331-123831/summary.json`
