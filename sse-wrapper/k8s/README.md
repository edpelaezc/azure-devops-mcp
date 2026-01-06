# Kubernetes Deployment Guide

This directory contains Kubernetes manifests for deploying the Nova Azure DevOps MCP SSE Wrapper to EKS.

## 📁 Files

- **deployment.yaml** - Complete deployment configuration including:
  - Namespace
  - Secret (PAT token + API key)
  - ConfigMap (environment variables)
  - Deployment (2 replicas with HPA)
  - Service (ClusterIP)
  - Ingress (ALB with HTTPS)
  - HorizontalPodAutoscaler

## 🔧 Pre-Deployment Checklist

Before deploying, ensure you have:

- [ ] **Azure DevOps PAT Token** - Generated at https://dev.azure.com/distelsa/_usersSettings/tokens
- [ ] **API Key** - Generated with `openssl rand -base64 32`
- [ ] **ECR Repository** - Created in AWS ECR
- [ ] **Docker Image** - Built and pushed to ECR
- [ ] **ACM Certificate** - Created for your domain
- [ ] **DNS Record** - Pointing to ALB (after initial deployment)

## 📝 Configuration Steps

### 1. Edit deployment.yaml

Replace the following placeholders:

```yaml
# In Secret section:
azure-devops-pat: "YOUR_AZURE_DEVOPS_PAT_HERE"
mcp-api-key: "YOUR_RANDOM_API_KEY_HERE"

# In Deployment section:
image: YOUR_AWS_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/nova/azdo-mcp-wrapper:latest

# In Ingress section:
alb.ingress.kubernetes.io/certificate-arn: "arn:aws:acm:us-east-1:YOUR_ACCOUNT:certificate/YOUR_CERT_ID"
host: azdo-mcp.nova.cloud # Your actual domain
```

### 2. Apply Manifests

```bash
# Apply all resources
kubectl apply -f deployment.yaml

# Or apply individually
kubectl create namespace central-services
kubectl apply -f deployment.yaml -n central-services
```

### 3. Verify Deployment

```bash
# Check namespace
kubectl get namespace central-services

# Check all resources
kubectl get all -n central-services -l app=azdo-mcp-wrapper

# Check pods
kubectl get pods -n central-services -l app=azdo-mcp-wrapper

# Check service
kubectl get svc -n central-services azdo-mcp-wrapper

# Check ingress
kubectl get ingress -n central-services azdo-mcp-wrapper
```

Expected output:

```
NAME                                READY   STATUS    RESTARTS   AGE
pod/azdo-mcp-wrapper-xxx-xxx        1/1     Running   0          2m
pod/azdo-mcp-wrapper-xxx-yyy        1/1     Running   0          2m

NAME                       TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)   AGE
service/azdo-mcp-wrapper   ClusterIP   10.100.50.100   <none>        80/TCP    2m

NAME                               READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/azdo-mcp-wrapper   2/2     2            2           2m

NAME                               CLASS   HOSTS                  ADDRESS                          PORTS   AGE
ingress/azdo-mcp-wrapper           alb     azdo-mcp.nova.cloud    xxx.us-east-1.elb.amazonaws.com  80      2m
```

### 4. Get ALB DNS Name

```bash
kubectl get ingress -n central-services azdo-mcp-wrapper -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

### 5. Configure DNS

Create a CNAME record pointing your domain to the ALB:

```
Type: CNAME
Name: azdo-mcp.nova.cloud
Value: xxx.us-east-1.elb.amazonaws.com (from previous step)
TTL: 300
```

### 6. Test Endpoint

```bash
# Test health check
curl https://azdo-mcp.nova.cloud/health

# Test with authentication
curl -H "Authorization: Bearer YOUR_API_KEY" \
     -X POST https://azdo-mcp.nova.cloud/mcp/sse
```

## 🔍 Monitoring

### View Logs

```bash
# All pods
kubectl logs -n central-services -l app=azdo-mcp-wrapper -f

# Specific pod
kubectl logs -n central-services azdo-mcp-wrapper-xxx-xxx -f

# Previous container (if crashed)
kubectl logs -n central-services azdo-mcp-wrapper-xxx-xxx --previous
```

### Check Health

```bash
# From inside cluster
kubectl exec -n central-services deployment/azdo-mcp-wrapper -- \
  wget -qO- http://localhost:3000/health

# From outside cluster
curl https://azdo-mcp.nova.cloud/health
```

### Resource Usage

```bash
# CPU and Memory usage
kubectl top pods -n central-services -l app=azdo-mcp-wrapper

# HPA status
kubectl get hpa -n central-services azdo-mcp-wrapper

# Describe HPA
kubectl describe hpa -n central-services azdo-mcp-wrapper
```

### Events

```bash
# Recent events
kubectl get events -n central-services --sort-by='.lastTimestamp' | grep azdo-mcp

# Watch events live
kubectl get events -n central-services --sort-by='.lastTimestamp' -w
```

## 🛠️ Common Operations

### Update Image

```bash
# Set new image
kubectl set image deployment/azdo-mcp-wrapper \
  mcp-wrapper=YOUR_ECR_REPO/azdo-mcp-wrapper:v1.1.0 \
  -n central-services

# Check rollout status
kubectl rollout status deployment/azdo-mcp-wrapper -n central-services
```

### Rollback

```bash
# View rollout history
kubectl rollout history deployment/azdo-mcp-wrapper -n central-services

# Rollback to previous version
kubectl rollout undo deployment/azdo-mcp-wrapper -n central-services

# Rollback to specific revision
kubectl rollout undo deployment/azdo-mcp-wrapper -n central-services --to-revision=2
```

### Scale Manually

```bash
# Scale to 3 replicas
kubectl scale deployment/azdo-mcp-wrapper -n central-services --replicas=3

# Scale to 1 replica (for debugging)
kubectl scale deployment/azdo-mcp-wrapper -n central-services --replicas=1
```

### Restart Pods

```bash
# Rolling restart
kubectl rollout restart deployment/azdo-mcp-wrapper -n central-services

# Delete pod (will be recreated)
kubectl delete pod -n central-services azdo-mcp-wrapper-xxx-xxx
```

### Update Secrets

```bash
# Edit secret
kubectl edit secret azdo-mcp-secret -n central-services

# Or delete and recreate
kubectl delete secret azdo-mcp-secret -n central-services
# Edit deployment.yaml with new values
kubectl apply -f deployment.yaml

# Restart pods to pick up new secret
kubectl rollout restart deployment/azdo-mcp-wrapper -n central-services
```

### Debug Pod

```bash
# Get shell in running pod
kubectl exec -it -n central-services deployment/azdo-mcp-wrapper -- sh

# Inside the pod:
# - Check environment: env | grep AZURE
# - Check process: ps aux
# - Check files: ls -la
# - Test health: wget -qO- http://localhost:3000/health
```

## 🐛 Troubleshooting

### Pods Not Starting

```bash
# Check pod status
kubectl describe pod -n central-services -l app=azdo-mcp-wrapper

# Common issues:
# 1. ImagePullBackOff - Check image name and ECR permissions
# 2. CrashLoopBackOff - Check logs for startup errors
# 3. Pending - Check resource requests/limits
```

### Secret Not Found

```bash
# Verify secret exists
kubectl get secret -n central-services azdo-mcp-secret

# If missing, create it
kubectl create secret generic azdo-mcp-secret \
  -n central-services \
  --from-literal=azure-devops-pat=YOUR_PAT \
  --from-literal=mcp-api-key=YOUR_API_KEY
```

### Ingress Not Working

```bash
# Check ingress status
kubectl describe ingress -n central-services azdo-mcp-wrapper

# Check ALB Controller logs
kubectl logs -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller

# Common issues:
# 1. Invalid certificate ARN
# 2. Missing ALB Controller
# 3. Subnet tags missing
```

### Health Check Failing

```bash
# Check from inside pod
kubectl exec -n central-services deployment/azdo-mcp-wrapper -- \
  wget -qO- http://localhost:3000/health

# Check from service
kubectl run -n central-services test-pod --rm -it --image=busybox -- \
  wget -qO- http://azdo-mcp-wrapper/health
```

## 🔒 Security Best Practices

### Secrets Management

- ✅ Never commit secrets to Git
- ✅ Use Kubernetes Secrets for sensitive data
- ✅ Consider using AWS Secrets Manager with External Secrets Operator
- ✅ Rotate PAT tokens every 90 days

### Network Policies

Consider adding NetworkPolicy for additional security:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: azdo-mcp-wrapper-netpol
  namespace: central-services
spec:
  podSelector:
    matchLabels:
      app: azdo-mcp-wrapper
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: kube-system
      ports:
        - protocol: TCP
          port: 3000
```

### Pod Security

The deployment already includes:

- Non-root user (uid 1001)
- Dropped all capabilities
- Resource limits

## 📊 Metrics

### Prometheus Integration

The deployment includes Prometheus annotations:

```yaml
prometheus.io/scrape: "true"
prometheus.io/port: "3000"
prometheus.io/path: "/health"
```

To add custom metrics, consider integrating `prom-client` in the application.

## 🚀 Performance Tuning

### Adjust Resources

Edit deployment.yaml:

```yaml
resources:
  requests:
    memory: "512Mi" # Increase if needed
    cpu: "500m"
  limits:
    memory: "1Gi"
    cpu: "1000m"
```

### Adjust HPA

Edit deployment.yaml:

```yaml
spec:
  minReplicas: 3 # Increase for higher availability
  maxReplicas: 10 # Increase for more scale
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60 # Lower threshold = scale sooner
```

## 📚 Additional Resources

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [AWS Load Balancer Controller](https://kubernetes-sigs.github.io/aws-load-balancer-controller/)
- [EKS Best Practices](https://aws.github.io/aws-eks-best-practices/)

---

**Last Updated**: 2026-01-06
**Maintainer**: Distelsa Nova Team
