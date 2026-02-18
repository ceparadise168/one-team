export type DeploymentStage = 'dev' | 'staging' | 'prod';

export interface StageConfig {
  stage: DeploymentStage;
  account?: string;
  region: string;
  tags: Record<string, string>;
}

const DEFAULT_REGION = 'ap-northeast-1';

const STAGE_CONFIGS: Record<DeploymentStage, StageConfig> = {
  dev: {
    stage: 'dev',
    account: process.env.AWS_ACCOUNT_ID_DEV,
    region: DEFAULT_REGION,
    tags: {
      Project: 'one-team',
      Stage: 'dev'
    }
  },
  staging: {
    stage: 'staging',
    account: process.env.AWS_ACCOUNT_ID_STAGING,
    region: DEFAULT_REGION,
    tags: {
      Project: 'one-team',
      Stage: 'staging'
    }
  },
  prod: {
    stage: 'prod',
    account: process.env.AWS_ACCOUNT_ID_PROD,
    region: DEFAULT_REGION,
    tags: {
      Project: 'one-team',
      Stage: 'prod'
    }
  }
};

export function resolveStageConfig(input?: string): StageConfig {
  const normalized = (input ?? 'dev').toLowerCase();

  if (normalized === 'dev' || normalized === 'staging' || normalized === 'prod') {
    return STAGE_CONFIGS[normalized];
  }

  throw new Error(`Unsupported deployment stage: ${input}`);
}
