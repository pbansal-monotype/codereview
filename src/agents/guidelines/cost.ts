export const COST_GUIDELINES = `
Review the complete function, configuration, or infrastructure change. Use file contents to understand the execution context — is this a hot path called per-request, or a one-time script?

WHAT TO LOOK FOR:

1. **Paid API Calls in Hot Paths**
   - Check if the function calling a paid API (OpenAI, Twilio, Stripe, SendGrid, etc.) is in a request handler or loop.
   - Use file context to understand call frequency. Estimate cost at scale.
   - Example: "openai.chat.completions.create() at line 45 is called per search request with no caching → at 1000 req/day × $0.01/call = ~$300/month → add response caching or rate limiting"

2. **Unbounded Storage Writes**
   - Writing to S3/GCS/database proportional to request volume without TTL, rotation, or cleanup.
   - Check the full function: is there any expiry, max size, or cleanup logic?
   - Example: "s3.putObject() at line 30 writes a log file per request → no lifecycle policy → 1M requests = 1M objects × $0.023/1000/month = growing cost → add S3 lifecycle rule or use a log aggregator"

3. **Cloud Resource Provisioning Without Limits**
   - New Terraform/CloudFormation/Pulumi resources without size constraints, auto-scaling limits, or cost tags.
   - Check the full resource block from file context: is there a max_size, instance_type, or budget alert?

4. **Cross-Region/Cross-Cloud Data Transfer**
   - API calls or data fetches that cross region boundaries in the hot path.
   - Use file context to check if the service endpoint is in the same region as the calling service.

5. **Verbose Logging in Production**
   - DEBUG or TRACE level logging enabled in production configuration files.
   - Check the file context: is this a production config or a dev/test config?
   - Example: "log level set to 'debug' in production.config.ts at line 8 → at 10K req/sec, debug logging generates ~1TB/day → set to 'info' for production"

HOW TO USE FILE CONTEXT:
- Determine if the code runs per-request, per-cron, or once — this is critical for cost estimation
- Check if there are existing rate limiters, caches, or circuit breakers the author should use
- Look at config files to understand the deployment environment (production vs dev)
- Read infrastructure-as-code files to understand the current resource topology

DO NOT flag:
- Use of cloud services in general (that's how modern software works)
- "Could scale poorly" without estimating the actual cost dimension
- INFO/WARN/ERROR level logging (expected in production)
- One-time migration scripts, seed scripts, or batch jobs
- Cost proportional to legitimate user traffic (that's just business)
- Development/test environment configurations
`.trim();
