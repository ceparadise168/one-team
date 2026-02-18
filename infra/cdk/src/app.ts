import { App } from 'aws-cdk-lib';
import { PlatformStack } from './stacks/platform-stack.js';
import { resolveStageConfig } from './environments.js';

const app = new App();
const inputStage = app.node.tryGetContext('stage') ?? process.env.DEPLOY_STAGE ?? 'dev';
const stageConfig = resolveStageConfig(inputStage);

const stackNameByStage = {
  dev: 'OneTeamDevStack',
  staging: 'OneTeamStagingStack',
  prod: 'OneTeamProdStack'
} as const;

new PlatformStack(app, stackNameByStage[stageConfig.stage], {
  stage: stageConfig.stage,
  env: {
    account: stageConfig.account,
    region: stageConfig.region
  },
  tags: stageConfig.tags
});
