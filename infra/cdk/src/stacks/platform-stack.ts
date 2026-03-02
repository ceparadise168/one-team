import { fileURLToPath } from 'node:url';
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_apigateway as apigateway,
  aws_cloudwatch as cloudwatch,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_event_sources as lambdaEventSources,
  aws_lambda_nodejs as lambdaNodejs,
  aws_logs as logs,
  aws_ses as ses,
  aws_secretsmanager as secretsmanager,
  aws_s3 as s3,
  aws_sqs as sqs,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_wafv2 as wafv2
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DeploymentStage } from '../environments.js';

export interface PlatformStackProps extends StackProps {
  stage: DeploymentStage;
}

export class PlatformStack extends Stack {
  constructor(scope: Construct, id: string, props: PlatformStackProps) {
    super(scope, id, props);

    const prefix = `one-team-${props.stage}`;
    const lineSecretPrefix = `${prefix}/tenants`;

    const apiAccessLogs = new logs.LogGroup(this, 'ApiAccessLogs', {
      logGroupName: `/aws/apigateway/${prefix}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const healthHandler = new lambda.Function(this, 'HealthHandler', {
      functionName: `${prefix}-health`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: Duration.seconds(10),
      code: lambda.Code.fromInline(
        'exports.handler = async () => ({ statusCode: 200, body: JSON.stringify({ ok: true }) });'
      )
    });

    const api = new apigateway.RestApi(this, 'ApiGateway', {
      restApiName: `${prefix}-api`,
      deployOptions: {
        stageName: props.stage,
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
        accessLogDestination: new apigateway.LogGroupLogDestination(apiAccessLogs),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields()
      }
    });

    const publicApiBaseUrl = `https://${api.restApiId}.execute-api.${this.region}.${this.urlSuffix}/${props.stage}`;

    const apiRuntimeHandler = new lambdaNodejs.NodejsFunction(this, 'ApiRuntimeHandler', {
      functionName: `${prefix}-api-runtime`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: fileURLToPath(new URL('../../../../apps/api/src/lambda.ts', import.meta.url)),
      handler: 'handler',
      timeout: Duration.seconds(30),
      memorySize: 512,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        USE_AWS_SECRETS_MANAGER: 'true',
        USE_DYNAMODB_REPOSITORIES: 'true',
        LINE_INTEGRATION_MODE: 'real',
        LINE_SECRET_PREFIX: lineSecretPrefix,
        PUBLIC_API_BASE_URL: publicApiBaseUrl,
        TENANTS_TABLE_NAME: `${prefix}-tenants`,
        INVITATIONS_TABLE_NAME: `${prefix}-invitations`,
        EMPLOYEES_TABLE_NAME: `${prefix}-employees`,
        SESSIONS_TABLE_NAME: `${prefix}-sessions`,
        TOKEN_REVOCATIONS_TABLE_NAME: `${prefix}-token-revocations`,
        AUDIT_EVENTS_TABLE_NAME: `${prefix}-audit-events`,
        VOLUNTEER_TABLE_NAME: `${prefix}-volunteer`,
        DEFAULT_TENANT_ID: process.env.DEFAULT_TENANT_ID ?? 'default-tenant',
        CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://localhost:5174' // overridden below to include CloudFront domain
      }
    });

    apiRuntimeHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:CreateSecret',
          'secretsmanager:PutSecretValue',
          'secretsmanager:DescribeSecret',
          'secretsmanager:GetSecretValue'
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${lineSecretPrefix}/*`
        ]
      })
    );

    const apiRuntimeIntegration = new apigateway.LambdaIntegration(apiRuntimeHandler);

    api.root.addResource('health').addMethod('GET', new apigateway.LambdaIntegration(healthHandler));
    api.root.addResource('v1').addProxy({
      defaultIntegration: apiRuntimeIntegration,
      anyMethod: true
    });

    const invitationsDlq = new sqs.Queue(this, 'InvitationsDlq', {
      queueName: `${prefix}-invitations-dlq`,
      retentionPeriod: Duration.days(14)
    });

    const offboardingDlq = new sqs.Queue(this, 'OffboardingDlq', {
      queueName: `${prefix}-offboarding-dlq`,
      retentionPeriod: Duration.days(14)
    });

    const invitationsQueue = new sqs.Queue(this, 'InvitationsQueue', {
      queueName: `${prefix}-invitations`,
      visibilityTimeout: Duration.seconds(30),
      deadLetterQueue: {
        queue: invitationsDlq,
        maxReceiveCount: 5
      }
    });

    const offboardingQueue = new sqs.Queue(this, 'OffboardingQueue', {
      queueName: `${prefix}-offboarding`,
      visibilityTimeout: Duration.seconds(30),
      deadLetterQueue: {
        queue: offboardingDlq,
        maxReceiveCount: 5
      }
    });

    const tableProps = {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING
      },
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      },
      removalPolicy: RemovalPolicy.DESTROY
    };

    const tenantsTable = new dynamodb.Table(this, 'TenantsTable', {
      ...tableProps,
      tableName: `${prefix}-tenants`
    });

    const invitationsTable = new dynamodb.Table(this, 'InvitationsTable', {
      ...tableProps,
      tableName: `${prefix}-invitations`
    });

    const employeesTable = new dynamodb.Table(this, 'EmployeesTable', {
      ...tableProps,
      tableName: `${prefix}-employees`
    });

    const sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
      ...tableProps,
      tableName: `${prefix}-sessions`
    });

    const tokenRevocationsTable = new dynamodb.Table(this, 'TokenRevocationsTable', {
      ...tableProps,
      tableName: `${prefix}-token-revocations`
    });

    const auditEventsTable = new dynamodb.Table(this, 'AuditEventsTable', {
      ...tableProps,
      tableName: `${prefix}-audit-events`
    });

    employeesTable.addGlobalSecondaryIndex({
      indexName: 'gsi-line-user',
      partitionKey: { name: 'tenant_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'line_user_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    invitationsTable.addGlobalSecondaryIndex({
      indexName: 'gsi-invitation-status',
      partitionKey: { name: 'tenant_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    auditEventsTable.addGlobalSecondaryIndex({
      indexName: 'gsi-event-time',
      partitionKey: { name: 'tenant_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'event_time', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    const volunteerTable = new dynamodb.Table(this, 'VolunteerTable', {
      ...tableProps,
      tableName: `${prefix}-volunteer`
    });

    volunteerTable.addGlobalSecondaryIndex({
      indexName: 'gsi-status-date',
      partitionKey: { name: 'gsi_status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'activity_date', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    volunteerTable.addGlobalSecondaryIndex({
      indexName: 'gsi-employee',
      partitionKey: { name: 'employee_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'registered_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    tenantsTable.grantReadWriteData(apiRuntimeHandler);
    invitationsTable.grantReadWriteData(apiRuntimeHandler);
    employeesTable.grantReadWriteData(apiRuntimeHandler);
    sessionsTable.grantReadWriteData(apiRuntimeHandler);
    tokenRevocationsTable.grantReadWriteData(apiRuntimeHandler);
    auditEventsTable.grantReadWriteData(apiRuntimeHandler);
    volunteerTable.grantReadWriteData(apiRuntimeHandler);

    invitationsQueue.grantSendMessages(apiRuntimeHandler);
    offboardingQueue.grantSendMessages(apiRuntimeHandler);

    apiRuntimeHandler.addEnvironment('INVITATIONS_QUEUE_URL', invitationsQueue.queueUrl);
    apiRuntimeHandler.addEnvironment('OFFBOARDING_QUEUE_URL', offboardingQueue.queueUrl);

    const invitationEmailWorker = new lambdaNodejs.NodejsFunction(this, 'InvitationEmailWorker', {
      functionName: `${prefix}-invitation-email-worker`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: fileURLToPath(new URL('../../../../apps/api/src/workers/invitation-email-worker.ts', import.meta.url)),
      handler: 'handler',
      timeout: Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        USE_DYNAMODB_REPOSITORIES: 'true',
        EMAIL_ADAPTER_MODE: 'external',
        TENANTS_TABLE_NAME: `${prefix}-tenants`,
        INVITATIONS_TABLE_NAME: `${prefix}-invitations`
      }
    });

    invitationEmailWorker.addEventSource(
      new lambdaEventSources.SqsEventSource(invitationsQueue, {
        batchSize: 5,
        reportBatchItemFailures: true
      })
    );

    tenantsTable.grantReadData(invitationEmailWorker);
    invitationsTable.grantReadWriteData(invitationEmailWorker);

    const offboardingWorker = new lambdaNodejs.NodejsFunction(this, 'OffboardingWorker', {
      functionName: `${prefix}-offboarding-worker`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: fileURLToPath(new URL('../../../../apps/api/src/workers/offboarding-worker.ts', import.meta.url)),
      handler: 'handler',
      timeout: Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        USE_DYNAMODB_REPOSITORIES: 'true',
        USE_AWS_SECRETS_MANAGER: 'true',
        LINE_INTEGRATION_MODE: 'real',
        LINE_SECRET_PREFIX: lineSecretPrefix,
        AUDIT_EVENTS_TABLE_NAME: `${prefix}-audit-events`
      }
    });

    offboardingWorker.addEventSource(
      new lambdaEventSources.SqsEventSource(offboardingQueue, {
        batchSize: 1,
        reportBatchItemFailures: true
      })
    );

    auditEventsTable.grantReadWriteData(offboardingWorker);

    offboardingWorker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${lineSecretPrefix}/*`
        ]
      })
    );

    const lineCredentialsSecret = new secretsmanager.Secret(this, 'LineCredentialsSecret', {
      secretName: `${prefix}/line/credentials`,
      description: 'LINE credentials for tenant setup wizard'
    });

    new ses.CfnConfigurationSet(this, 'InvitationConfigurationSet', {
      name: `${prefix}-invitation-mail`
    });

    const apiWebAcl = new wafv2.CfnWebACL(this, 'ApiWebAcl', {
      defaultAction: { allow: {} },
      scope: 'REGIONAL',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${prefix}-web-acl`,
        sampledRequestsEnabled: true
      },
      rules: [
        {
          name: 'RateLimit',
          priority: 0,
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP'
            }
          },
          action: { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${prefix}-rate-limit`,
            sampledRequestsEnabled: true
          }
        }
      ]
    });

    new wafv2.CfnWebACLAssociation(this, 'ApiWebAclAssociation', {
      resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/stages/${api.deploymentStage.stageName}`,
      webAclArn: apiWebAcl.attrArn
    });

    new cloudwatch.Alarm(this, 'Api5xxAlarm', {
      alarmName: `${prefix}-api-5xx`,
      metric: api.metricServerError({ period: Duration.minutes(5), statistic: 'sum' }),
      threshold: 5,
      evaluationPeriods: 1
    });

    new cloudwatch.Alarm(this, 'OffboardingQueueDepthAlarm', {
      alarmName: `${prefix}-offboarding-queue-depth`,
      metric: offboardingQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: 'max'
      }),
      threshold: 100,
      evaluationPeriods: 1
    });

    new cloudwatch.Alarm(this, 'InvitationsDlqDepthAlarm', {
      alarmName: `${prefix}-invitations-dlq-depth`,
      metric: invitationsDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: 'max'
      }),
      threshold: 1,
      evaluationPeriods: 1
    });

    new cloudwatch.Alarm(this, 'InvitationEmailWorkerErrorAlarm', {
      alarmName: `${prefix}-invitation-email-worker-errors`,
      metric: invitationEmailWorker.metricErrors({
        period: Duration.minutes(5),
        statistic: 'sum'
      }),
      threshold: 3,
      evaluationPeriods: 1
    });

    new cloudwatch.Alarm(this, 'OffboardingWorkerErrorAlarm', {
      alarmName: `${prefix}-offboarding-worker-errors`,
      metric: offboardingWorker.metricErrors({
        period: Duration.minutes(5),
        statistic: 'sum'
      }),
      threshold: 3,
      evaluationPeriods: 1
    });

    // LIFF web app hosting (S3 + CloudFront)
    const liffWebBucket = new s3.Bucket(this, 'LiffWebBucket', {
      bucketName: `${prefix}-liff-web`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    const liffWebDistribution = new cloudfront.Distribution(this, 'LiffWebDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(liffWebBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html'
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html'
        }
      ]
    });

    const liffWebBaseUrl = `https://${liffWebDistribution.distributionDomainName}`;

    apiRuntimeHandler.addEnvironment('LIFF_WEB_BASE_URL', liffWebBaseUrl);

    apiRuntimeHandler.addEnvironment(
      'CORS_ALLOWED_ORIGINS',
      `http://localhost:5173,http://localhost:5174,${liffWebBaseUrl}`
    );

    new CfnOutput(this, 'LiffWebDistributionDomain', {
      value: liffWebDistribution.distributionDomainName,
      description: 'LIFF web app CloudFront domain'
    });

    new CfnOutput(this, 'LiffWebBucketName', {
      value: liffWebBucket.bucketName,
      description: 'LIFF web app S3 bucket for deployment'
    });

    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
      exportName: `${prefix}-api-url`
    });

    new CfnOutput(this, 'InvitationsQueueUrl', {
      value: invitationsQueue.queueUrl,
      exportName: `${prefix}-invitations-queue-url`
    });

    new CfnOutput(this, 'OffboardingQueueUrl', {
      value: offboardingQueue.queueUrl,
      exportName: `${prefix}-offboarding-queue-url`
    });

    new CfnOutput(this, 'LineCredentialsSecretArn', {
      value: lineCredentialsSecret.secretArn,
      exportName: `${prefix}-line-credentials-secret-arn`
    });

    new CfnOutput(this, 'TenantsTableName', {
      value: tenantsTable.tableName,
      exportName: `${prefix}-tenants-table-name`
    });

    new CfnOutput(this, 'InvitationsTableName', {
      value: invitationsTable.tableName,
      exportName: `${prefix}-invitations-table-name`
    });

    new CfnOutput(this, 'EmployeesTableName', {
      value: employeesTable.tableName,
      exportName: `${prefix}-employees-table-name`
    });

    new CfnOutput(this, 'SessionsTableName', {
      value: sessionsTable.tableName,
      exportName: `${prefix}-sessions-table-name`
    });

    new CfnOutput(this, 'TokenRevocationsTableName', {
      value: tokenRevocationsTable.tableName,
      exportName: `${prefix}-token-revocations-table-name`
    });

    new CfnOutput(this, 'AuditEventsTableName', {
      value: auditEventsTable.tableName,
      exportName: `${prefix}-audit-events-table-name`
    });
  }
}
