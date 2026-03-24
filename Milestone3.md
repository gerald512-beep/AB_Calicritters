# Milestone 3 - Kubernetes Split Deployment and Canary Release

## Objective

Implement Milestone 3 in the existing `AB_Calicritters` repo by:

1. Keeping Render as the current live environment.
2. Adding a separate Kubernetes environment in Minikube.
3. Splitting backend runtime into two deployable services:
   - `assignment-api` for `POST /v1/assignment`
   - `events-api` for `POST /v1/events`
4. Adding ingress routing and canary release controls for `events-api`.
5. Capturing reproducible evidence logs.

## Implemented Artifacts

### Runtime split

1. `packages/api/src/assignment-api.ts`
2. `packages/api/src/events-api.ts`
3. `packages/api/src/common/apiCommon.ts`

Notes:
- `events-api` returns header `x-events-service-variant` (`stable` or `canary`) to verify traffic split.
- Existing unified API entrypoint is preserved, so current APIs are not broken.

### Containerization

1. `packages/api/Dockerfile.assignment`
2. `packages/api/Dockerfile.events`
3. `.dockerignore`

### Kubernetes manifests

1. `infra/k8s/namespace.yaml`
2. `infra/k8s/secrets.yaml` (template only, no real secrets committed)
3. `infra/k8s/assignment-api-deployment.yaml`
4. `infra/k8s/assignment-api-service.yaml`
5. `infra/k8s/events-api-deployment.yaml` (stable)
6. `infra/k8s/events-api-service.yaml`
7. `infra/k8s/events-api-canary-deployment.yaml`
8. `infra/k8s/events-api-canary-service.yaml`
9. `infra/k8s/ingress.yaml`
10. `infra/k8s/ingress-canary.yaml`

### Minikube automation scripts

1. `scripts/minikube/setup.ps1`
2. `scripts/minikube/deploy.ps1`
3. `scripts/minikube/canary-weight.ps1`
4. `scripts/minikube/rollback.ps1`
5. `scripts/minikube/smoke-test.ps1`

## Deployment Procedure (Executed)

1. Cluster/bootstrap:
   - `powershell -ExecutionPolicy Bypass -File scripts/minikube/setup.ps1`
2. Build images and deploy manifests:
   - `powershell -ExecutionPolicy Bypass -File scripts/minikube/deploy.ps1`
3. Verify rollout:
   - `kubectl get pods -n ab-calicritters`
   - `kubectl get svc -n ab-calicritters`
   - `kubectl get ingress -n ab-calicritters`
4. Smoke tests (in-cluster ingress path):
   - `powershell -ExecutionPolicy Bypass -File scripts/minikube/smoke-test.ps1 -Requests <N>`
5. Canary control:
   - `powershell -ExecutionPolicy Bypass -File scripts/minikube/canary-weight.ps1 -Weight 10`
   - `powershell -ExecutionPolicy Bypass -File scripts/minikube/canary-weight.ps1 -Weight 50`
6. Rollback:
   - `powershell -ExecutionPolicy Bypass -File scripts/minikube/rollback.ps1`

## Evidence and Results

All run artifacts are stored in `artifacts/milestone3/`.

Selected verification runs:

1. 10% canary weighted run:
   - file: `artifacts/milestone3/smoke-20260305-000237.json`
   - requests: 400
   - HTTP 200: 400
   - variant split: stable=351, canary=49 (12.25%)
2. 50% canary weighted run:
   - file: `artifacts/milestone3/smoke-20260305-000432.json`
   - requests: 200
   - HTTP 200: 200
   - variant split: stable=100, canary=100 (50.00%)
3. Rollback run (canary disabled):
   - file: `artifacts/milestone3/smoke-20260305-000602.json`
   - requests: 100
   - HTTP 200: 100
   - variant split: stable=100, canary=0 (0.00%)

Interpretation:

1. Weighted canary routing is active and adjustable.
2. Rollback path works (`weight=0` + canary replicas `0`).
3. Assignment and events endpoints remain healthy during routing changes.

## Notes on Networking During Validation

From this laptop setup, direct host access to Minikube ingress IP timed out.  
To keep tests reproducible, `scripts/minikube/smoke-test.ps1` runs requests from a pod inside the cluster through ingress service DNS. This still validates:

1. ingress routing
2. canary annotations
3. service split behavior
4. endpoint correctness and status codes

## Acceptance Mapping

1. Separate deployable services: complete.
2. Kubernetes manifests + ingress routing: complete.
3. Canary support with weighted traffic: complete.
4. Rollback script and verified rollback evidence: complete.
5. Milestone evidence logs committed under `artifacts/milestone3`: complete.
